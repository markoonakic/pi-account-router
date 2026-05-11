import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initTheme } from "@earendil-works/pi-coding-agent";
import { ADAPTERS } from "../src/adapters/index.js";
import { loadAccountRouterSettings, saveAccountRouterSettings } from "../src/config/store.js";
import { installAccountRouter } from "../src/install.js";

const tempDirs: string[] = [];

beforeEach(() => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-test-agent-"));
  tempDirs.push(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.splice(0, tempDirs.length);
});

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

function createAuthStorage(initial: Record<string, unknown>) {
  const records = new Map(Object.entries(initial));

  return {
    getAll: () => Object.fromEntries(records),
    get: (providerName: string) => records.get(providerName),
    getApiKey: vi.fn(async (providerName: string) => {
      const credential = records.get(providerName) as { access?: string } | undefined;
      return typeof credential?.access === "string" ? credential.access : undefined;
    }),
    login: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn((providerName: string) => {
      records.delete(providerName);
    }),
  };
}

function createModelRegistry(authStorage: ReturnType<typeof createAuthStorage>) {
  return {
    authStorage,
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
}

const FIVE_HOURS = 5 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubCodexUsageFetchByToken(
  responses: Record<string, { email: string; fiveHourUsedPercent: number; weeklyUsedPercent: number }>,
) {
  const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
    const token = init?.headers?.Authorization?.replace(/^Bearer\s+/, "");
    const response = token === undefined ? undefined : responses[token];

    if (response === undefined) {
      return {
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      };
    }

    return {
      ok: true,
      json: vi.fn().mockResolvedValue({
        email: response.email,
        rate_limit: {
          primary_window: {
            used_percent: response.fiveHourUsedPercent,
            limit_window_seconds: FIVE_HOURS,
            reset_at: 4_102_444_800,
          },
          secondary_window: {
            used_percent: response.weeklyUsedPercent,
            limit_window_seconds: SEVEN_DAYS,
            reset_at: 4_102_444_800,
          },
        },
      }),
    };
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function createContext(modelRegistry: ReturnType<typeof createModelRegistry>, overrides: Record<string, unknown> = {}) {
  const { ui: uiOverrides, ...rest } = overrides;
  const ui = {
    setStatus: vi.fn(),
    notify: vi.fn(),
    select: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(true),
    input: vi.fn().mockResolvedValue(undefined),
    custom: vi.fn().mockResolvedValue(undefined),
    ...((uiOverrides as Record<string, unknown> | undefined) ?? {}),
  };

  return {
    cwd: process.cwd(),
    modelRegistry,
    model: createModel("openai-codex"),
    hasUI: true,
    ...rest,
    ui,
  };
}

describe("installAccountRouter", () => {
  it("pre-registers discovered alias providers during install so session model restore can find them", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    writeFileSync(
      join(agentDir, "auth.json"),
      `${JSON.stringify({
        "openai-codex-5": { type: "oauth", access: "a5", refresh: "r5", expires: 4_102_444_800_000 },
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(agentDir, "models.json"),
      `${JSON.stringify({
        providers: {
          "openai-codex": {
            modelOverrides: {
              "gpt-5.4": {
                contextWindow: 1_050_000,
              },
            },
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const registerProvider = vi.fn();
    const pi = {
      registerCommand: vi.fn(),
      registerProvider,
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    expect(registerProvider).toHaveBeenCalledWith(
      "openai-codex-5",
      expect.objectContaining({
        api: "openai-codex-responses",
        models: expect.arrayContaining([
          expect.objectContaining({ id: "gpt-5.4", contextWindow: 1_050_000 }),
        ]),
      }),
    );
  });

  it("opens the account panel immediately without waiting for slow usage refreshes", async () => {
    const deferred = createDeferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise));

    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "slow-alias", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn().mockResolvedValue(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    const commandPromise = command.handler("", ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);

    deferred.resolve({
      ok: true,
      json: async () => ({
        email: "slow@example.com",
        rate_limit: {
          primary_window: {
            used_percent: 20,
            limit_window_seconds: FIVE_HOURS,
            reset_at: 4_102_444_800,
          },
          secondary_window: {
            used_percent: 35,
            limit_window_seconds: SEVEN_DAYS,
            reset_at: 4_102_444_800,
          },
        },
      }),
    });

    await commandPromise;
  });

  it("reuses the last known account identity immediately after reload while refresh is still running", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    stubCodexUsageFetchByToken({
      "alias-access": {
        email: "work@example.com",
        fiveHourUsedPercent: 20,
        weeklyUsedPercent: 35,
      },
    });

    const firstHandlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
    const firstPi = {
      registerCommand: vi.fn(),
      registerProvider: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
        firstHandlers.set(event, handler);
      }),
    };

    installAccountRouter(firstPi as any);

    const firstAuthStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const firstModelRegistry = createModelRegistry(firstAuthStorage);
    const firstCtx = createContext(firstModelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await firstHandlers.get("session_start")?.({}, firstCtx);

    const deferred = createDeferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise));

    let panelFactory:
      | ((...args: any[]) => any)
      | undefined;
    const secondRegisterCommand = vi.fn();
    const secondPi = {
      registerCommand: secondRegisterCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(secondPi as any);

    const secondAuthStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const secondModelRegistry = createModelRegistry(secondAuthStorage);
    const secondCtx = createContext(secondModelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn().mockImplementation(async (factory) => {
          panelFactory = factory as (...args: any[]) => any;
          return undefined;
        }),
      },
    });

    const [, command] = secondRegisterCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    const commandPromise = command.handler("", secondCtx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panelFactory).toBeTypeOf("function");

    if (panelFactory === undefined) {
      deferred.resolve({ ok: true, json: async () => ({}) });
      await commandPromise;
      return;
    }

    const component = await panelFactory(
      { requestRender: vi.fn() },
      { fg: (_color: string, text: string) => text, bold: (text: string) => text },
      {},
      vi.fn(),
    );

    const lines = component.render(120);

    expect(lines).toContain("› work@example.com");
    expect(lines).toContain("  ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65% · active");

    deferred.resolve({
      ok: true,
      json: async () => ({
        email: "work@example.com",
        rate_limit: {
          primary_window: {
            used_percent: 20,
            limit_window_seconds: FIVE_HOURS,
            reset_at: 4_102_444_800,
          },
          secondary_window: {
            used_percent: 35,
            limit_window_seconds: SEVEN_DAYS,
            reset_at: 4_102_444_800,
          },
        },
      }),
    });

    await commandPromise;
  });

  it("does not consume alias refresh tokens while rebuilding snapshot labels", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      const token = init?.headers?.Authorization?.replace(/^Bearer\s+/, "");
      if (token === "fresh-access") {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            email: "work@example.com",
            rate_limit: {
              primary_window: {
                used_percent: 20,
                limit_window_seconds: FIVE_HOURS,
                reset_at: 4_102_444_800,
              },
              secondary_window: {
                used_percent: 35,
                limit_window_seconds: SEVEN_DAYS,
                reset_at: 4_102_444_800,
              },
            },
          }),
        };
      }

      return {
        ok: false,
        json: vi.fn().mockResolvedValue({
          error: { code: "token_expired" },
        }),
        text: vi.fn().mockResolvedValue('{"error":{"code":"token_expired"}}'),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshTokenSpy = vi.fn(async (credentials: unknown) => {
      const existing = credentials as { accountId?: string };
      return {
        access: "fresh-access",
        refresh: "fresh-refresh",
        expires: Date.now() + 60_000,
        ...(existing.accountId === undefined ? {} : { accountId: existing.accountId }),
      };
    });
    const originalBuildAliasOAuth = ADAPTERS["openai-codex"].buildAliasOAuth;
    ADAPTERS["openai-codex"].buildAliasOAuth = vi.fn((_index: number) => ({
      name: "ChatGPT Codex #2",
      async login() {
        return { access: "fresh-access", refresh: "fresh-refresh", expires: Date.now() + 60_000 };
      },
      refreshToken: refreshTokenSpy,
      getApiKey(credentials: unknown) {
        return (credentials as { access: string }).access;
      },
    })) as any;

    try {
      const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
      const registerCommand = vi.fn();
      const pi = {
        registerCommand,
        registerProvider: vi.fn(),
        on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
          handlers.set(event, handler);
        }),
      };

      installAccountRouter(pi as any);

      const authStorage = createAuthStorage({
        "openai-codex-2": { type: "oauth", access: "expired-access", refresh: "r2", expires: 0, accountId: "acct_123" },
      });
      const modelRegistry = createModelRegistry(authStorage);
      const ctx = createContext(modelRegistry, {
        ui: {
          setStatus: vi.fn(),
          notify: vi.fn(),
        },
      });

      await handlers.get("session_start")?.({}, ctx);

      const [, command] = registerCommand.mock.calls[0] as [
        string,
        { handler: (args: string, ctx: any) => Promise<void> },
      ];
      const textCtx = createContext(modelRegistry, {
        hasUI: false,
        ui: {
          setStatus: vi.fn(),
          notify: vi.fn(),
        },
      });

      await command.handler("status", textCtx);

      expect(refreshTokenSpy).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer expired-access",
          }),
        }),
      );
      expect((textCtx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain("ChatGPT Plus/Pro (Codex)");
      expect((textCtx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).not.toContain("fresh-access");
    } finally {
      ADAPTERS["openai-codex"].buildAliasOAuth = originalBuildAliasOAuth;
    }
  });

  it("keeps the last known snapshot identity when refresh cannot fetch fresh usage data", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      json: vi.fn().mockResolvedValue({
        error: { code: "token_expired" },
      }),
      text: vi.fn().mockResolvedValue('{"error":{"code":"token_expired"}}'),
    })));
    writeFileSync(
      join(agentDir, "pi-account-router-cache.json"),
      `${JSON.stringify({
        snapshots: {
          "openai-codex-2": {
            identity: "work@example.com",
            summary: "5h left 80% | 7d left 65%",
            details: ["5h left 80%", "7d left 65%"],
            score: 145,
            badges: ["usage", "native login"],
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
        handlers.set(event, handler);
      }),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "expired-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await handlers.get("session_start")?.({}, ctx);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];
    const textCtx = createContext(modelRegistry, {
      hasUI: false,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await command.handler("status", textCtx);

    expect((textCtx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain("work@example.com");
    expect((textCtx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain("5h left 80% | 7d left 65%");
  });

  it("does not keep mutating footer status while the account panel is open", async () => {
    const deferred = createDeferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise));

    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    let releasePanel!: () => void;
    const panelPromise = new Promise<undefined>((resolve) => {
      releasePanel = () => resolve(undefined);
    });
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn().mockImplementation(async () => panelPromise),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    const commandPromise = command.handler("", ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);

    deferred.resolve({
      ok: true,
      json: async () => ({
        email: "work@example.com",
        rate_limit: {
          primary_window: {
            used_percent: 20,
            limit_window_seconds: FIVE_HOURS,
            reset_at: 4_102_444_800,
          },
          secondary_window: {
            used_percent: 35,
            limit_window_seconds: SEVEN_DAYS,
            reset_at: 4_102_444_800,
          },
        },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);

    releasePanel();
    await commandPromise;
  });

  it("refreshes only the selected account snapshot when a panel row requests refresh", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      const token = init?.headers?.Authorization?.replace(/^Bearer\s+/, "");
      if (token === "alias-access-2") {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            email: "work@example.com",
            rate_limit: {
              primary_window: {
                used_percent: 20,
                limit_window_seconds: FIVE_HOURS,
                reset_at: 4_102_444_800,
              },
              secondary_window: {
                used_percent: 35,
                limit_window_seconds: SEVEN_DAYS,
                reset_at: 4_102_444_800,
              },
            },
          }),
        };
      }

      return {
        ok: true,
        json: vi.fn().mockResolvedValue({
          email: "person@example.com",
          rate_limit: {
            primary_window: {
              used_percent: 45,
              limit_window_seconds: FIVE_HOURS,
              reset_at: 4_102_444_800,
            },
            secondary_window: {
              used_percent: 58,
              limit_window_seconds: SEVEN_DAYS,
              reset_at: 4_102_444_800,
            },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access-2", refresh: "r2", expires: 4_102_444_800_000 },
      "openai-codex-3": { type: "oauth", access: "alias-access-3", refresh: "r3", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "refresh", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer alias-access-2",
        }),
      }),
    );
  });

  it("catches refresh errors in event handlers instead of breaking the session", async () => {
    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
    const registerCommand = vi.fn();
    const registerProvider = vi.fn(() => {
      throw new Error("provider registration exploded");
    });
    const pi = {
      registerCommand,
      registerProvider,
      on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
        handlers.set(event, handler);
      }),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex": { type: "oauth", access: "base-access", refresh: "r1", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await expect(handlers.get("session_start")?.({}, ctx)).resolves.toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/Account router refresh failed:/),
      "error",
    );
  });

  it("ignores stale event contexts without touching other stale getters", async () => {
    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
    const pi = {
      registerCommand: vi.fn(),
      registerProvider: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
        handlers.set(event, handler);
      }),
    };

    installAccountRouter(pi as any);

    const staleError = new Error("This extension ctx is stale after session replacement or reload.");
    const staleCtx = {
      get modelRegistry() {
        throw staleError;
      },
      get hasUI() {
        throw new Error("hasUI should not be read after a stale context failure");
      },
      get signal() {
        throw new Error("signal should not be read after a stale context failure");
      },
      get ui() {
        throw new Error("ui should not be read after a stale context failure");
      },
    };

    await expect(handlers.get("session_start")?.({}, staleCtx)).resolves.toBeUndefined();
  });

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

    const authStorage = createAuthStorage({
      "openai-codex": { type: "oauth", access: "base-access", refresh: "r1", expires: 4_102_444_800_000 },
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

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

  it("does not resolve base request auth while syncing alias providers on startup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      json: vi.fn().mockResolvedValue({}),
    })));

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

    const authStorage = createAuthStorage({
      "openai-codex": { type: "oauth", access: "expired-base-access", refresh: "already-used", expires: 0 },
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    modelRegistry.getApiKeyAndHeaders.mockRejectedValue(new Error("request auth should not be resolved during startup sync"));
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await handlers.get("session_start")?.({}, ctx);

    expect(modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(registerProvider).toHaveBeenCalledWith(
      "openai-codex-2",
      expect.objectContaining({
        api: "openai-codex-responses",
        models: [expect.objectContaining({ id: "gpt-5.4" })],
      }),
    );
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringMatching(/Account router refresh failed:/), "error");
  });

  it("keeps the session responsive when add-account login fails", async () => {
    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
      exec: vi.fn().mockResolvedValue(undefined),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({});
    authStorage.login.mockRejectedValue(new Error("OpenAI auth failed"));
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue("ChatGPT Plus/Pro (Codex)"),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "add" })
          .mockResolvedValueOnce({ success: false, error: "OpenAI auth failed" })
          .mockResolvedValueOnce(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await expect(command.handler("", ctx)).resolves.toBeUndefined();

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to add account:/),
      "error",
    );
    expect(ctx.ui.custom).toHaveBeenCalledTimes(3);
  });

  it("returns to the router panel when the add-account login dialog is cancelled", async () => {
    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
      exec: vi.fn().mockResolvedValue(undefined),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({});
    const modelRegistry = createModelRegistry(authStorage);
    const listAccounts = vi.fn().mockResolvedValue([]);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue("ChatGPT Plus/Pro (Codex)"),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "add" })
          .mockResolvedValueOnce({ success: false, error: "Authentication input cancelled by user" })
          .mockResolvedValueOnce(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await expect(command.handler("", ctx)).resolves.toBeUndefined();
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringMatching(/Failed to add account:/), "error");
    expect(ctx.ui.custom).toHaveBeenCalledTimes(3);
  });

  it("persists a renamed label and uses it in later account rendering", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    stubCodexUsageFetchByToken({
      "alias-access": {
        email: "work@example.com",
        fiveHourUsedPercent: 20,
        weeklyUsedPercent: 35,
      },
    });

    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const interactiveCtx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        input: vi.fn().mockResolvedValue("Work Pro Codex"),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "rename", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await command.handler("", interactiveCtx);

    expect(interactiveCtx.ui.input).toHaveBeenCalledWith(expect.stringMatching(/rename/i));
    expect(loadAccountRouterSettings({ agentDir }).labels).toEqual({
      "openai-codex-2": "Work Pro Codex",
    });

    const textCtx = createContext(modelRegistry, {
      hasUI: false,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await command.handler("", textCtx);

    const laterRenderedText = (textCtx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(laterRenderedText).toContain("Work Pro Codex — ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65%");
    expect(laterRenderedText).not.toContain("openai-codex-2");
    expect(laterRenderedText).not.toContain("[usage]");
    expect(textCtx.ui.notify).toHaveBeenCalledWith(expect.any(String), "info");
  });

  it("clears an existing label and falls back to identity/provider text", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    stubCodexUsageFetchByToken({
      "alias-access": {
        email: "work@example.com",
        fiveHourUsedPercent: 20,
        weeklyUsedPercent: 35,
      },
    });
    saveAccountRouterSettings({ agentDir }, {
      labels: {
        "openai-codex-2": "Work Pro Codex",
      },
    });

    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const interactiveCtx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        input: vi.fn().mockResolvedValue("   "),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "rename", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await command.handler("", interactiveCtx);

    expect(loadAccountRouterSettings({ agentDir }).labels).toEqual({});

    const textCtx = createContext(modelRegistry, {
      hasUI: false,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await command.handler("", textCtx);

    const laterRenderedText = (textCtx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(laterRenderedText).toContain("work@example.com — ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65%");
    expect(laterRenderedText).not.toContain("Work Pro Codex");
  });

  it("feeds the footer with the human-first name instead of the raw provider key", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    stubCodexUsageFetchByToken({
      "alias-access": {
        email: "work@example.com",
        fiveHourUsedPercent: 20,
        weeklyUsedPercent: 35,
      },
    });
    saveAccountRouterSettings({ agentDir }, {
      showFooter: true,
      labels: {
        "openai-codex-2": "Work Pro Codex",
      },
    });

    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
    const pi = {
      registerCommand: vi.fn(),
      registerProvider: vi.fn(),
      on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
        handlers.set(event, handler);
      }),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await handlers.get("session_start")?.({}, ctx);

    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "account-router",
      "Work Pro Codex | ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65%",
    );
  });

  it("renders grouped family headers with counts and clean provider usage lines in the panel", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    stubCodexUsageFetchByToken({
      "alias-access-2": {
        email: "work@example.com",
        fiveHourUsedPercent: 20,
        weeklyUsedPercent: 35,
      },
      "alias-access-3": {
        email: "person@example.com",
        fiveHourUsedPercent: 45,
        weeklyUsedPercent: 58,
      },
    });
    saveAccountRouterSettings({ agentDir }, {
      labels: {
        "openai-codex-2": "Work Pro Codex",
      },
    });

    let panelFactory:
      | ((...args: any[]) => any)
      | undefined;
    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access-2", refresh: "r2", expires: 4_102_444_800_000 },
      "openai-codex-3": { type: "oauth", access: "alias-access-3", refresh: "r3", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const ctx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn().mockImplementation(async (factory) => {
          panelFactory = factory as (...args: any[]) => any;
          return undefined;
        }),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(panelFactory).toBeTypeOf("function");

    if (panelFactory === undefined) {
      return;
    }

    const component = await panelFactory(
      { requestRender: vi.fn() },
      {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      },
      {},
      vi.fn(),
    );

    const lines = component.render(120);

    expect(lines).toContain("ChatGPT Plus/Pro (Codex) · 2 accounts · 1 active");
    expect(lines).toContain("› Work Pro Codex");
    expect(lines).toContain("  ChatGPT Plus/Pro (Codex) · usage unavailable · active");
  });

  it("dispatches reauth from the account details menu", async () => {
    initTheme();
    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": {
        type: "oauth",
        access: "alias-access",
        refresh: "r2",
        expires: 0,
        accountId: "acct_123",
      },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const interactiveCtx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue("Reauthenticate"),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "details", providerName: "openai-codex-2" })
          .mockImplementationOnce(async (factory) => {
            let doneValue: unknown;
            let resolveDone!: (value: unknown) => void;
            const donePromise = new Promise<unknown>((resolve) => {
              resolveDone = resolve;
            });
            await factory(
              { requestRender: vi.fn() },
              { fg: (_color: string, text: string) => text, bold: (text: string) => text },
              {},
              (value: unknown) => {
                doneValue = value;
                resolveDone(value);
              },
            );
            await donePromise;
            return doneValue;
          })
          .mockResolvedValueOnce(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await command.handler("", interactiveCtx);

    expect(interactiveCtx.ui.select).toHaveBeenCalledWith(
      expect.stringContaining("esc back"),
      expect.arrayContaining(["Reauthenticate", "Remove account", "Show provider key"]),
    );
    const detailsTitle = (interactiveCtx.ui.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(detailsTitle).toContain("Usage unavailable");
    expect(detailsTitle).toContain("Provider key: openai-codex-2");
    expect(detailsTitle).toContain("Auth: oauth");
    expect(detailsTitle).toContain("Account ID: acct_123");
    expect(detailsTitle).toContain("Access token expires: 1970-01-01T00:00:00.000Z (expired)");
    expect(detailsTitle).not.toContain("alias-access");
    expect(detailsTitle).not.toContain("r2");
    expect(authStorage.login).toHaveBeenCalledWith(
      "openai-codex-2",
      expect.objectContaining({
        onAuth: expect.any(Function),
        onPrompt: expect.any(Function),
        onManualCodeInput: expect.any(Function),
        onProgress: expect.any(Function),
        signal: expect.any(Object),
      }),
    );
    expect(interactiveCtx.ui.custom).toHaveBeenCalledTimes(3);
  });

  it("clears a label from the details menu and falls back to the account identity", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-install-"));
    tempDirs.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    stubCodexUsageFetchByToken({
      "alias-access": {
        email: "work@example.com",
        fiveHourUsedPercent: 20,
        weeklyUsedPercent: 35,
      },
    });
    saveAccountRouterSettings({ agentDir }, {
      labels: {
        "openai-codex-2": "Work Pro Codex",
      },
    });

    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const interactiveCtx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue("Clear label"),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "details", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      },
    });

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    await command.handler("", interactiveCtx);

    expect(loadAccountRouterSettings({ agentDir }).labels).toEqual({});

    const textCtx = createContext(modelRegistry, {
      hasUI: false,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await command.handler("", textCtx);

    const laterRenderedText = (textCtx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(laterRenderedText).toContain("work@example.com — ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65%");
    expect(laterRenderedText).not.toContain("Work Pro Codex");
  });

  it("requires confirmation before removing an account and updates later rendering", async () => {
    const registerCommand = vi.fn();
    const pi = {
      registerCommand,
      registerProvider: vi.fn(),
      on: vi.fn(),
    };

    installAccountRouter(pi as any);

    const authStorage = createAuthStorage({
      "openai-codex-2": { type: "oauth", access: "alias-access", refresh: "r2", expires: 4_102_444_800_000 },
    });
    const modelRegistry = createModelRegistry(authStorage);
    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: any) => Promise<void> },
    ];

    const cancelCtx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn().mockResolvedValue(false),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "remove", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      },
    });

    await command.handler("", cancelCtx);

    expect(cancelCtx.ui.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/remove/i),
      expect.stringContaining("openai-codex-2"),
    );
    expect(authStorage.remove).not.toHaveBeenCalled();

    const confirmCtx = createContext(modelRegistry, {
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        confirm: vi.fn().mockResolvedValue(true),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "remove", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      },
    });

    await command.handler("", confirmCtx);

    expect(authStorage.remove).toHaveBeenCalledWith("openai-codex-2");

    const textCtx = createContext(modelRegistry, {
      hasUI: false,
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    });

    await command.handler("", textCtx);

    expect(textCtx.ui.notify).toHaveBeenCalledWith("No routed accounts discovered", "info");
  });
});
