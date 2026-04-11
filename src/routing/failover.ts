import type { ProviderFamilyId } from "../adapters/types.js";
import type { RuntimeStore } from "../runtime/store.js";

export interface RetryFailureDisposition {
  cooldownUntil?: number;
  clearPin?: boolean;
  reason: "quota" | "auth" | "other";
}

export function applyRetryFailure(
  store: RuntimeStore,
  family: ProviderFamilyId,
  providerName: string,
  disposition: RetryFailureDisposition,
): void {
  if (disposition.cooldownUntil !== undefined) {
    store.markExhausted(providerName, disposition.cooldownUntil);
  }

  if (disposition.reason === "auth") {
    store.markNeedsReauth(providerName, true);
  }

  if (disposition.clearPin) {
    store.setPinnedProvider(family, undefined);
  }
}
