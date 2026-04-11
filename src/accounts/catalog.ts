import type { AccountSnapshot } from "../adapters/types.js";
import type { DiscoveredAccount } from "../auth/discovery.js";
import type { RuntimeState } from "../runtime/store.js";

export interface AccountCatalogEntry extends DiscoveredAccount {
  active: boolean;
  pinned: boolean;
  exhausted: boolean;
  needsReauth: boolean;
  summary: string | undefined;
  badges: string[];
}

export function buildAccountCatalog(
  accounts: DiscoveredAccount[],
  state: RuntimeState,
  snapshots: Record<string, AccountSnapshot | undefined>,
): AccountCatalogEntry[] {
  const now = Date.now();

  return accounts.map((account) => ({
    ...account,
    active: state.activeByFamily[account.family] === account.providerName,
    pinned: state.pinnedByFamily[account.family] === account.providerName,
    exhausted: (state.exhaustedUntilByProvider[account.providerName] ?? 0) > now,
    needsReauth: Boolean(state.needsReauthByProvider[account.providerName]),
    summary: snapshots[account.providerName]?.summary,
    badges: snapshots[account.providerName]?.badges ?? [],
  }));
}
