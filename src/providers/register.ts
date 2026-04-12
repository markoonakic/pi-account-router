import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";

import type { ProviderAdapter, ProviderFamilyId } from "../adapters/types.js";
import {
  cloneLiveRegistryModels,
  getLiveProviderModels,
  toProviderModelConfigs,
  type LiveModelRegistryReader,
} from "../models/live-registry.js";
import { getAliasIndex, getFamilyForProviderName } from "./families.js";

function getRequiredProviderConfigSource(
  modelRegistry: Pick<LiveModelRegistryReader, "getAll">,
  providerName: string,
) {
  const models = getLiveProviderModels(modelRegistry, providerName);
  const firstModel = models[0];

  if (!firstModel) {
    throw new Error(`No live models found for provider \"${providerName}\".`);
  }

  return { models, firstModel };
}

export async function registerAliasProvider(
  pi: Pick<ExtensionAPI, "registerProvider">,
  modelRegistry: LiveModelRegistryReader,
  adapter: Pick<ProviderAdapter, "family" | "buildAliasOAuth">,
  providerName: string,
): Promise<void> {
  const clonedModels = await cloneLiveRegistryModels(modelRegistry, adapter.family, providerName);
  const firstModel = clonedModels[0];

  if (!firstModel) {
    throw new Error(`No live models found for provider \"${adapter.family}\".`);
  }

  pi.registerProvider(providerName, {
    baseUrl: firstModel.baseUrl,
    api: firstModel.api,
    models: toProviderModelConfigs(clonedModels),
    oauth: adapter.buildAliasOAuth(getAliasIndex(providerName)) as NonNullable<ProviderConfig["oauth"]>,
  });
}

export async function registerTransparentBaseProvider(
  pi: Pick<ExtensionAPI, "registerProvider">,
  modelRegistry: Pick<LiveModelRegistryReader, "getAll">,
  providerName: string,
  streamSimple: NonNullable<ProviderConfig["streamSimple"]>,
): Promise<void> {
  const { firstModel } = getRequiredProviderConfigSource(modelRegistry, providerName);

  pi.registerProvider(providerName, {
    api: firstModel.api,
    // Intentionally omit `models`: Pi keeps the live merged model list for base providers.
    streamSimple,
  });
}

export async function syncProviders(options: {
  pi: Pick<ExtensionAPI, "registerProvider">;
  modelRegistry: LiveModelRegistryReader;
  adapters: Partial<Record<ProviderFamilyId, Pick<ProviderAdapter, "family" | "buildAliasOAuth">>>;
  discoveredProviderNames: string[];
  createStream: (family: ProviderFamilyId) => NonNullable<ProviderConfig["streamSimple"]>;
}): Promise<void> {
  const discoveredProviderNames = [...new Set(options.discoveredProviderNames)];

  for (const adapter of Object.values(options.adapters)) {
    if (!adapter) {
      continue;
    }

    if (getLiveProviderModels(options.modelRegistry, adapter.family).length === 0) {
      continue;
    }

    await registerTransparentBaseProvider(
      options.pi,
      options.modelRegistry,
      adapter.family,
      options.createStream(adapter.family),
    );

    for (const providerName of discoveredProviderNames) {
      if (providerName === adapter.family) {
        continue;
      }

      const discoveredFamily = getFamilyForProviderName(providerName);
      if (discoveredFamily !== adapter.family || getAliasIndex(providerName) <= 1) {
        continue;
      }

      await registerAliasProvider(options.pi, options.modelRegistry, adapter, providerName);
    }
  }
}
