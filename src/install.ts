import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { buildAccountCatalog, type AccountCatalogEntry } from "./accounts/catalog.js";
import { ADAPTERS } from "./adapters/index.js";
import type { AccountSnapshot, ProviderFamilyId } from "./adapters/types.js";
import { getApiProvider, type Api } from "@mariozechner/pi-ai";
import { discoverAccounts } from "./auth/discovery.js";
import { addAccountAndLogin } from "./auth/login.js";
import { registerAccountRouterCommand } from "./commands/account-router.js";
import { loadAccountRouterSettings, saveAccountRouterSettings } from "./config/store.js";
import { getFamilyForProviderName } from "./providers/families.js";
import { syncProviders } from "./providers/register.js";
import { selectAccountForFamily } from "./routing/router.js";
import { createFamilyRouterStream } from "./routing/stream.js";
import { createRuntimeStore } from "./runtime/store.js";
import { formatAccountRow, renderFooter } from "./status/footer.js";
import { confirmAccountRemoval, promptForAccountRename, showAccountDetailsMenu } from "./ui/account-actions.js";

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

export function installAccountRouter(
  pi: Pick<ExtensionAPI, "registerCommand" | "registerProvider" | "on" | "exec">,
): void {
  const store = createRuntimeStore();
  let snapshots: Record<string, AccountSnapshot | undefined> = {};
  let backgroundRefresh: Promise<AccountCatalogEntry[] | void> | undefined;

  function buildCatalog(): AccountCatalogEntry[] {
    const settings = loadAccountRouterSettings();

    return buildAccountCatalog(store.getAccounts(), store.getState(), snapshots, settings.labels);
  }

  function getStatusText(): string {
    const rows = buildCatalog().map((entry) => formatAccountRow(entry));
    return rows.join("\n") || EMPTY_STATUS_TEXT;
  }

  function getFooterEntry(ctx: ExtensionContext, catalog: AccountCatalogEntry[]) {
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

  async function removeAccount(providerName: string, ctx: ExtensionCommandContext): Promise<void> {
    const account = buildCatalog().find((entry) => entry.providerName === providerName);
    const displayName = account?.displayName ?? providerName;
    const confirmed = await confirmAccountRemoval(ctx.ui, { providerName, displayName });

    if (!confirmed) {
      return;
    }

    ctx.modelRegistry.authStorage.remove(providerName);
    ctx.modelRegistry.refresh();

    if (account !== undefined) {
      store.setPinnedProvider(account.family, undefined);
      store.setActiveProvider(account.family, undefined);
    }

    store.clearExhausted(providerName);
    store.markNeedsReauth(providerName, false);

    const settings = loadAccountRouterSettings(ctx.cwd);
    if (Object.hasOwn(settings.labels, providerName)) {
      const labels = { ...settings.labels };
      delete labels[providerName];
      saveAccountRouterSettings(ctx.cwd, {
        ...settings,
        labels,
      });
    }
  }

  async function reauthenticateAccount(providerName: string, ctx: ExtensionCommandContext): Promise<void> {
    await ctx.modelRegistry.authStorage.login(providerName, {
      onAuth: ({ instructions, url }) => {
        ctx.ui.notify(instructions ? `${instructions}\n${url}` : url, "info");
      },
      onPrompt: async (prompt) => {
        const value = prompt.placeholder === undefined
          ? await ctx.ui.input(prompt.message)
          : await ctx.ui.input(prompt.message, prompt.placeholder);

        if (value === undefined) {
          throw new Error("Authentication input cancelled by user");
        }

        return value;
      },
      onManualCodeInput: async () => {
        const value = await ctx.ui.input("Paste the authorization code or full redirect URL:");

        if (value === undefined) {
          throw new Error("Authentication input cancelled by user");
        }

        return value;
      },
      onProgress: (message) => {
        ctx.ui.notify(message, "info");
      },
    });
    ctx.modelRegistry.refresh();
  }

  function updateStatus(ctx: ExtensionContext, catalog: AccountCatalogEntry[]): void {
    const settings = loadAccountRouterSettings(ctx.cwd);
    ctx.ui.setStatus("account-router", settings.showFooter ? renderFooter(getFooterEntry(ctx, catalog)) : undefined);
  }

  function syncAccountsFromContext(ctx: ExtensionContext): AccountCatalogEntry[] {
    store.bindModelRegistry(ctx.modelRegistry);
    store.replaceAccounts(discoverAccounts(ctx.modelRegistry.authStorage));
    refreshActiveSelections();
    return buildCatalog();
  }

  async function refreshFromContext(ctx: ExtensionContext): Promise<AccountCatalogEntry[]> {
    store.bindModelRegistry(ctx.modelRegistry);
    store.replaceAccounts(discoverAccounts(ctx.modelRegistry.authStorage));
    snapshots = await buildSnapshots(ctx);
    refreshActiveSelections();

    const originalApiProviders = new Map<Api, ReturnType<typeof getApiProvider> | undefined>();
    for (const family of Object.keys(ADAPTERS) as ProviderFamilyId[]) {
      const model = ctx.modelRegistry.getAll().find((candidate) => candidate.provider === family);
      if (model && !originalApiProviders.has(model.api)) {
        originalApiProviders.set(model.api, getApiProvider(model.api));
      }
    }
    const getOriginalApiProvider = (api: Api) => originalApiProviders.get(api);

    await syncProviders({
      pi,
      modelRegistry: ctx.modelRegistry,
      adapters: ADAPTERS,
      discoveredProviderNames: store.getAccounts().map((account) => account.providerName),
      createStream: (family) => createFamilyRouterStream(store, family, ADAPTERS, undefined, getOriginalApiProvider),
    });

    const catalog = buildCatalog();
    updateStatus(ctx, catalog);
    return catalog;
  }

  function scheduleBackgroundRefresh(ctx: ExtensionContext): void {
    if (backgroundRefresh !== undefined) {
      return;
    }

    backgroundRefresh = refreshFromContext(ctx)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Account router refresh failed: ${message}`, "error");
      })
      .finally(() => {
        backgroundRefresh = undefined;
      });
  }

  registerAccountRouterCommand(pi, {
    async listAccounts(ctx: ExtensionCommandContext) {
      const catalog = syncAccountsFromContext(ctx);
      updateStatus(ctx, catalog);
      scheduleBackgroundRefresh(ctx);
      return catalog;
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
    async renameAccount(providerName: string, ctx: ExtensionCommandContext) {
      const currentLabel = buildCatalog().find((entry) => entry.providerName === providerName)?.displayName;
      const nextLabel = await promptForAccountRename(ctx.ui, { providerName, currentLabel });

      if (nextLabel === undefined) {
        return;
      }

      const settings = loadAccountRouterSettings(ctx.cwd);
      saveAccountRouterSettings(ctx.cwd, {
        ...settings,
        labels: {
          ...settings.labels,
          [providerName]: nextLabel,
        },
      });
    },
    async showAccountDetails(providerName: string, ctx: ExtensionCommandContext) {
      const snapshot = snapshots[providerName];
      const account = buildCatalog().find((entry) => entry.providerName === providerName);
      const action = await showAccountDetailsMenu(ctx.ui, {
        providerName,
        displayName: account?.displayName ?? providerName,
        summary: snapshot?.summary,
        details: snapshot?.details.length ? snapshot.details : ["No additional details available yet."],
      });

      if (action === "reauth") {
        await reauthenticateAccount(providerName, ctx);
        return;
      }

      if (action === "remove") {
        await removeAccount(providerName, ctx);
        return;
      }

      if (action === "show-provider-key") {
        ctx.ui.notify(providerName, "info");
      }
    },
    async removeAccount(providerName: string, ctx: ExtensionCommandContext) {
      await removeAccount(providerName, ctx);
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
    await refreshFromContext(ctx).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Account router refresh failed: ${message}`, "error");
    });
  });

  pi.on("model_select", async (_event, ctx) => {
    await refreshFromContext(ctx).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Account router refresh failed: ${message}`, "error");
    });
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshFromContext(ctx).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Account router refresh failed: ${message}`, "error");
    });
  });
}
