import { loginOpenAICodex, refreshOpenAICodexToken } from "@earendil-works/pi-ai/oauth";

import type { ProviderAdapter } from "../types.js";
import { classifyCodexRetry } from "./classify.js";
import { fetchCodexAccountSnapshot } from "./usage.js";

export { classifyCodexRetry } from "./classify.js";
export { buildCodexAccountSnapshot, fetchCodexAccountSnapshot, parseCodexUsage, type ParsedCodexUsage } from "./usage.js";

export function createCodexAdapter(): ProviderAdapter {
  return {
    family: "openai-codex",
    displayName: "ChatGPT Plus/Pro (Codex)",
    capabilities: {
      usage: true,
      silentFailover: true,
      nativeLogin: true,
      reauth: true,
      experimental: false,
    },
    buildAliasOAuth(index: number) {
      return {
        name: `ChatGPT Codex #${index}`,
        usesCallbackServer: true,
        async login(callbacks: unknown) {
          return loginOpenAICodex(callbacks as {
            onAuth: (info: { url: string; instructions?: string }) => void;
            onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
            onProgress?: (message: string) => void;
            onManualCodeInput?: () => Promise<string>;
          });
        },
        async refreshToken(credentials: unknown) {
          const oauthCredentials = credentials as { refresh: string };
          return refreshOpenAICodexToken(oauthCredentials.refresh);
        },
        getApiKey(credentials: unknown) {
          return (credentials as { access: string }).access;
        },
      };
    },
    async createSnapshot(account, signal) {
      return fetchCodexAccountSnapshot(account, signal);
    },
    classifyRetry: classifyCodexRetry,
  };
}
