import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, type TUI } from "@mariozechner/pi-tui";

import type { ProviderFamilyId } from "../adapters/types.js";
import { FAMILY_DEFS, getFamilyForProviderName } from "../providers/families.js";
import { formatAccountRow, type FooterAccountEntry } from "../status/footer.js";
import { formatFamilySectionHeader, formatSecondaryGhostLine, resolvePrimaryAccountName } from "../ui/account-display.js";
import { buildAccountPanelShell, type AccountPanelShellModel } from "../ui/account-panel.js";
import { showAddAccountFamilyPicker } from "../ui/account-actions.js";

export interface AccountRouterCommandHost {
  listAccounts(ctx: ExtensionCommandContext): Promise<FooterAccountEntry[]>;
  addAccount(family: ProviderFamilyId, ctx: ExtensionCommandContext): Promise<void>;
  pinAccount(providerName: string): void;
  unpin(family?: ProviderFamilyId): void;
  refresh(ctx: ExtensionCommandContext): Promise<void>;
  renameAccount(providerName: string, ctx: ExtensionCommandContext): Promise<void>;
  showAccountDetails(providerName: string, ctx: ExtensionCommandContext): Promise<void>;
  removeAccount(providerName: string, ctx: ExtensionCommandContext): Promise<void>;
  statusText(): string;
  debugText(): string;
}

type AccountPanelAction =
  | { action: "select"; providerName: string }
  | { action: "refresh" }
  | { action: "rename"; providerName: string }
  | { action: "details"; providerName: string }
  | { action: "add" }
  | { action: "remove"; providerName: string };

interface AccountPanelSectionEntry {
  familyId: string;
  familyDisplayName: string;
  accounts: FooterAccountEntry[];
}

