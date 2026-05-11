import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

export type LiveRegistryModel = Model<Api>;

export interface LiveModelRegistryReader {
  getAll(): LiveRegistryModel[];
  getApiKeyAndHeaders?(model: LiveRegistryModel): Promise<{
    ok: boolean;
    headers?: Record<string, string>;
  }>;
}

export function getLiveProviderModels(
  modelRegistry: Pick<LiveModelRegistryReader, "getAll">,
  provider: string,
): LiveRegistryModel[] {
  return modelRegistry.getAll().filter((model) => model.provider === provider);
}

function cloneRecord(record: Record<string, string>): Record<string, string> {
  return { ...record };
}

const exactSecretHeaderNames = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
]);

function isSecretLikeHeaderName(key: string): boolean {
  const normalized = key.trim().toLowerCase();

  if (exactSecretHeaderNames.has(normalized)) {
    return true;
  }

  const segments = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  return (
    segments.includes("authorization") ||
    segments.includes("cookie") ||
    segments.includes("token") ||
    segments.includes("secret") ||
    segments.includes("apikey") ||
    (segments.includes("api") && segments.includes("key")) ||
    (segments.includes("auth") && segments.includes("key"))
  );
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized = Object.fromEntries(
    Object.entries(headers).filter(([key]) => !isSecretLikeHeaderName(key)),
  );

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function cloneCompat(model: LiveRegistryModel): LiveRegistryModel["compat"] | undefined {
  return model.compat === undefined ? undefined : structuredClone(model.compat);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMapValue(map: unknown, key: string): unknown {
  return map instanceof Map ? map.get(key) : undefined;
}

function getStaticRequestHeaders(
  modelRegistry: Pick<LiveModelRegistryReader, "getAll">,
  model: LiveRegistryModel,
): Record<string, string> | undefined {
  const registry = modelRegistry as unknown as {
    providerRequestConfigs?: unknown;
    modelRequestHeaders?: unknown;
  };
  const providerConfig = getMapValue(registry.providerRequestConfigs, model.provider);
  const providerHeaders = isRecord(providerConfig) && isRecord(providerConfig.headers)
    ? providerConfig.headers as Record<string, string>
    : undefined;
  const modelHeaders = getMapValue(registry.modelRequestHeaders, `${model.provider}:${model.id}`);

  return model.headers || providerHeaders || isRecord(modelHeaders)
    ? {
        ...(model.headers ?? {}),
        ...(providerHeaders ?? {}),
        ...(isRecord(modelHeaders) ? modelHeaders as Record<string, string> : {}),
      }
    : undefined;
}

export async function cloneLiveRegistryModels(
  modelRegistry: LiveModelRegistryReader,
  sourceProvider: string,
  targetProvider: string,
): Promise<LiveRegistryModel[]> {
  const sourceModels = getLiveProviderModels(modelRegistry, sourceProvider);

  return sourceModels.map((sourceModel) => {
    const headers = sanitizeHeaders(getStaticRequestHeaders(modelRegistry, sourceModel));
    const compat = cloneCompat(sourceModel);

    const clonedModel: LiveRegistryModel = {
      id: sourceModel.id,
      name: sourceModel.name,
      api: sourceModel.api,
      provider: targetProvider,
      baseUrl: sourceModel.baseUrl,
      reasoning: sourceModel.reasoning,
      input: [...sourceModel.input],
      cost: { ...sourceModel.cost },
      contextWindow: sourceModel.contextWindow,
      maxTokens: sourceModel.maxTokens,
      ...(headers !== undefined ? { headers: cloneRecord(headers) } : {}),
      ...(compat !== undefined ? { compat } : {}),
    };

    return clonedModel;
  });
}

export function toProviderModelConfigs(models: ReadonlyArray<LiveRegistryModel>): ProviderModelConfig[] {
  return models.map((model) => {
    const compat = cloneCompat(model);

    const providerModel: ProviderModelConfig = {
      id: model.id,
      name: model.name,
      api: model.api,
      reasoning: model.reasoning,
      input: [...model.input],
      cost: { ...model.cost },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.headers !== undefined ? { headers: cloneRecord(model.headers) } : {}),
      ...(compat !== undefined ? { compat } : {}),
    };

    return providerModel;
  });
}
