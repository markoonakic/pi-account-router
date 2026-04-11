import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { buildAccountCatalog, type AccountCatalogEntry } from "./accounts/catalog.js";
import { ADAPTERS } from "./adapters/index.js";
import type { AccountSnapshot, ProviderFamilyId } from "./adapters/types.js";
import { discoverAccounts } from "./auth/discovery.js";
import { addAccountAndLogin } from "./auth/login.js";
import { registerAccountRouterCommand } from "./commands/account-router.js";
import { loadAccountRouterSettings } from "./config/store.js";
import { getFamilyForProviderName } from "./providers/families.js";
import { syncProviders } from "./providers/register.js";
import { selectAccountForFamily } from "./routing/router.js";
import { createFamilyRouterStream } from "./routing/stream.js";
import { createRuntimeStore } from "./runtime/store.js";
import { formatAccountRow, renderFooter } from "./status/footer.js";

const EMPTY_STATUS_TEXT = "No routed accounts discovered";

function getCapabilityBadges(family: ProviderFamilyId): string[] {
  const capabilities = ADAPTERS[family].capabilities;
  return [
    capabilities.usage ? "usage" : undefined,
    capabilities.silentFailover ? "silent failover" : undefined,
    capabilities.nativeLogin ? "native login" : undefined,
    capabilities.reauth ? "reauth" : undefined,
    capabilities.experimental ? "experimental" : undefined,
  ].filter((value): value is string => value !== undefined);
}

function getDisplayName(entry: { family: ProviderFamilyId; aliasIndex: number }): string {
  const displayName = ADAPTERS[entry.family].displayName;
  return entry.aliasIndex > 1 ? `${displayName} #${entry.aliasIndex}` : displayName;
}

export function installAccountRouter(
  pi: Pick<ExtensionAPI, "registerCommand" | "registerProvider" | "on">,
): void {
  const store = createRuntimeStore();
  let snapshots: Record<string, AccountSnapshot | undefined> = {};

  function buildCatalog(): Array<AccountCatalogEntry & { displayName: string }> {
    return buildAccountCatalog(store.getAccounts(), store.getState(), snapshots).map((entry) => ({
      ...entry,
      displayName: getDisplayName(entry),
    }));
  }

  function getStatusText(): string {
    const rows = buildCatalog().map((entry) => formatAccountRow(entry));
    return rows.join("\n") || EMPTY_STATUS_TEXT;
  }

  function getFooterEntry(ctx: ExtensionContext, catalog: Array<AccountCatalogEntry & { displayName: string }>) {
    const currentFamily = ctx.model ? getFamilyForProviderName(ctx.model.provider) : undefined;

    if (currentFamily !== undefined) {
      const activeInFamily = catalog.find((entry) => entry.family === currentFamily && entry.active);
      if (activeInFamily !== undefined) {
        return activeInFamily;
      }

      const firstInFamily = catalog.find((entry) => entry.family === currentFamily);
      if (firstInFamily !== undefined) {
        return firstInFamily;
      }
    }

    return catalog.find((entry) => entry.active) ?? catalog[0];
  }

  async function buildSnapshots(ctx: ExtensionContext): Promise<Record<string, AccountSnapshot | undefined>> {
    const nextSnapshots: Record<string, AccountSnapshot | undefined> = {};

    for (const account of store.getAccounts()) {
      const adapter = ADAPTERS[account.family];
      const capabilityBadges = getCapabilityBadges(account.family);

      if (adapter.createSnapshot === undefined) {
        nextSnapshots[account.providerName] = {
          summary: "",
          details: [],
          score: 0,
          badges: capabilityBadges,
        };
        continue;
      }

      try {
        const snapshot = await adapter.createSnapshot(
          {
            providerName: account.providerName,
            auth: ctx.modelRegistry.authStorage.get(account.providerName),
          },
          ctx.signal,
        );

        nextSnapshots[account.providerName] = snapshot === undefined
          ? {
              summary: "",
              details: [],
              score: 0,
              badges: capabilityBadges,
            }
          : {
              ...snapshot,
              badges: Array.from(new Set([...capabilityBadges, ...snapshot.badges])),
            };
      } catch {
        nextSnapshots[account.providerName] = {
          summary: "",
          details: [],
          score: 0,
          badges: capabilityBadges,
        };
      }
    }

    return nextSnapshots;
  }

  function refreshActiveSelections(): void {
    const scoreByProvider = Object.fromEntries(
      Object.entries(snapshots).map(([providerName, snapshot]) => [providerName, snapshot?.score ?? 0]),
    );

    for (const family of Object.keys(ADAPTERS) as ProviderFamilyId[]) {
      const selectedProvider = selectAccountForFamily(family, store.getAccounts(), store.getState(), scoreByProvider);
      store.setActiveProvider(family, selectedProvider);
    }
  }

  async function refreshFromContext(ctx: ExtensionContext): Promise<Array<AccountCatalogEntry & { displayName: string }>> {
    store.bindModelRegistry(ctx.modelRegistry);
    store.replaceAccounts(discoverAccounts(ctx.modelRegistry.authStorage));
    snapshots = await buildSnapshots(ctx);
    refreshActiveSelections();

    await syncProviders({
      pi,
      modelRegistry: ctx.modelRegistry,
      adapters: ADAPTERS,
      discoveredProviderNames: store.getAccounts().map((account) => account.providerName),
      createStream: (family) => createFamilyRouterStream(store, family, ADAPTERS),
    });

    const catalog = buildCatalog();
    const settings = loadAccountRouterSettings(ctx.cwd);
    ctx.ui.setStatus("account-router", settings.showFooter ? renderFooter(getFooterEntry(ctx, catalog)) : undefined);
    return catalog;
  }

  registerAccountRouterCommand(pi, {
    async listAccounts(ctx: ExtensionCommandContext) {
      return refreshFromContext(ctx);
    },
    async addAccount(family: ProviderFamilyId, ctx: ExtensionCommandContext) {
      await addAccountAndLogin({
        family,
        existingProviderNames: store.getAccounts().map((account) => account.providerName),
        adapter: ADAPTERS[family],
        ctx,
        pi,
      });
      await refreshFromContext(ctx);
    },
    pinAccount(providerName: string) {
      const account = store.getAccounts().find((entry) => entry.providerName === providerName);
      if (account === undefined) {
        return;
      }

      store.setPinnedProvider(account.family, providerName);
      store.setActiveProvider(account.family, providerName);
    },
    unpin(family?: ProviderFamilyId) {
      if (family !== undefined) {
        store.setPinnedProvider(family, undefined);
        return;
      }

      for (const familyId of Object.keys(ADAPTERS) as ProviderFamilyId[]) {
        store.setPinnedProvider(familyId, undefined);
      }
    },
    async refresh(ctx: ExtensionCommandContext) {
      await refreshFromContext(ctx);
    },
    statusText() {
      return getStatusText();
    },
    debugText() {
      return JSON.stringify(
        {
          accounts: store.getAccounts(),
          state: store.getState(),
          snapshots,
        },
        null,
        2,
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await refreshFromContext(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await refreshFromContext(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshFromContext(ctx);
  });
}
