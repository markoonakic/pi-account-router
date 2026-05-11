import { AuthStorage, ModelRegistry, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext, type ProviderConfig } from "@earendil-works/pi-coding-agent";

import { buildAccountCatalog, type AccountCatalogEntry } from "./accounts/catalog.js";
import { ADAPTERS } from "./adapters/index.js";
import type { AccountSnapshot, ProviderFamilyId } from "./adapters/types.js";
import { getApiProvider, type Api } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { discoverAccounts } from "./auth/discovery.js";
import { addAccountAndLogin, loginWithNativeLikeDialog } from "./auth/login.js";
import { registerAccountRouterCommand } from "./commands/account-router.js";
import { loadAccountRouterSnapshotCache, saveAccountRouterSnapshotCache } from "./config/cache.js";
import { loadAccountRouterSettings, saveAccountRouterSettings } from "./config/store.js";
import { getFamilyForProviderName } from "./providers/families.js";
import { syncProviders } from "./providers/register.js";
import { getLiveProviderModels } from "./models/live-registry.js";
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

function isInformativeSnapshot(snapshot: AccountSnapshot | undefined): snapshot is AccountSnapshot {
  if (snapshot === undefined) {
    return false;
  }

  return snapshot.identity !== undefined
    || snapshot.summary.trim().length > 0
    || snapshot.details.length > 0;
}

function mergeSnapshot(
  previous: AccountSnapshot | undefined,
  next: AccountSnapshot | undefined,
  capabilityBadges: string[],
): AccountSnapshot {
  const badges = Array.from(new Set([
    ...capabilityBadges,
    ...(previous?.badges ?? []),
    ...(next?.badges ?? []),
  ]));

  if (!isInformativeSnapshot(next)) {
    if (previous !== undefined) {
      return {
        ...previous,
        badges,
      };
    }

    return {
      summary: "",
      details: [],
      score: 0,
      badges,
    };
  }

  const identity = next.identity ?? previous?.identity;

  return {
    summary: next.summary.trim().length > 0 ? next.summary : previous?.summary ?? "",
    details: next.details.length > 0 ? next.details : previous?.details ?? [],
    score: next.score,
    badges,
    ...(identity === undefined ? {} : { identity }),
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatAccessTokenExpiry(value: unknown, now = Date.now()): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const suffix = value <= now ? " (expired)" : "";
  return `Access token expires: ${new Date(value).toISOString()}${suffix}`;
}

function getSafeAuthDetails(auth: unknown): string[] {
  if (auth === undefined || auth === null || typeof auth !== "object") {
    return ["Auth: unavailable"];
  }

  const credential = auth as { type?: unknown; accountId?: unknown; expires?: unknown };
  const type = nonEmptyString(credential.type);
  const accountId = nonEmptyString(credential.accountId);

  return [
    type === undefined ? undefined : `Auth: ${type}`,
    accountId === undefined ? undefined : `Account ID: ${accountId}`,
    formatAccessTokenExpiry(credential.expires),
  ].filter((value): value is string => value !== undefined);
}

function getAccountDetailsLines(
  providerName: string,
  account: AccountCatalogEntry | undefined,
  snapshot: AccountSnapshot | undefined,
  auth: unknown,
): string[] {
  const snapshotDetails = snapshot?.details.filter((detail) => detail.trim().length > 0) ?? [];
  const hasSummary = snapshot?.summary.trim().length ? true : false;
  const usageUnavailable = account !== undefined
    && ADAPTERS[account.family].capabilities.usage
    && !hasSummary
    && snapshotDetails.length === 0;
  const primaryDetails = snapshotDetails.length > 0
    ? snapshotDetails
    : usageUnavailable
      ? ["Usage unavailable"]
      : ["No additional details available yet."];

  return [
    ...primaryDetails,
    `Provider key: ${providerName}`,
    ...getSafeAuthDetails(auth),
  ];
}

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? process.cwd(), ".pi", "agent");
}

function isContextCancelled(ctx: Partial<Pick<ExtensionContext, "signal">>): boolean {
  try {
    return ctx.signal?.aborted === true;
  } catch (error) {
    if (isStaleContextError(error)) {
      return true;
    }
    throw error;
  }
}

function isStaleContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ctx is stale after session replacement or reload");
}

function safeHasUI(ctx: Pick<ExtensionContext, "hasUI">): boolean {
  try {
    return ctx.hasUI;
  } catch (error) {
    if (isStaleContextError(error)) {
      return false;
    }
    throw error;
  }
}

