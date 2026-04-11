import type { ProviderFamilyId } from "../adapters/types.js";
import type { DiscoveredAccount } from "../auth/discovery.js";
import type { RuntimeState } from "../runtime/store.js";

function isEligible(account: DiscoveredAccount, state: RuntimeState, now: number): boolean {
  return (
    account.authenticated &&
    !state.needsReauthByProvider[account.providerName] &&
    (state.exhaustedUntilByProvider[account.providerName] ?? 0) <= now
  );
}

export function selectAccountForFamily(
  family: ProviderFamilyId,
  accounts: DiscoveredAccount[],
  state: RuntimeState,
  scores: Record<string, number> = {},
): string | undefined {
  const now = Date.now();
  const familyAccounts = accounts.filter((account) => account.family === family && isEligible(account, state, now));

  const pinned = state.pinnedByFamily[family];
  if (pinned !== undefined && familyAccounts.some((account) => account.providerName === pinned)) {
    return pinned;
  }

  const active = state.activeByFamily[family];
  if (active !== undefined && familyAccounts.some((account) => account.providerName === active)) {
    return active;
  }

  return familyAccounts
    .sort((left, right) => {
      const scoreDiff = (scores[right.providerName] ?? 0) - (scores[left.providerName] ?? 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const aliasDiff = left.aliasIndex - right.aliasIndex;
      if (aliasDiff !== 0) {
        return aliasDiff;
      }

      return left.providerName.localeCompare(right.providerName);
    })
    .at(0)?.providerName;
}
