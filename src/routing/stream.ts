import {
  createAssistantMessageEventStream,
  getApiProvider,
  type Api,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";

import type { ProviderAdapter, ProviderFamilyId } from "../adapters/types.js";
import type { RuntimeStore } from "../runtime/store.js";
import { applyRetryFailure } from "./failover.js";
import { selectAccountForFamily } from "./router.js";

function createUnavailableError(family: ProviderFamilyId, model: Model<Api>): AssistantMessageEvent {
  return {
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
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
      stopReason: "error",
      errorMessage: `No eligible ${family} account available`,
      timestamp: Date.now(),
    },
  };
}

function createThrownError(error: unknown, model: Model<Api>): AssistantMessageEvent {
  return {
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
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
      stopReason: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    },
  };
}

function hasVisibleOutputStarted(event: AssistantMessageEvent): boolean {
  return event.type !== "start" && event.type !== "done" && event.type !== "error";
}

export function createFamilyRouterStream(
  store: RuntimeStore,
  family: ProviderFamilyId,
  adapters: Partial<Record<ProviderFamilyId, ProviderAdapter>>,
  getProvider: typeof getApiProvider = getApiProvider,
): (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    void (async () => {
      const adapter = adapters[family];
      const triedProviders = new Set<string>();

      while (true) {
        const registry = store.getModelRegistry();
        const selectedProvider = selectAccountForFamily(family, store.getAccounts(), store.getState());

        if (!selectedProvider || triedProviders.has(selectedProvider)) {
          stream.push(createUnavailableError(family, model));
          return;
        }

        triedProviders.add(selectedProvider);

        const actualModel = registry.find(selectedProvider, model.id);
        if (!actualModel) {
          stream.push(createUnavailableError(family, model));
          return;
        }

        const auth = await registry.getApiKeyAndHeaders(actualModel);
        if (!auth.ok) {
          store.markNeedsReauth(selectedProvider, true);
          continue;
        }

        const apiProvider = getProvider(actualModel.api);
        if (!apiProvider?.streamSimple) {
          throw new Error(`Missing stream provider for api ${actualModel.api}`);
        }

        const routedModel: Model<Api> = {
          ...actualModel,
          ...(actualModel.headers || auth.headers
            ? {
                headers: {
                  ...(actualModel.headers ?? {}),
                  ...(auth.headers ?? {}),
                },
              }
            : {}),
        };
        const providerOptions: SimpleStreamOptions = {
          ...options,
          ...(auth.apiKey !== undefined ? { apiKey: auth.apiKey } : {}),
          ...(auth.headers || options?.headers
            ? {
                headers: {
                  ...(auth.headers ?? {}),
                  ...(options?.headers ?? {}),
                },
              }
            : {}),
        };
        const inner = apiProvider.streamSimple(routedModel, context, providerOptions);

        let visibleOutputStarted = false;
        let retryWithNextProvider = false;

        for await (const event of inner) {
          if (hasVisibleOutputStarted(event)) {
            visibleOutputStarted = true;
          }

          if (event.type === "error") {
            const disposition = adapter?.classifyRetry?.(event.error.errorMessage ?? "") ?? {
              action: "surface",
              reason: "other" as const,
            };

            if (!visibleOutputStarted && disposition.action === "retry") {
              applyRetryFailure(store, family, selectedProvider, disposition);
              retryWithNextProvider = true;
              break;
            }

            stream.push(event);
            return;
          }

          stream.push(event);

          if (event.type === "done") {
            store.setActiveProvider(family, selectedProvider);
            return;
          }
        }

        if (retryWithNextProvider) {
          continue;
        }

        stream.push(createUnavailableError(family, model));
        return;
      }
    })().catch((error) => {
      stream.push(createThrownError(error, model));
    });

    return stream;
  };
}
