import type { AccountSnapshot } from "../adapters/types.js";
import { ADAPTERS } from "../adapters/index.js";
import type { DiscoveredAccount } from "../auth/discovery.js";
import type { RuntimeState } from "../runtime/store.js";
import { formatSecondaryGhostLine, resolvePrimaryAccountName } from "../ui/account-display.js";

export interface AccountCatalogEntry extends DiscoveredAccount {
  label?: string;
  identity?: string;
  providerDisplayName: string;
  displayName: string;
  secondaryText: string;
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
  labels: Record<string, string> = {},
): AccountCatalogEntry[] {
  const now = Date.now();

  return accounts.map((account) => {
    const snapshot = snapshots[account.providerName];
    const providerDisplayName = ADAPTERS[account.family].displayName;
    const summaryUnavailableText = ADAPTERS[account.family].capabilities.usage ? "usage unavailable" : undefined;
    const label = labels[account.providerName];
    const identity = snapshot?.identity;
    const summary = snapshot?.summary;

    return {
      ...account,
      ...(label === undefined ? {} : { label }),
      ...(identity === undefined ? {} : { identity }),
      providerDisplayName,
      displayName: resolvePrimaryAccountName({
        providerName: account.providerName,
        providerDisplayName,
        ...(label === undefined ? {} : { label }),
        ...(identity === undefined ? {} : { identity }),
      }),
      secondaryText: formatSecondaryGhostLine({
        providerName: account.providerName,
        providerDisplayName,
        ...(summary === undefined ? {} : { summary }),
        ...(summaryUnavailableText === undefined ? {} : { summaryUnavailableText }),
      }),
      active: state.activeByFamily[account.family] === account.providerName,
      pinned: state.pinnedByFamily[account.family] === account.providerName,
      exhausted: (state.exhaustedUntilByProvider[account.providerName] ?? 0) > now,
      needsReauth: Boolean(state.needsReauthByProvider[account.providerName]),
      summary,
      badges: snapshot?.badges ?? [],
    };
  });
}
