import { describe, expect, it, vi } from "vitest";

import { classifyCodexRetry } from "../../src/adapters/codex/classify.js";
import { createRuntimeStore } from "../../src/runtime/store.js";
import { syncProviders } from "../../src/providers/register.js";
import { createFamilyRouterStream } from "../../src/routing/stream.js";

function createModel(provider: string, api = "openai-codex-responses") {
  return {
    provider,
    id: "gpt-5.4",
    name: "GPT-5.4",
    api,
    baseUrl: `https://example.test/${provider}`,
    headers: {
      "x-model-provider": provider,
    },
    input: ["text"],
    reasoning: true,
    cost: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 1_050_000,
    maxTokens: 32_768,
  } as any;
}

function createMessage(provider: string, options?: { stopReason?: "stop" | "error" | "aborted"; errorMessage?: string }) {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider,
    model: "gpt-5.4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: options?.stopReason ?? "stop",
    ...(options?.errorMessage ? { errorMessage: options.errorMessage } : {}),
    timestamp: Date.now(),
  } as any;
}

function createCodexAdapter() {
  return {
    family: "openai-codex",
    displayName: "Codex",
    capabilities: {
      usage: true,
      silentFailover: true,
      nativeLogin: true,
      reauth: true,
      experimental: false,
    },
    buildAliasOAuth(index: number) {
      return {
        name: `Codex #${index}`,
        async login() {
          return { access: "token", refresh: "refresh", expires: 0 };
        },
        async refreshToken(credentials: unknown) {
          return credentials;
        },
        getApiKey(credentials: any) {
          return credentials.access;
        },
      };
    },
    classifyRetry: classifyCodexRetry,
  } as any;
}

