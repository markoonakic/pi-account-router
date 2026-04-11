import { describe, expect, it, vi } from "vitest";

import type { ProviderAdapter } from "../../src/adapters/types.js";
import { addAccountAndLogin } from "../../src/auth/login.js";

describe("addAccountAndLogin", () => {
  it("allocates the next alias, registers it, launches login, and refreshes the registry after login", async () => {
    const lifecycle: string[] = [];
    const notify = vi.fn();
    const input = vi.fn()
      .mockResolvedValueOnce("https://callback.example/?code=from-prompt")
      .mockResolvedValueOnce("manual-code");
    const refresh = vi.fn(() => {
      lifecycle.push("refresh");
    });

    const authStorage = {
      login: vi.fn(async (providerName: string, callbacks: {
        onAuth: (info: { url: string; instructions?: string }) => void;
        onPrompt: (prompt: { message: string }) => Promise<string>;
        onManualCodeInput?: () => Promise<string>;
        onProgress?: (message: string) => void;
      }) => {
        lifecycle.push(`login:${providerName}`);
        callbacks.onAuth({
          url: "https://auth.example/device",
          instructions: "Enter the device code shown in your browser.",
        });
        callbacks.onProgress?.("Waiting for authentication to complete...");

        const promptValue = await callbacks.onPrompt({ message: "Paste the callback URL:" });
        const manualCode = await callbacks.onManualCodeInput?.();

        expect(promptValue).toBe("https://callback.example/?code=from-prompt");
        expect(manualCode).toBe("manual-code");
      }),
    };

    const modelRegistry = {
      authStorage,
      refresh,
      getAll: vi.fn(() => []),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: false })),
    };
    const ctx = {
      modelRegistry,
      ui: {
        notify,
        input,
      },
    };
    const pi = { registerProvider: vi.fn() };
    const adapter: ProviderAdapter = {
      family: "openai-codex",
      displayName: "ChatGPT Plus/Pro (Codex)",
      capabilities: {
        usage: true,
        silentFailover: true,
        nativeLogin: true,
        reauth: true,
        experimental: false,
      },
      buildAliasOAuth: vi.fn((index: number) => ({
        name: `ChatGPT Plus/Pro (Codex) #${index}`,
        async login() {
          return { access: "a", refresh: "r", expires: Date.now() + 60_000 };
        },
        async refreshToken(credentials: unknown) {
          return credentials;
        },
        getApiKey() {
          return "token";
        },
      })),
    };
    const registerAliasProvider = vi.fn(async (...args: unknown[]) => {
      lifecycle.push(`register:${String(args[3])}:start`);
      await Promise.resolve();
      lifecycle.push(`register:${String(args[3])}:end`);
    });

    const aliasProviderName = await addAccountAndLogin({
      family: "openai-codex",
      existingProviderNames: ["openai-codex", "openai-codex-2", "openai-codex-4"],
      adapter,
      registerAliasProvider,
      ctx,
      pi,
    });

    expect(aliasProviderName).toBe("openai-codex-3");
    expect(registerAliasProvider).toHaveBeenCalledWith(pi, modelRegistry, adapter, "openai-codex-3");
    expect(authStorage.login).toHaveBeenCalledWith(
      "openai-codex-3",
      expect.objectContaining({
        onAuth: expect.any(Function),
        onPrompt: expect.any(Function),
        onManualCodeInput: expect.any(Function),
        onProgress: expect.any(Function),
      }),
    );
    expect(input).toHaveBeenNthCalledWith(1, "Paste the callback URL:");
    expect(input).toHaveBeenNthCalledWith(2, "Paste the authorization code or full redirect URL:");
    expect(notify).toHaveBeenNthCalledWith(
      1,
      "Enter the device code shown in your browser.\nhttps://auth.example/device",
      "info",
    );
    expect(notify).toHaveBeenNthCalledWith(2, "Waiting for authentication to complete...", "info");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual([
      "register:openai-codex-3:start",
      "register:openai-codex-3:end",
      "login:openai-codex-3",
      "refresh",
    ]);
  });

  it("notifies with just the auth URL when no instructions are provided", async () => {
    const notify = vi.fn();
    const input = vi.fn().mockResolvedValue("https://callback.example/?code=from-prompt");
    const authStorage = {
      login: vi.fn(async (_providerName: string, callbacks: {
        onAuth: (info: { url: string; instructions?: string }) => void;
        onPrompt: (prompt: { message: string }) => Promise<string>;
      }) => {
        callbacks.onAuth({ url: "https://auth.example/device" });
        await callbacks.onPrompt({ message: "Paste the callback URL:" });
      }),
    };

    await addAccountAndLogin({
      family: "openai-codex",
      existingProviderNames: ["openai-codex"],
      adapter: {
        family: "openai-codex",
        displayName: "ChatGPT Plus/Pro (Codex)",
        capabilities: { usage: true, silentFailover: true, nativeLogin: true, reauth: true, experimental: false },
        buildAliasOAuth: vi.fn(() => ({
          name: "ChatGPT Plus/Pro (Codex) #2",
          async login() {
            return { access: "a", refresh: "r", expires: Date.now() + 60_000 };
          },
          async refreshToken(credentials: unknown) {
            return credentials;
          },
          getApiKey() {
            return "token";
          },
        })),
      },
      registerAliasProvider: vi.fn(async () => {}),
      ctx: {
        modelRegistry: {
          authStorage,
          refresh: vi.fn(),
          getAll: vi.fn(() => []),
          getApiKeyAndHeaders: vi.fn(async () => ({ ok: false })),
        },
        ui: { notify, input },
      },
      pi: { registerProvider: vi.fn() },
    });

    expect(notify).toHaveBeenCalledWith("https://auth.example/device", "info");
  });

  it("throws a clear error when the user cancels prompted input", async () => {
    const authStorage = {
      login: vi.fn(async (_providerName: string, callbacks: {
        onPrompt: (prompt: { message: string }) => Promise<string>;
      }) => {
        await callbacks.onPrompt({ message: "Paste the callback URL:" });
      }),
    };

    await expect(
      addAccountAndLogin({
        family: "openai-codex",
        existingProviderNames: ["openai-codex"],
        adapter: {
          family: "openai-codex",
          displayName: "ChatGPT Plus/Pro (Codex)",
          capabilities: { usage: true, silentFailover: true, nativeLogin: true, reauth: true, experimental: false },
          buildAliasOAuth: vi.fn(() => ({
            name: "ChatGPT Plus/Pro (Codex) #2",
            async login() {
              return { access: "a", refresh: "r", expires: Date.now() + 60_000 };
            },
            async refreshToken(credentials: unknown) {
              return credentials;
            },
            getApiKey() {
              return "token";
            },
          })),
        },
        registerAliasProvider: vi.fn(async () => {}),
        ctx: {
          modelRegistry: {
            authStorage,
            refresh: vi.fn(),
            getAll: vi.fn(() => []),
            getApiKeyAndHeaders: vi.fn(async () => ({ ok: false })),
          },
          ui: { notify: vi.fn(), input: vi.fn().mockResolvedValue(undefined) },
        },
        pi: { registerProvider: vi.fn() },
      }),
    ).rejects.toThrow("Authentication input cancelled by user");
  });

  it("throws a clear error when the user cancels manual code input", async () => {
    const authStorage = {
      login: vi.fn(async (_providerName: string, callbacks: {
        onPrompt: (prompt: { message: string }) => Promise<string>;
        onManualCodeInput?: () => Promise<string>;
      }) => {
        await callbacks.onPrompt({ message: "Paste the callback URL:" });
        await callbacks.onManualCodeInput?.();
      }),
    };

    await expect(
      addAccountAndLogin({
        family: "openai-codex",
        existingProviderNames: ["openai-codex"],
        adapter: {
          family: "openai-codex",
          displayName: "ChatGPT Plus/Pro (Codex)",
          capabilities: { usage: true, silentFailover: true, nativeLogin: true, reauth: true, experimental: false },
          buildAliasOAuth: vi.fn(() => ({
            name: "ChatGPT Plus/Pro (Codex) #2",
            async login() {
              return { access: "a", refresh: "r", expires: Date.now() + 60_000 };
            },
            async refreshToken(credentials: unknown) {
              return credentials;
            },
            getApiKey() {
              return "token";
            },
          })),
        },
        registerAliasProvider: vi.fn(async () => {}),
        ctx: {
          modelRegistry: {
            authStorage,
            refresh: vi.fn(),
            getAll: vi.fn(() => []),
            getApiKeyAndHeaders: vi.fn(async () => ({ ok: false })),
          },
          ui: {
            notify: vi.fn(),
            input: vi.fn().mockResolvedValueOnce("https://callback.example/?code=from-prompt").mockResolvedValueOnce(undefined),
          },
        },
        pi: { registerProvider: vi.fn() },
      }),
    ).rejects.toThrow("Authentication input cancelled by user");
  });
});