function cloneStartupProviderModels(sourceProvider: string, targetProvider: string, modelRegistry: ModelRegistry) {
  return getLiveProviderModels(modelRegistry, sourceProvider).map((model) => ({
    id: model.id,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: { ...model.cost },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.headers === undefined ? {} : { headers: { ...model.headers } }),
    ...(model.compat === undefined ? {} : { compat: structuredClone(model.compat) }),
  }));
}

function preRegisterAliasProvidersForSessionRestore(
  pi: Pick<ExtensionAPI, "registerProvider">,
): void {
  try {
    const agentDir = getAgentDir();
    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
    const discoveredAliases = discoverAccounts(authStorage).filter((account) => account.aliasIndex > 1);

    for (const account of discoveredAliases) {
      const sourceModels = getLiveProviderModels(modelRegistry, account.family);
      const firstModel = sourceModels[0];
      if (!firstModel) {
        continue;
      }

      pi.registerProvider(account.providerName, {
        baseUrl: firstModel.baseUrl,
        api: firstModel.api,
        models: cloneStartupProviderModels(account.family, account.providerName, modelRegistry),
        oauth: ADAPTERS[account.family].buildAliasOAuth(account.aliasIndex) as NonNullable<ProviderConfig["oauth"]>,
      });
    }
  } catch {
    // Startup pre-registration is best-effort. Regular session refresh still repairs runtime registration later.
  }
}

