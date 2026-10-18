import { describe, expect, it } from "vitest";
import { ExtractionResponseSchema } from "../src/schema/civic_action.js";
import { buildArgs, ClaudeCodeProvider, parseResult, type CliRunner } from "../src/llm/claudeCode.js";
import type { LlmRequest } from "../src/llm/provider.js";

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  id: "r1",
  model: "claude-haiku-5-5",
  effort: "low",
  system: "SYSTEM",
  text: "--- page 1 ---\nhello",
  attachments: [],
  schema: ExtractionResponseSchema,
  maxTokens: 1000,
  ...over,
});

const cliJson = (over: object = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: { items: [] },
    usage: { input_tokens: 2, output_tokens: 50, cache_creation_input_tokens: 4000, cache_read_input_tokens: 10 },
    ...over,
  });

describe("claude-code provider", () => {
  it("builds headless args with model, effort, schema and no tools", () => {
    const args = buildArgs(req());
    expect(args.slice(0, 5)).toEqual(["-p", "--model", "claude-haiku-5-5", "--effort", "low"]);
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!);
    expect(schema.properties.items).toBeDefined();
    expect(schema.$schema).toBeUndefined();
  });

  it("allows only Read when PDF pages are attached, and writes them to the cwd", async () => {
    let seen: { args: string[]; stdin: string } | null = null;
    const runner: CliRunner = async (args, stdin) => {
      seen = { args, stdin };
      return { stdout: cliJson(), stderr: "", code: 0 };
    };
    const p = new ClaudeCodeProvider({ runner });
    await p.run([req({ attachments: [{ title: "page 3", pdf: Buffer.from("%PDF") }] })], "sync");
    expect(seen!.args[seen!.args.indexOf("--tools") + 1]).toBe("Read");
    expect(seen!.stdin).toContain("attachment-1.pdf (page 3)");
  });

  it("parses structured output and usage, billing $0", () => {
    const r = parseResult(req(), { stdout: cliJson(), stderr: "", code: 0 });
    expect(r).toMatchObject({ complete: true, json: { items: [] }, billedUsd: 0 });
    expect(r.usage).toEqual({ input_tokens: 2, output_tokens: 50, cache_creation_input_tokens: 4000, cache_read_input_tokens: 10 });
  });

  it("reports CLI errors and non-JSON output as incomplete", () => {
    expect(parseResult(req(), { stdout: cliJson({ is_error: true, subtype: "error_max_turns" }), stderr: "", code: 1 }))
      .toMatchObject({ complete: false, error: expect.stringContaining("error_max_turns") });
    expect(parseResult(req(), { stdout: "Not logged in", stderr: "", code: 1 }))
      .toMatchObject({ complete: false, error: expect.stringContaining("Not logged in") });
  });

  it("rejects batch mode and estimates tokens conservatively", async () => {
    const p = new ClaudeCodeProvider({ runner: async () => ({ stdout: cliJson(), stderr: "", code: 0 }) });
    await expect(p.run([req()], "batch")).rejects.toThrow(/batch/);
    expect(await p.countTokens(req({ text: "x".repeat(3000) }))).toBeGreaterThanOrEqual(1000);
  });
});
