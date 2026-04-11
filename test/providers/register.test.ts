import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { createAssistantMessageEventStream, registerBuiltInApiProviders, resetApiProviders, streamSimple } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderAdapter } from "../../src/adapters/types.js";
import { cloneLiveRegistryModels, toProviderModelConfigs } from "../../src/models/live-registry.js";
import { registerAliasProvider, registerTransparentBaseProvider } from "../../src/providers/register.js";

function createRegistryWithCodexOverride() {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-account-router-"));
  const modelsJsonPath = join(tempDir, "models.json");

  writeFileSync(
    modelsJsonPath,
    JSON.stringify(
      {
        providers: {
          "openai-codex": {
            modelOverrides: {
              "gpt-5.4": {
                contextWindow: 1_050_000,
                headers: {
                  "x-live-override": "true",
                },
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );

  return {
    modelRegistry: ModelRegistry.create(AuthStorage.inMemory(), modelsJsonPath),
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

afterEach(() => {
  resetApiProviders();
  registerBuiltInApiProviders();
});

describe("provider registration from the live model registry", () => {
  it("clones live models with merged metadata and converts them into provider model defs", async () => {
    const { modelRegistry, cleanup } = createRegistryWithCodexOverride();

    try {
      const sourceModel = modelRegistry.find("openai-codex", "gpt-5.4");
      expect(sourceModel).toBeDefined();
      expect(sourceModel?.headers).toBeUndefined();
      await expect(modelRegistry.getApiKeyAndHeaders(sourceModel!)).resolves.toMatchObject({
        ok: true,
        headers: {
          "x-live-override": "true",
        },
      });

      const clonedModels = await cloneLiveRegistryModels(modelRegistry, "openai-codex", "openai-codex-2");
      const clonedModel = clonedModels.find((model) => model.id === "gpt-5.4");

      expect(clonedModel).toMatchObject({
        provider: "openai-codex-2",
        id: "gpt-5.4",
        name: sourceModel?.name,
        api: sourceModel?.api,
        baseUrl: sourceModel?.baseUrl,
        reasoning: sourceModel?.reasoning,
        input: sourceModel?.input,
        cost: sourceModel?.cost,
        contextWindow: 1_050_000,
        maxTokens: sourceModel?.maxTokens,
        headers: {
          "x-live-override": "true",
        },
      });

      const providerModels = toProviderModelConfigs(clonedModels);
      const clonedProviderModel = providerModels.find((model) => model.id === "gpt-5.4");

      expect(clonedProviderModel).toMatchObject({
        id: "gpt-5.4",
        name: sourceModel?.name,
        api: sourceModel?.api,
        reasoning: sourceModel?.reasoning,
        input: sourceModel?.input,
        cost: sourceModel?.cost,
        contextWindow: 1_050_000,
        maxTokens: sourceModel?.maxTokens,
        headers: {
          "x-live-override": "true",
        },
      });
      expect(clonedProviderModel).not.toHaveProperty("provider");
      expect(clonedProviderModel).not.toHaveProperty("baseUrl");
    } finally {
      cleanup();
    }
  });

  it("strips secret-like resolved headers while preserving safe live override headers", async () => {
    const { modelRegistry, cleanup } = createRegistryWithCodexOverride();

    try {
      const sourceModel = modelRegistry.find("openai-codex", "gpt-5.4");
      expect(sourceModel).toBeDefined();

      const clonedModels = await cloneLiveRegistryModels(
        {
          getAll: () => [sourceModel!],
          async getApiKeyAndHeaders() {
            return {
              ok: true,
              headers: {
                Authorization: "Bearer secret",
                "Proxy-Authorization": "Basic secret",
                "x-api-key": "secret",
                "api-key": "secret",
                Cookie: "session=secret",
                "Set-Cookie": "session=secret",
                "X-Auth-Token": "secret",
                "x-live-override": "true",
                "x-extra-safe": "kept",
              },
            };
          },
        },
        "openai-codex",
        "openai-codex-2",
      );

      expect(clonedModels).toHaveLength(1);
      expect(clonedModels[0]).toMatchObject({
        provider: "openai-codex-2",
        headers: {
          "x-live-override": "true",
          "x-extra-safe": "kept",
        },
      });
      expect(clonedModels[0]?.headers).not.toHaveProperty("Authorization");
      expect(clonedModels[0]?.headers).not.toHaveProperty("Proxy-Authorization");
      expect(clonedModels[0]?.headers).not.toHaveProperty("x-api-key");
      expect(clonedModels[0]?.headers).not.toHaveProperty("api-key");
      expect(clonedModels[0]?.headers).not.toHaveProperty("Cookie");
      expect(clonedModels[0]?.headers).not.toHaveProperty("Set-Cookie");
      expect(clonedModels[0]?.headers).not.toHaveProperty("X-Auth-Token");
    } finally {
      cleanup();
    }
  });

  it("registers alias providers with cloned live models and the live api", async () => {
    const { modelRegistry, cleanup } = createRegistryWithCodexOverride();
    const oauth = {
      name: "ChatGPT Plus/Pro (Codex) #2",
      async login() {
        return { type: "oauth" };
      },
      async refreshToken(credentials: unknown) {
        return credentials;
      },
      getApiKey() {
        return "token";
      },
    };
    const buildAliasOAuth = vi.fn(() => oauth);
    const registerProvider = vi.fn();
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
      buildAliasOAuth,
    };

    try {
      await registerAliasProvider(
        { registerProvider } as Pick<ExtensionAPI, "registerProvider">,
        modelRegistry,
        adapter,
        "openai-codex-2",
      );

      expect(buildAliasOAuth).toHaveBeenCalledWith(2);
      expect(registerProvider).toHaveBeenCalledTimes(1);

      const [providerName, config] = registerProvider.mock.calls[0] as [string, ProviderConfig];
      const sourceModels = modelRegistry.getAll().filter((model) => model.provider === "openai-codex");
      const aliasModel = config.models?.find((model) => model.id === "gpt-5.4");

      expect(providerName).toBe("openai-codex-2");
      expect(config.api).toBe(sourceModels[0]?.api);
      expect(config.baseUrl).toBe(sourceModels[0]?.baseUrl);
      expect(config.oauth).toBe(oauth);
      expect(config.models).toHaveLength(sourceModels.length);
      expect(aliasModel).toMatchObject({
        id: "gpt-5.4",
        api: sourceModels.find((model) => model.id === "gpt-5.4")?.api,
        contextWindow: 1_050_000,
        headers: {
          "x-live-override": "true",
        },
      });
    } finally {
      cleanup();
    }
  });

  it("registers transparent base providers with a custom stream while preserving live metadata", async () => {
    const { modelRegistry, cleanup } = createRegistryWithCodexOverride();
    const registerProvider = vi.fn((name: string, config: ProviderConfig) => {
      modelRegistry.registerProvider(name, config);
    });
    const customStream = vi.fn(() => {
      const stream = createAssistantMessageEventStream();
      stream.end({ role: "assistant", content: [] } as never);
      return stream;
    });

    try {
      await registerTransparentBaseProvider(
        { registerProvider } as Pick<ExtensionAPI, "registerProvider">,
        modelRegistry,
        "openai-codex",
        customStream,
      );

      expect(registerProvider).toHaveBeenCalledTimes(1);
      const [providerName, config] = registerProvider.mock.calls[0] as [string, ProviderConfig];
      expect(providerName).toBe("openai-codex");
      expect(config.api).toBe(modelRegistry.find("openai-codex", "gpt-5.4")?.api);
      expect(config.streamSimple).toBe(customStream);

      const model = modelRegistry.find("openai-codex", "gpt-5.4");
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(1_050_000);
      await expect(modelRegistry.getApiKeyAndHeaders(model!)).resolves.toMatchObject({
        ok: true,
        headers: {
          "x-live-override": "true",
        },
      });

      const stream = streamSimple(model!, {} as never);
      await expect(stream.result()).resolves.toMatchObject({ role: "assistant", content: [] });
      expect(customStream).toHaveBeenCalledWith(model, expect.anything(), undefined);
    } finally {
      cleanup();
    }
  });
});
