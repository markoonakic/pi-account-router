import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";

export type LiveRegistryModel = Model<Api>;

export interface LiveModelRegistryReader {
  getAll(): LiveRegistryModel[];
  getApiKeyAndHeaders(model: LiveRegistryModel): Promise<{
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

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== "authorization"),
  );

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function cloneCompat(model: LiveRegistryModel): LiveRegistryModel["compat"] | undefined {
  return model.compat === undefined ? undefined : structuredClone(model.compat);
}

export async function cloneLiveRegistryModels(
  modelRegistry: LiveModelRegistryReader,
  sourceProvider: string,
  targetProvider: string,
): Promise<LiveRegistryModel[]> {
  const sourceModels = getLiveProviderModels(modelRegistry, sourceProvider);

  return Promise.all(
    sourceModels.map(async (sourceModel) => {
      const auth = await modelRegistry.getApiKeyAndHeaders(sourceModel);
      const headers = sanitizeHeaders(auth.ok ? auth.headers ?? sourceModel.headers : sourceModel.headers);
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
    }),
  );
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
