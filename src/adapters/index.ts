import { antigravityAdapter } from "./antigravity.js";
import { anthropicAdapter } from "./anthropic.js";
import { createCodexAdapter } from "./codex/index.js";
import { copilotAdapter } from "./copilot.js";
import { geminiCliAdapter } from "./gemini-cli.js";
import type { ProviderAdapter, ProviderFamilyId } from "./types.js";

export { antigravityAdapter } from "./antigravity.js";
export { anthropicAdapter } from "./anthropic.js";
export { createCodexAdapter } from "./codex/index.js";
export { copilotAdapter } from "./copilot.js";
export { geminiCliAdapter } from "./gemini-cli.js";
export type { ProviderAdapter, ProviderFamilyId } from "./types.js";

export const ADAPTERS: Record<ProviderFamilyId, ProviderAdapter> = {
  "openai-codex": createCodexAdapter(),
  anthropic: anthropicAdapter,
  "github-copilot": copilotAdapter,
  "google-gemini-cli": geminiCliAdapter,
  "google-antigravity": antigravityAdapter,
};
