import type { LlmConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import type { LlmProvider } from "./provider.js";

export { extract } from "./extract.js";
export type { DocMeta, ExtractInput, ExtractResult } from "./extract.js";

export function createProvider(cfg: LlmConfig): LlmProvider {
  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicProvider();
    default:
      throw new Error(`unknown LLM provider "${cfg.provider}"`);
  }
}