function splitArgs(args: string): string[] {
  const trimmed = args.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

function isProviderFamilyId(value: string): value is ProviderFamilyId {
  return Object.hasOwn(FAMILY_DEFS, value);
}

function getFamilyDisplayName(account: FooterAccountEntry): string {
  const family = getFamilyForProviderName(account.providerName);

  if (account.providerDisplayName) {
    return account.providerDisplayName;
  }

  return family === undefined ? account.displayName ?? account.providerName : FAMILY_DEFS[family].displayName;
}

function getPanelGhostSummary(accounts: readonly FooterAccountEntry[]): string {
  if (accounts.length === 0) {
    return "No routed accounts discovered";
  }

  const familyCounts = new Map<string, number>();
  let needsReauthCount = 0;

  for (const account of accounts) {
    const family = getFamilyForProviderName(account.providerName) ?? account.providerName;
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);

    if (account.needsReauth) {
      needsReauthCount += 1;
    }
  }

  const familyBits = (Object.keys(FAMILY_DEFS) as ProviderFamilyId[])
    .map((family) => {
      const count = familyCounts.get(family);
      if (!count) {
        return undefined;
      }

      const label = family === "openai-codex"
        ? "codex"
        : family === "github-copilot"
          ? "copilot"
          : family === "google-gemini-cli"
            ? "gemini"
            : family === "google-antigravity"
              ? "antigravity"
              : family;
      return `${count} ${label}`;
    })
    .filter((value): value is string => value !== undefined);

  return [
    `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`,
    ...familyBits,
    needsReauthCount > 0 ? `${needsReauthCount} needs reauth` : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
}

function buildPanelSections(accounts: readonly FooterAccountEntry[]): AccountPanelSectionEntry[] {
  const sections = new Map<string, AccountPanelSectionEntry>();

  for (const account of accounts) {
    const family = getFamilyForProviderName(account.providerName);
    const familyId = family ?? account.providerName;
    const familyDisplayName = getFamilyDisplayName(account);
    const existing = sections.get(familyId);

    if (existing) {
      existing.accounts.push(account);
      continue;
    }

    sections.set(familyId, {
      familyId,
      familyDisplayName,
      accounts: [account],
    });
  }

  return [...sections.values()];
}

function buildAccountPanel(accounts: readonly FooterAccountEntry[]): AccountPanelShellModel {
  return buildAccountPanelShell({
    ghostSummary: getPanelGhostSummary(accounts),
    sections: buildPanelSections(accounts).map((section) => ({
      familyId: section.familyId,
      familyTitle: formatFamilySectionHeader({
        providerDisplayName: section.familyDisplayName,
        accountCount: section.accounts.length,
        activeCount: section.accounts.filter((account) => account.active).length,
      }),
      rows: section.accounts.map((account) => ({
        accountId: account.providerName,
        primaryText: account.displayName ?? resolvePrimaryAccountName({
          providerName: account.providerName,
          providerDisplayName: section.familyDisplayName,
          ...(account.label === undefined ? {} : { label: account.label }),
          ...(account.identity === undefined ? {} : { identity: account.identity }),
        }),
        secondaryText: account.secondaryText ?? formatSecondaryGhostLine({
          providerName: account.providerName,
          providerDisplayName: section.familyDisplayName,
          ...(account.summary === undefined ? {} : { summary: account.summary }),
        }),
      })),
    })),
  });
}

function createAccountPanelComponent(
  tui: TUI,
  theme: Theme,
  shell: AccountPanelShellModel,
  done: (result: AccountPanelAction | undefined) => void,
) {
  const rows = shell.sections.flatMap((section) => section.rows.map((row) => ({ section, row })));
  let selectedIndex = rows.length > 0 ? 0 : -1;
  let cachedLines: string[] | undefined;
  let cachedWidth: number | undefined;

  const clearCache = () => {
    cachedLines = undefined;
    cachedWidth = undefined;
  };

  const getSelectedRow = () => (selectedIndex >= 0 ? rows[selectedIndex]?.row : undefined);

  return {
    handleInput(data: string): void {
      if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
        done(undefined);
        return;
      }

      if ((data === "k" || matchesKey(data, "up")) && rows.length > 0) {
        selectedIndex = Math.max(0, selectedIndex - 1);
        clearCache();
        tui.requestRender();
        return;
      }

      if ((data === "j" || matchesKey(data, "down")) && rows.length > 0) {
        selectedIndex = Math.min(rows.length - 1, selectedIndex + 1);
        clearCache();
        tui.requestRender();
        return;
      }

      if (matchesKey(data, "u")) {
        done({ action: "refresh" });
        return;
      }

      if (matchesKey(data, "a")) {
        done({ action: "add" });
        return;
      }

      const selectedRow = getSelectedRow();
      if (selectedRow === undefined) {
        return;
      }

      if (data === "enter" || data === "\r" || data === "\n" || matchesKey(data, "enter") || matchesKey(data, "return")) {
        done({ action: "select", providerName: selectedRow.accountId });
        return;
      }

      if (matchesKey(data, "r")) {
        done({ action: "rename", providerName: selectedRow.accountId });
        return;
      }

      if (matchesKey(data, "d")) {
        done({ action: "details", providerName: selectedRow.accountId });
        return;
      }

      if (matchesKey(data, "backspace")) {
        done({ action: "remove", providerName: selectedRow.accountId });
      }
    },
    render(width: number): string[] {
      if (cachedLines !== undefined && cachedWidth === width) {
        return cachedLines;
      }

      const lines: string[] = [];
      const addLine = (line = "") => {
        lines.push(truncateToWidth(line, width));
      };

      addLine(theme.fg("accent", theme.bold(shell.header.title)));
      addLine(theme.fg("muted", shell.header.ghostSummary));
      addLine(theme.fg("dim", shell.header.hotkeys.map((hotkey) => `${hotkey.key} ${hotkey.label}`).join(" • ")));
      addLine();

      if (rows.length === 0) {
        addLine(theme.fg("warning", "No routed accounts discovered"));
        addLine();
        addLine(theme.fg("dim", "u refresh • esc close"));
        cachedLines = lines;
        cachedWidth = width;
        return lines;
      }

      let rowIndex = 0;
      for (const section of shell.sections) {
        addLine(theme.fg("accent", section.familyTitle));

        for (const row of section.rows) {
          const isSelected = rowIndex === selectedIndex;
          const prefix = isSelected ? theme.fg("accent", "› ") : "  ";
          const primaryText = isSelected ? theme.fg("accent", row.lines.primary) : theme.fg("text", row.lines.primary);

          addLine(`${prefix}${primaryText}`);
          addLine(`  ${theme.fg("muted", row.lines.secondary)}`);
          rowIndex += 1;
        }

        addLine();
      }

      cachedLines = lines;
      cachedWidth = width;
      return lines;
    },
    invalidate(): void {
      clearCache();
    },
  };
}

