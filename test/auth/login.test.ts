import { initTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProviderAdapter } from "../../src/adapters/types.js";
import { addAccountAndLogin } from "../../src/auth/login.js";

describe("addAccountAndLogin", () => {
  it("allocates the next alias, registers it, launches login, opens the browser, and refreshes the registry after login", async () => {
    const lifecycle: string[] = [];
    const notify = vi.fn();
    const input = vi.fn()
      .mockResolvedValueOnce("https://callback.example/?code=from-prompt")
      .mockResolvedValueOnce("https://callback.example/?code=from-manual-input");
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
        const manualValue = await callbacks.onManualCodeInput?.();

        expect(promptValue).toBe("https://callback.example/?code=from-prompt");
        expect(manualValue).toBe("https://callback.example/?code=from-manual-input");
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
    const pi = { registerProvider: vi.fn(), exec: vi.fn().mockResolvedValue(undefined) };
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
    expect(pi.exec).toHaveBeenCalled();
    expect(input).toHaveBeenNthCalledWith(1, "Paste the callback URL:");
    expect(input).toHaveBeenNthCalledWith(2, "Paste redirect URL below, or complete login in browser:");
    expect(notify).toHaveBeenCalledWith("Enter the device code shown in your browser.", "info");
    expect(notify).toHaveBeenCalledWith("Waiting for authentication to complete...", "info");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual([
      "register:openai-codex-3:start",
      "register:openai-codex-3:end",
      "login:openai-codex-3",
      "refresh",
    ]);
  });

  it("uses a native-like custom login dialog when custom UI is available", async () => {
    initTheme();
    const notify = vi.fn();
    const refresh = vi.fn();
    const authStorage = {
      login: vi.fn(async (_providerName: string, callbacks: {
        onAuth: (info: { url: string; instructions?: string }) => void;
        onPrompt: (prompt: { message: string }) => Promise<string>;
        onManualCodeInput?: () => Promise<string>;
        onProgress?: (message: string) => void;
      }) => {
        callbacks.onAuth({ url: "https://auth.example/device", instructions: "Open browser" });
        const manualValue = await callbacks.onManualCodeInput?.();
        expect(manualValue).toBe("https://callback.example/?code=from-dialog");
      }),
    };

    const custom = vi.fn(async (factory: any) => {
      let doneValue: unknown;
      let resolveDone!: (value: unknown) => void;
      const donePromise = new Promise<unknown>((resolve) => {
        resolveDone = resolve;
      });
      const component: any = await factory(
        { requestRender: vi.fn() },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        (value: unknown) => {
          doneValue = value;
          resolveDone(value);
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      component.input.setValue("https://callback.example/?code=from-dialog");
      component.input.onSubmit?.();
      await donePromise;
      return doneValue;
    });
    const pi = { registerProvider: vi.fn(), exec: vi.fn().mockResolvedValue(undefined) };

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
            refresh,
            getAll: vi.fn(() => []),
            getApiKeyAndHeaders: vi.fn(async () => ({ ok: false })),
          },
          ui: { notify, input: vi.fn(), custom: custom as any },
        },
        pi,
      }),
    ).resolves.toBe("openai-codex-2");

    expect(custom).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalledWith("Open browser", "info");
    expect(pi.exec).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to notifying the full URL when the browser cannot be opened automatically", async () => {
    const notify = vi.fn();
    const input = vi.fn().mockResolvedValue("https://callback.example/?code=from-prompt");
    const authStorage = {
      login: vi.fn(async (_providerName: string, callbacks: {
        onAuth: (info: { url: string; instructions?: string }) => void;
        onPrompt: (prompt: { message: string }) => Promise<string>;
        onManualCodeInput?: () => Promise<string>;
      }) => {
        callbacks.onAuth({ url: "https://auth.example/device", instructions: "Open browser" });
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
          ui: { notify, input },
        },
        pi: { registerProvider: vi.fn(), exec: vi.fn().mockRejectedValue(new Error("no browser")) },
      }),
    ).resolves.toBe("openai-codex-2");

    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Could not open a browser automatically/i), "warning");
    expect(notify).toHaveBeenCalledWith("Open browser\nhttps://auth.example/device", "info");
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
        pi: { registerProvider: vi.fn(), exec: vi.fn().mockResolvedValue(undefined) },
      }),
    ).rejects.toThrow("Authentication input cancelled by user");
  });

  it("throws a clear error when the user cancels the manual redirect input", async () => {
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
        pi: { registerProvider: vi.fn(), exec: vi.fn().mockResolvedValue(undefined) },
      }),
    ).rejects.toThrow("Authentication input cancelled by user");
  });
});