export function installAccountRouter(
  pi: Pick<ExtensionAPI, "registerCommand" | "registerProvider" | "on" | "exec">,
): void {
  preRegisterAliasProvidersForSessionRestore(pi);
  const store = createRuntimeStore();
  let snapshots: Record<string, AccountSnapshot | undefined> = loadAccountRouterSnapshotCache().snapshots;
  

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

  async function buildSnapshotForAccount(
    account: ReturnType<typeof store.getAccounts>[number],
    ctx: ExtensionContext,
  ): Promise<AccountSnapshot | undefined> {
    const adapter = ADAPTERS[account.family];
    const capabilityBadges = getCapabilityBadges(account.family);
    const previousSnapshot = snapshots[account.providerName];

    if (adapter.createSnapshot === undefined) {
      return mergeSnapshot(previousSnapshot, undefined, capabilityBadges);
    }

    try {
      const snapshot = await adapter.createSnapshot(
        {
          providerName: account.providerName,
          auth: ctx.modelRegistry.authStorage.get(account.providerName),
        },
        ctx.signal,
      );

      return mergeSnapshot(previousSnapshot, snapshot, capabilityBadges);
    } catch {
      return mergeSnapshot(previousSnapshot, undefined, capabilityBadges);
    }
  }

  async function buildSnapshots(ctx: ExtensionContext): Promise<Record<string, AccountSnapshot | undefined>> {
    const nextSnapshots: Record<string, AccountSnapshot | undefined> = {};

    for (const account of store.getAccounts()) {
      nextSnapshots[account.providerName] = await buildSnapshotForAccount(account, ctx);
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

  function getSnapshotScores(): Record<string, number> {
    return Object.fromEntries(
      Object.entries(snapshots).map(([providerName, snapshot]) => [providerName, snapshot?.score ?? 0]),
    );
  }

  function clearLabel(providerName: string, cwd: string): void {
    const settings = loadAccountRouterSettings(cwd);
    if (!Object.hasOwn(settings.labels, providerName)) {
      return;
    }

    const labels = { ...settings.labels };
    delete labels[providerName];
    saveAccountRouterSettings(cwd, {
      ...settings,
      labels,
    });
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
    clearLabel(providerName, ctx.cwd);
  }

  async function reauthenticateAccount(providerName: string, ctx: ExtensionCommandContext): Promise<void> {
    await loginWithNativeLikeDialog({
      providerName,
      ctx,
      pi,
    });
    ctx.modelRegistry.refresh();
  }

  function updateStatus(ctx: ExtensionContext, catalog: AccountCatalogEntry[]): void {
    if (!safeHasUI(ctx) || isContextCancelled(ctx)) {
      return;
    }

    try {
      const settings = loadAccountRouterSettings(ctx.cwd);
      ctx.ui.setStatus("account-router", settings.showFooter ? renderFooter(getFooterEntry(ctx, catalog)) : undefined);
    } catch (error) {
      if (!isStaleContextError(error)) {
        throw error;
      }
    }
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

    if (isContextCancelled(ctx)) {
      refreshActiveSelections();
      return buildCatalog();
    }

    saveAccountRouterSnapshotCache(undefined, { snapshots });
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
      createStream: (family) => (
        createFamilyRouterStream(store, family, ADAPTERS, undefined, getOriginalApiProvider, getSnapshotScores)
      ),
    });

    const catalog = buildCatalog();
    updateStatus(ctx, catalog);
    return catalog;
  }

  async function refreshFromEventContext(ctx: ExtensionContext): Promise<void> {
    await refreshFromContext(ctx).catch((error) => {
      if (isStaleContextError(error) || isContextCancelled(ctx) || !safeHasUI(ctx)) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      try {
        ctx.ui.notify(`Account router refresh failed: ${message}`, "error");
      } catch (notifyError) {
        if (!isStaleContextError(notifyError)) {
          throw notifyError;
        }
      }
    });
  }

  registerAccountRouterCommand(pi, {
    async listAccounts(ctx: ExtensionCommandContext) {
      const catalog = syncAccountsFromContext(ctx);
      updateStatus(ctx, catalog);

      if (!ctx.hasUI) {
        return refreshFromContext(ctx);
      }

      return catalog;
    },
    async addAccount(family: ProviderFamilyId, ctx: ExtensionCommandContext) {
      try {
        await addAccountAndLogin({
          family,
          existingProviderNames: store.getAccounts().map((account) => account.providerName),
          adapter: ADAPTERS[family],
          ctx,
          pi,
        });
        await refreshFromContext(ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Login cancelled" || message === "Authentication input cancelled by user") {
          return;
        }
        ctx.ui.notify(`Failed to add account: ${message}`, "error");
      }
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
        store.setActiveProvider(family, undefined);
        refreshActiveSelections();
        return;
      }

      for (const familyId of Object.keys(ADAPTERS) as ProviderFamilyId[]) {
        store.setPinnedProvider(familyId, undefined);
        store.setActiveProvider(familyId, undefined);
      }
      refreshActiveSelections();
    },
    async refresh(ctx: ExtensionCommandContext) {
      await refreshFromContext(ctx);
    },
    async refreshAccount(providerName: string, ctx: ExtensionCommandContext) {
      store.bindModelRegistry(ctx.modelRegistry);
      store.replaceAccounts(discoverAccounts(ctx.modelRegistry.authStorage));
      const account = store.getAccounts().find((entry) => entry.providerName === providerName);

      if (account === undefined) {
        await refreshFromContext(ctx);
        return;
      }

      snapshots = {
        ...snapshots,
        [providerName]: await buildSnapshotForAccount(account, ctx),
      };
      saveAccountRouterSnapshotCache(undefined, { snapshots });
      refreshActiveSelections();
      updateStatus(ctx, buildCatalog());
    },
    async renameAccount(providerName: string, ctx: ExtensionCommandContext) {
      const currentLabel = buildCatalog().find((entry) => entry.providerName === providerName)?.label;
      const nextLabel = await promptForAccountRename(ctx.ui, { providerName, currentLabel });

      if (nextLabel === undefined) {
        return;
      }

      const settings = loadAccountRouterSettings(ctx.cwd);
      const labels = { ...settings.labels };

      if (nextLabel === null) {
        delete labels[providerName];
      } else {
        labels[providerName] = nextLabel;
      }

      saveAccountRouterSettings(ctx.cwd, {
        ...settings,
        labels,
      });
    },
    async showAccountDetails(providerName: string, ctx: ExtensionCommandContext) {
      const snapshot = snapshots[providerName];
      const account = buildCatalog().find((entry) => entry.providerName === providerName);
      const auth = ctx.modelRegistry.authStorage.get(providerName);
      const action = await showAccountDetailsMenu(ctx.ui, {
        providerName,
        displayName: account?.displayName ?? providerName,
        summary: snapshot?.summary,
        details: getAccountDetailsLines(providerName, account, snapshot, auth),
        hasLabel: account?.label !== undefined,
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
        return;
      }

      if (action === "clear-label") {
        clearLabel(providerName, ctx.cwd);
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
    await refreshFromEventContext(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await refreshFromEventContext(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!safeHasUI(ctx)) {
      return;
    }

    await refreshFromEventContext(ctx);
  });
}