async function showAccountPanel(
  ctx: ExtensionCommandContext,
  accounts: readonly FooterAccountEntry[],
): Promise<AccountPanelAction | undefined> {
  const shell = buildAccountPanel(accounts);

  return ctx.ui.custom<AccountPanelAction | undefined>((tui, theme, _keybindings, done) =>
    createAccountPanelComponent(tui, theme, shell, done)
  );
}

async function runDefaultCommand(ctx: ExtensionCommandContext, host: AccountRouterCommandHost): Promise<void> {
  let accounts = await host.listAccounts(ctx);

  if (!ctx.hasUI) {
    const rows = accounts.map((account) => formatAccountRow(account));
    ctx.ui.notify(rows.join("\n") || "No routed accounts discovered", "info");
    return;
  }

  while (true) {
    const action = await showAccountPanel(ctx, accounts);

    if (action === undefined) {
      return;
    }

    if (action.action === "select") {
      host.pinAccount(action.providerName);
      ctx.ui.notify(`Pinned ${action.providerName}`, "info");
      return;
    }

    if (action.action === "refresh") {
      accounts = await host.listAccounts(ctx);
      continue;
    }

    if (action.action === "rename") {
      await host.renameAccount(action.providerName, ctx);
      accounts = await host.listAccounts(ctx);
      continue;
    }

    if (action.action === "details") {
      await host.showAccountDetails(action.providerName, ctx);
      accounts = await host.listAccounts(ctx);
      continue;
    }

    if (action.action === "add") {
      const family = await showAddAccountFamilyPicker(
        ctx.ui,
        (Object.keys(FAMILY_DEFS) as ProviderFamilyId[]).map((familyId) => ({
          family: familyId,
          displayName: FAMILY_DEFS[familyId].displayName,
        })),
      );

      if (family !== undefined) {
        await host.addAccount(family, ctx);
      }

      accounts = await host.listAccounts(ctx);
      continue;
    }

    await host.removeAccount(action.providerName, ctx);
    accounts = await host.listAccounts(ctx);
  }
}

export function registerAccountRouterCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  host: AccountRouterCommandHost,
): void {
  pi.registerCommand("account-router", {
    description: "Manage routed provider accounts.",
    async handler(args, ctx) {
      const [subcommand, value] = splitArgs(args);

      if (subcommand === "status") {
        ctx.ui.notify(host.statusText(), "info");
        return;
      }

      if (subcommand === "debug") {
        ctx.ui.notify(host.debugText(), "info");
        return;
      }

      if (subcommand === "add") {
        if (value === undefined) {
          ctx.ui.notify("Usage: /account-router add <family>", "error");
          return;
        }

        if (!isProviderFamilyId(value)) {
          ctx.ui.notify(`Unknown provider family: ${value}`, "error");
          return;
        }

        await host.addAccount(value, ctx);
        return;
      }

      if (subcommand === "use") {
        if (value === undefined) {
          ctx.ui.notify("Usage: /account-router use <provider-or-alias>", "error");
          return;
        }

        host.pinAccount(value);
        ctx.ui.notify(`Pinned ${value}`, "info");
        return;
      }

      if (subcommand === "unpin") {
        if (value !== undefined && !isProviderFamilyId(value)) {
          ctx.ui.notify(`Unknown provider family: ${value}`, "error");
          return;
        }

        host.unpin(value);
        ctx.ui.notify("Cleared manual pin", "info");
        return;
      }

      if (subcommand === "refresh") {
        await host.refresh(ctx);
        ctx.ui.notify("Account router refreshed", "info");
        return;
      }

      if (subcommand !== undefined) {
        ctx.ui.notify(`Unknown subcommand: ${subcommand}`, "error");
        return;
      }

      await runDefaultCommand(ctx, host);
    },
  });
}
