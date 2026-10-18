import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { LlmProvider, LlmRequest, LlmResponse, RunMode } from "./provider.js";

/** Rough tokens for one attached PDF page (rendered image + text layer). */
const TOKENS_PER_PDF_PAGE = 3000;

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type CliRunner = (args: string[], stdin: string, cwd: string) => Promise<CliResult>;

export interface ClaudeCodeProviderOptions {
  /** Path to the claude CLI (default: $CLAUDE_BIN or "claude" on PATH). */
  bin?: string;
  /** Parallel CLI processes; kept low to stay inside plan rate limits. */
  concurrency?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  runner?: CliRunner;
}

/**
 * Runs requests through headless Claude Code (`claude -p`), so usage is covered by the
 * signed-in Claude subscription instead of per-token API billing. Sync only (no batches),
 * and token counts are a conservative local estimate (no counting endpoint without a key).
 */
export class ClaudeCodeProvider implements LlmProvider {
  readonly name = "claude-code";
  readonly supportsBatch = false;
  private readonly concurrency: number;
  private readonly runner: CliRunner;

  constructor(opts: ClaudeCodeProviderOptions = {}) {
    this.concurrency = opts.concurrency ?? 2;
    this.runner = opts.runner ?? spawnRunner(opts.bin ?? process.env.CLAUDE_BIN ?? "claude", opts.timeoutMs ?? 600_000);
  }

  /** Over-estimates on purpose (~3 chars/token) so chunks stay under the ceiling. */
  async countTokens(req: LlmRequest): Promise<number> {
    return Math.ceil((req.system.length + req.text.length) / 3) + req.attachments.length * TOKENS_PER_PDF_PAGE;
  }

  async run(reqs: LlmRequest[], mode: RunMode): Promise<LlmResponse[]> {
    if (mode === "batch") throw new Error("claude-code provider does not support batch mode");
    const out: LlmResponse[] = new Array(reqs.length);
    let next = 0;
    const worker = async () => {
      while (next < reqs.length) {
        const k = next++;
        out[k] = await this.runOne(reqs[k]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, reqs.length) }, worker));
    return out;
  }

  private async runOne(req: LlmRequest): Promise<LlmResponse> {
    // Run in an empty temp dir so no project CLAUDE.md or settings leak into the prompt.
    const dir = await mkdtemp(join(tmpdir(), "civicradar-cc-"));
    try {
      let stdin = req.text;
      if (req.attachments.length) {
        const files: string[] = [];
        for (const [i, a] of req.attachments.entries()) {
          const name = `attachment-${i + 1}.pdf`;
          await writeFile(join(dir, name), a.pdf);
          files.push(`${name} (${a.title})`);
        }
        stdin +=
          `\n\nSome pages have no text layer. Read these PDF files with the Read tool before answering:\n` +
          files.map((f) => `- ${f}`).join("\n");
      }
      const res = await this.runner(buildArgs(req), stdin, dir);
      return parseResult(req, res);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export function buildArgs(req: LlmRequest): string[] {
  const args = [
    "-p",
    "--model", req.model,
    "--effort", req.effort,
    "--system-prompt", req.system,
    "--json-schema", JSON.stringify(cliSchema(req.schema)),
    "--output-format", "json",
    "--no-session-persistence",
  ];
  if (req.attachments.length) args.push("--tools", "Read", "--allowedTools", "Read");
  else args.push("--tools", "");
  return args;
}

/** The CLI's validator only knows draft-07, so emit that and drop the $schema tag. */
function cliSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

interface CliJson {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export function parseResult(req: LlmRequest, res: CliResult): LlmResponse {
  const empty = { input_tokens: 0, output_tokens: 0 };
  let parsed: CliJson;
  try {
    parsed = JSON.parse(res.stdout) as CliJson;
  } catch {
    const detail = (res.stderr || res.stdout).trim().slice(0, 300);
    return { id: req.id, model: req.model, json: null, complete: false, usage: empty, billedUsd: 0, error: `claude CLI exit ${res.code}: ${detail}` };
  }
  const usage = {
    input_tokens: parsed.usage?.input_tokens ?? 0,
    output_tokens: parsed.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: parsed.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: parsed.usage?.cache_read_input_tokens ?? 0,
  };
  const ok = !parsed.is_error && parsed.subtype === "success" && parsed.structured_output != null;
  return {
    id: req.id,
    model: req.model,
    json: parsed.structured_output ?? null,
    complete: ok,
    usage,
    // Covered by the subscription; the API-rate equivalent is still logged as list_cost_usd.
    billedUsd: 0,
    error: ok ? undefined : `claude CLI ${parsed.subtype ?? "error"}: ${(parsed.result ?? "").slice(0, 300)}`,
  };
}

function spawnRunner(bin: string, timeoutMs: number): CliRunner {
  return (args, stdin, cwd) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, code }));
      child.stdin.end(stdin);
    });
}
