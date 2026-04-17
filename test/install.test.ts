import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAccountRouterSettings, saveAccountRouterSettings } from "../src/config/store.js";
import { installAccountRouter } from "../src/install.js";

const tempDirs: string[] = [];

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

    expect(interactiveCtx.ui.input).toHaveBeenCalledWith(expect.stringMatching(/rename/i), expect.any(String));
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
    expect(lines).toContain("  ChatGPT Plus/Pro (Codex)");
  });

  it("dispatches reauth from the account details menu", async () => {
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
        select: vi.fn().mockResolvedValue("Reauthenticate"),
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

    expect(interactiveCtx.ui.select).toHaveBeenCalledWith(
      expect.stringContaining("esc back"),
      expect.arrayContaining(["Reauthenticate", "Remove account", "Show provider key"]),
    );
    expect(authStorage.login).toHaveBeenCalledWith(
      "openai-codex-2",
      expect.objectContaining({
        onAuth: expect.any(Function),
        onPrompt: expect.any(Function),
        onManualCodeInput: expect.any(Function),
        onProgress: expect.any(Function),
      }),
    );
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
