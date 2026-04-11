import { describe, expect, it, vi } from "vitest";

import { installAccountRouter } from "../src/install.js";

function createModel(provider: string) {
  return {
    provider,
    id: "gpt-5.4",
    name: "GPT-5.4",
    api: "openai-codex-responses" as const,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_050_000,
    maxTokens: 32_768,
  };
}

describe("installAccountRouter", () => {
  it("syncs providers on session start and registers the base family stream override", async () => {
    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
    const registerCommand = vi.fn();
    const registerProvider = vi.fn();
    const pi = {
      registerCommand,
      registerProvider,
      on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
        handlers.set(event, handler);
      }),
    };

    installAccountRouter(pi as any);

    const modelRegistry = {
      authStorage: {
        getAll: () => ({
          "openai-codex": { type: "oauth", access: "base-access", refresh: "r1", expires: 4_102_444_800_000 },
          "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
        }),
        get: (providerName: string) => ({ type: "oauth", access: `${providerName}-access`, refresh: "r", expires: 4_102_444_800_000 }),
        login: vi.fn(),
      },
      refresh: vi.fn(),
      getAll: () => [createModel("openai-codex")],
      find: vi.fn((provider: string, id: string) => ({ ...createModel(provider), id })),
      getApiKeyAndHeaders: vi.fn(async (model: { provider: string }) => ({
        ok: true,
        apiKey: `token-for-${model.provider}`,
        headers: {
          Authorization: `Bearer ${model.provider}`,
        },
      })),
    };

    const ctx = {
      cwd: process.cwd(),
      modelRegistry,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
      model: createModel("openai-codex"),
      hasUI: true,
    };

    await handlers.get("session_start")?.({}, ctx);

    expect(registerCommand).toHaveBeenCalledWith(
      "account-router",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
    expect(registerProvider).toHaveBeenCalledWith(
      "openai-codex",
      expect.objectContaining({ streamSimple: expect.any(Function), api: "openai-codex-responses" }),
    );
    expect(registerProvider).toHaveBeenCalledWith(
      "openai-codex-2",
      expect.objectContaining({
        api: "openai-codex-responses",
        models: [expect.objectContaining({ id: "gpt-5.4", contextWindow: 1_050_000 })],
      }),
    );
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("account-router", expect.any(String));
  });
});
