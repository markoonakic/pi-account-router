import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

import type { ProviderFamilyId } from "../adapters/types.js";
import type { DiscoveredAccount } from "../auth/discovery.js";

export interface RuntimeState {
  activeByFamily: Partial<Record<ProviderFamilyId, string>>;
  pinnedByFamily: Partial<Record<ProviderFamilyId, string>>;
  exhaustedUntilByProvider: Record<string, number>;
  needsReauthByProvider: Record<string, boolean>;
}

export function createRuntimeStore() {
  let modelRegistry: ModelRegistry | undefined;
  let accounts: DiscoveredAccount[] = [];

  const state: RuntimeState = {
    activeByFamily: {},
    pinnedByFamily: {},
    exhaustedUntilByProvider: {},
    needsReauthByProvider: {},
  };

  return {
    bindModelRegistry(next: ModelRegistry): void {
      modelRegistry = next;
    },
    getModelRegistry(): ModelRegistry {
      if (modelRegistry === undefined) {
        throw new Error("ModelRegistry not bound yet");
      }

      return modelRegistry;
    },
    replaceAccounts(next: DiscoveredAccount[]): void {
      accounts = [...next];
    },
    getAccounts(): DiscoveredAccount[] {
      return [...accounts];
    },
    getState(): RuntimeState {
      return {
        activeByFamily: { ...state.activeByFamily },
        pinnedByFamily: { ...state.pinnedByFamily },
        exhaustedUntilByProvider: { ...state.exhaustedUntilByProvider },
        needsReauthByProvider: { ...state.needsReauthByProvider },
      };
    },
    setPinnedProvider(family: ProviderFamilyId, providerName?: string): void {
      if (providerName === undefined) {
        delete state.pinnedByFamily[family];
        return;
      }

      state.pinnedByFamily[family] = providerName;
    },
    setActiveProvider(family: ProviderFamilyId, providerName?: string): void {
      if (providerName === undefined) {
        delete state.activeByFamily[family];
        return;
      }

      state.activeByFamily[family] = providerName;
    },
    markExhausted(providerName: string, until: number): void {
      state.exhaustedUntilByProvider[providerName] = until;
    },
    clearExhausted(providerName: string): void {
      delete state.exhaustedUntilByProvider[providerName];
    },
    markNeedsReauth(providerName: string, value: boolean): void {
      if (value) {
        state.needsReauthByProvider[providerName] = true;
        return;
      }

      delete state.needsReauthByProvider[providerName];
    },
  };
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
