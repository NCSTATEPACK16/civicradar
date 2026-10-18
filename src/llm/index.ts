import type { LlmConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCodeProvider } from "./claudeCode.js";
import type { LlmProvider } from "./provider.js";

export { extract } from "./extract.js";
export type { DocMeta, ExtractInput, ExtractResult } from "./extract.js";

export function createProvider(cfg: LlmConfig): LlmProvider {
  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicProvider();
    case "claude-code":
      return new ClaudeCodeProvider();
    default:
      throw new Error(`unknown LLM provider "${cfg.provider}"`);
  }
}