describe("family router stream", () => {
  it("delegates pinned-family traffic to the pinned alias model and persists it as active", async () => {
    const store = createRuntimeStore();
    store.replaceAccounts([
      { family: "openai-codex", providerName: "openai-codex", aliasIndex: 1, authenticated: true, authType: "oauth" },
      { family: "openai-codex", providerName: "openai-codex-2", aliasIndex: 2, authenticated: true, authType: "oauth" },
    ] as any);
    store.setPinnedProvider("openai-codex", "openai-codex-2");

    const find = vi.fn((provider: string, id: string) => ({ ...createModel(provider), id }));
    const getApiKeyAndHeaders = vi.fn(async (model: any) => ({
      ok: true,
      apiKey: `token-for-${model.provider}`,
      headers: {
        Authorization: `Bearer ${model.provider}`,
        "x-auth-provider": model.provider,
      },
    }));

    store.bindModelRegistry({
      find,
      getApiKeyAndHeaders,
    } as any);

    const streamSimple = vi.fn((model: any, _context: any, options: any) =>
      (async function* () {
        expect(model.provider).toBe("openai-codex-2");
        expect(model.headers).toMatchObject({
          "x-model-provider": "openai-codex-2",
          Authorization: "Bearer openai-codex-2",
          "x-auth-provider": "openai-codex-2",
        });
        expect(options).toMatchObject({
          apiKey: "token-for-openai-codex-2",
          headers: {
            Authorization: "Bearer openai-codex-2",
            "x-auth-provider": "openai-codex-2",
            "x-client": "from-options",
          },
        });

        yield {
          type: "done",
          reason: "stop",
          message: createMessage(model.provider),
        } as any;
      })(),
    );
    const getProvider = vi.fn(() => ({ streamSimple }) as any);

    const stream = createFamilyRouterStream(store, "openai-codex", { "openai-codex": createCodexAdapter() }, getProvider);

    const events = [] as any[];
    for await (const event of stream(
      { provider: "openai-codex", id: "gpt-5.4" } as any,
      { messages: [] } as any,
      {
        headers: {
          Authorization: "Bearer stale-token",
          "x-client": "from-options",
        },
      } as any,
    )) {
      events.push(event);
    }

    expect(find).toHaveBeenCalledWith("openai-codex-2", "gpt-5.4");
    expect(getApiKeyAndHeaders).toHaveBeenCalledTimes(1);
    expect(getProvider).toHaveBeenCalledWith("openai-codex-responses");
    expect(events).toMatchObject([
      {
        type: "done",
        message: { provider: "openai-codex" },
      },
    ]);
    expect(store.getState().activeByFamily).toMatchObject({ "openai-codex": "openai-codex-2" });
  });

  it("skips providers that cannot resolve the requested model and falls back to the next eligible account", async () => {
    const store = createRuntimeStore();
    store.replaceAccounts([
      { family: "openai-codex", providerName: "openai-codex", aliasIndex: 1, authenticated: true, authType: "oauth" },
      { family: "openai-codex", providerName: "openai-codex-2", aliasIndex: 2, authenticated: true, authType: "oauth" },
    ] as any);
    store.setPinnedProvider("openai-codex", "openai-codex-2");

    const find = vi.fn((provider: string, id: string) => {
      if (provider === "openai-codex-2") {
        return undefined;
      }

      return { ...createModel(provider), id };
    });

    store.bindModelRegistry({
      find,
      getApiKeyAndHeaders: async (model: any) => ({ ok: true, apiKey: `token-${model.provider}`, headers: {} }),
    } as any);

    const attempts: string[] = [];
    const streamSimple = vi.fn((model: any) =>
      (async function* () {
        attempts.push(model.provider);
        yield {
          type: "done",
          reason: "stop",
          message: createMessage(model.provider),
        } as any;
      })(),
    );

    const stream = createFamilyRouterStream(
      store,
      "openai-codex",
      { "openai-codex": createCodexAdapter() },
      () => ({ streamSimple }) as any,
    );

    const events = [] as any[];
    for await (const event of stream({ provider: "openai-codex", id: "gpt-5.4" } as any, { messages: [] } as any)) {
      events.push(event);
    }

    expect(find).toHaveBeenCalledWith("openai-codex-2", "gpt-5.4");
    expect(find).toHaveBeenCalledWith("openai-codex", "gpt-5.4");
    expect(attempts).toEqual(["openai-codex"]);
    expect(events).toMatchObject([
      {
        type: "done",
        message: { provider: "openai-codex" },
      },
    ]);
    expect(store.getState().activeByFamily).toMatchObject({ "openai-codex": "openai-codex" });
  });

  it("marks OAuth accounts for reauth when request auth resolves without an API key", async () => {
    const store = createRuntimeStore();
    store.replaceAccounts([
      { family: "openai-codex", providerName: "openai-codex", aliasIndex: 1, authenticated: true, authType: "oauth" },
      { family: "openai-codex", providerName: "openai-codex-2", aliasIndex: 2, authenticated: true, authType: "oauth" },
    ] as any);
    store.setPinnedProvider("openai-codex", "openai-codex");

    store.bindModelRegistry({
      find: (provider: string, id: string) => ({ ...createModel(provider), id }),
      getApiKeyAndHeaders: async (model: any) => (
        model.provider === "openai-codex"
          ? { ok: true, headers: {} }
          : { ok: true, apiKey: `token-${model.provider}`, headers: {} }
      ),
      isUsingOAuth: () => true,
    } as any);

    const attempts: string[] = [];
    const streamSimple = vi.fn((model: any) =>
      (async function* () {
        attempts.push(model.provider);
        yield {
          type: "done",
          reason: "stop",
          message: createMessage(model.provider),
        } as any;
      })(),
    );

    const stream = createFamilyRouterStream(
      store,
      "openai-codex",
      { "openai-codex": createCodexAdapter() },
      () => ({ streamSimple }) as any,
    );

    const events = [] as any[];
    for await (const event of stream({ provider: "openai-codex", id: "gpt-5.4" } as any, { messages: [] } as any)) {
      events.push(event);
    }

    expect(attempts).toEqual(["openai-codex-2"]);
    expect(events).toMatchObject([
      {
        type: "done",
        message: { provider: "openai-codex" },
      },
    ]);
    expect(store.getState().needsReauthByProvider).toMatchObject({
      "openai-codex": true,
    });
  });

  it("retries Codex before visible output, switches to the next alias, and finishes successfully", async () => {
    const store = createRuntimeStore();
    store.replaceAccounts([
      { family: "openai-codex", providerName: "openai-codex", aliasIndex: 1, authenticated: true, authType: "oauth" },
      { family: "openai-codex", providerName: "openai-codex-2", aliasIndex: 2, authenticated: true, authType: "oauth" },
    ] as any);
    store.setPinnedProvider("openai-codex", "openai-codex");
    store.bindModelRegistry({
      find: (provider: string, id: string) => ({ ...createModel(provider), id }),
      getApiKeyAndHeaders: async (model: any) => ({ ok: true, apiKey: `token-${model.provider}`, headers: {} }),
    } as any);

    const attempts: string[] = [];
    const streamSimple = vi.fn((model: any) =>
      (async function* () {
        attempts.push(model.provider);

        if (attempts.length === 1) {
          yield {
            type: "error",
            reason: "error",
            error: createMessage(model.provider, {
              stopReason: "error",
              errorMessage: "429 rate limit exceeded",
            }),
          } as any;
          return;
        }

        yield {
          type: "done",
          reason: "stop",
          message: createMessage(model.provider),
        } as any;
      })(),
    );

    const stream = createFamilyRouterStream(
      store,
      "openai-codex",
      { "openai-codex": createCodexAdapter() },
      () => ({ streamSimple }) as any,
    );

    const events = [] as any[];
    for await (const event of stream({ provider: "openai-codex", id: "gpt-5.4" } as any, { messages: [] } as any)) {
      events.push(event);
    }

    expect(attempts).toEqual(["openai-codex", "openai-codex-2"]);
    expect(events).toMatchObject([
      {
        type: "done",
        message: { provider: "openai-codex" },
      },
    ]);
    expect(store.getState()).toMatchObject({
      activeByFamily: {
        "openai-codex": "openai-codex-2",
      },
      pinnedByFamily: {},
      exhaustedUntilByProvider: {
        "openai-codex": expect.any(Number),
      },
    });
  });

  it("uses snapshot scores when choosing a retry target", async () => {
    const store = createRuntimeStore();
    store.replaceAccounts([
      { family: "openai-codex", providerName: "openai-codex", aliasIndex: 1, authenticated: true, authType: "oauth" },
      { family: "openai-codex", providerName: "openai-codex-2", aliasIndex: 2, authenticated: true, authType: "oauth" },
      { family: "openai-codex", providerName: "openai-codex-3", aliasIndex: 3, authenticated: true, authType: "oauth" },
    ] as any);
    store.setPinnedProvider("openai-codex", "openai-codex");
    store.bindModelRegistry({
      find: (provider: string, id: string) => ({ ...createModel(provider), id }),
      getApiKeyAndHeaders: async (model: any) => ({ ok: true, apiKey: `token-${model.provider}`, headers: {} }),
    } as any);

    const attempts: string[] = [];
    const streamSimple = vi.fn((model: any) =>
      (async function* () {
        attempts.push(model.provider);

        if (attempts.length === 1) {
          yield {
            type: "error",
            reason: "error",
            error: createMessage(model.provider, {
              stopReason: "error",
              errorMessage: "429 rate limit exceeded",
            }),
          } as any;
          return;
        }

        yield {
          type: "done",
          reason: "stop",
          message: createMessage(model.provider),
        } as any;
      })(),
    );

    const stream = createFamilyRouterStream(
      store,
      "openai-codex",
      { "openai-codex": createCodexAdapter() },
      () => ({ streamSimple }) as any,
      undefined,
      () => ({
        "openai-codex": 200,
        "openai-codex-2": 0,
        "openai-codex-3": 150,
      }),
    );

    const events = [] as any[];
    for await (const event of stream({ provider: "openai-codex", id: "gpt-5.4" } as any, { messages: [] } as any)) {
      events.push(event);
    }

    expect(attempts).toEqual(["openai-codex", "openai-codex-3"]);
    expect(events).toMatchObject([
      {
        type: "done",
        message: { provider: "openai-codex" },
      },
    ]);
    expect(store.getState().activeByFamily).toMatchObject({ "openai-codex": "openai-codex-3" });
  });

  it("does not retry after visible output has started and surfaces the error", async () => {
    const store = createRuntimeStore();
    store.replaceAccounts([
      { family: "openai-codex", providerName: "openai-codex", aliasIndex: 1, authenticated: true, authType: "oauth" },
      { family: "openai-codex", providerName: "openai-codex-2", aliasIndex: 2, authenticated: true, authType: "oauth" },
    ] as any);
    store.bindModelRegistry({
      find: (provider: string, id: string) => ({ ...createModel(provider), id }),
      getApiKeyAndHeaders: async (model: any) => ({ ok: true, apiKey: `token-${model.provider}`, headers: {} }),
    } as any);

    const attempts: string[] = [];
    const streamSimple = vi.fn((model: any) =>
      (async function* () {
        attempts.push(model.provider);
        yield {
          type: "start",
          partial: createMessage(model.provider),
        } as any;
        yield {
          type: "text_delta",
          contentIndex: 0,
          delta: "hello",
          partial: {
            ...createMessage(model.provider),
            content: [{ type: "text", text: "hello" }],
          },
        } as any;
        yield {
          type: "error",
          reason: "error",
          error: createMessage(model.provider, {
            stopReason: "error",
            errorMessage: "429 rate limit exceeded",
          }),
        } as any;
      })(),
    );

    const stream = createFamilyRouterStream(
      store,
      "openai-codex",
      { "openai-codex": createCodexAdapter() },
      () => ({ streamSimple }) as any,
    );

    const events = [] as any[];
    for await (const event of stream({ provider: "openai-codex", id: "gpt-5.4" } as any, { messages: [] } as any)) {
      events.push(event);
    }

    expect(attempts).toEqual(["openai-codex"]);
    expect(events).toMatchObject([
      { type: "start" },
      { type: "text_delta", delta: "hello" },
      { type: "error", error: { provider: "openai-codex", errorMessage: "429 rate limit exceeded" } },
    ]);
    expect(events[0].partial.provider).toBe("openai-codex");
    expect(events[1].partial.provider).toBe("openai-codex");
    expect(store.getState()).toMatchObject({
      activeByFamily: {},
      pinnedByFamily: {},
      exhaustedUntilByProvider: {},
      needsReauthByProvider: {},
    });
  });

  it("uses the provided fallback API provider when the base provider has been transparently overridden", async () => {
    const store = createRuntimeStore();
    store.replaceAccounts([
      { family: "openai-codex", providerName: "openai-codex", aliasIndex: 1, authenticated: true, authType: "oauth" },
    ] as any);
    store.bindModelRegistry({
      find: (provider: string, id: string) => ({ ...createModel(provider), id }),
      getApiKeyAndHeaders: async (model: any) => ({ ok: true, apiKey: `token-${model.provider}`, headers: {} }),
    } as any);

    const recursiveProvider = {
      streamSimple: vi.fn(() => {
        throw new Error("recursive provider should not be used");
      }),
    } as any;
    const fallbackProvider = {
      streamSimple: vi.fn((model: any) =>
        (async function* () {
          yield {
            type: "done",
            reason: "stop",
            message: createMessage(model.provider),
          } as any;
        })(),
      ),
    } as any;

    const stream = createFamilyRouterStream(
      store,
      "openai-codex",
      { "openai-codex": createCodexAdapter() },
      () => recursiveProvider,
      () => fallbackProvider,
    );

    const events = [] as any[];
    for await (const event of stream({ provider: "openai-codex", id: "gpt-5.4" } as any, { messages: [] } as any)) {
      events.push(event);
    }

    expect(recursiveProvider.streamSimple).not.toHaveBeenCalled();
    expect(fallbackProvider.streamSimple).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([
      {
        type: "done",
        message: { provider: "openai-codex" },
      },
    ]);
  });

  it("syncs transparent base providers and discovered alias providers for each family", async () => {
    const registerProvider = vi.fn();
    const openaiBaseStream = vi.fn();
    const anthropicBaseStream = vi.fn();
    const buildAliasOAuth = vi.fn((index: number) => ({
      name: `Alias #${index}`,
      async login() {
        return { access: `token-${index}` };
      },
      async refreshToken(credentials: unknown) {
        return credentials;
      },
      getApiKey(credentials: any) {
        return credentials.access;
      },
    }));

    await syncProviders({
      pi: { registerProvider } as any,
      modelRegistry: {
        getAll: () => [createModel("openai-codex"), createModel("anthropic", "anthropic-messages")],
        getApiKeyAndHeaders: async () => ({ ok: true, headers: { "x-live": "true" } }),
      } as any,
      adapters: {
        "openai-codex": { family: "openai-codex", buildAliasOAuth } as any,
        anthropic: { family: "anthropic", buildAliasOAuth } as any,
      },
      discoveredProviderNames: ["openai-codex", "openai-codex-2", "anthropic", "anthropic-3", "unrelated-2"],
      createStream(family: string) {
        return family === "openai-codex" ? (openaiBaseStream as any) : (anthropicBaseStream as any);
      },
    });

    expect(registerProvider).toHaveBeenCalledTimes(4);
    expect(registerProvider.mock.calls.map(([providerName]) => providerName)).toEqual([
      "openai-codex",
      "openai-codex-2",
      "anthropic",
      "anthropic-3",
    ]);
    expect(registerProvider.mock.calls[0]?.[1]).toMatchObject({ streamSimple: openaiBaseStream });
    expect(registerProvider.mock.calls[2]?.[1]).toMatchObject({ streamSimple: anthropicBaseStream });
    expect(buildAliasOAuth).toHaveBeenCalledWith(2);
    expect(buildAliasOAuth).toHaveBeenCalledWith(3);
  });
});
