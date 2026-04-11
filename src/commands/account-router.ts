import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import type { ProviderFamilyId } from "../adapters/types.js";
import { FAMILY_DEFS } from "../providers/families.js";
import { formatAccountRow, type FooterAccountEntry } from "../status/footer.js";

export interface AccountRouterCommandHost {
  listAccounts(ctx: ExtensionCommandContext): Promise<FooterAccountEntry[]>;
  addAccount(family: ProviderFamilyId, ctx: ExtensionCommandContext): Promise<void>;
  pinAccount(providerName: string): void;
  unpin(family?: ProviderFamilyId): void;
  refresh(ctx: ExtensionCommandContext): Promise<void>;
  statusText(): string;
  debugText(): string;
}

function splitArgs(args: string): string[] {
  const trimmed = args.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

function isProviderFamilyId(value: string): value is ProviderFamilyId {
  return Object.hasOwn(FAMILY_DEFS, value);
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

      const accounts = await host.listAccounts(ctx);
      const rows = accounts.map((account) => ({
        providerName: account.providerName,
        row: formatAccountRow(account),
      }));

      if (!ctx.hasUI) {
        ctx.ui.notify(rows.map((entry) => entry.row).join("\n") || "No routed accounts discovered", "info");
        return;
      }

      const choice = await ctx.ui.select("Account Router", ["status", "refresh", ...rows.map((entry) => entry.row)]);

      if (choice === undefined) {
        return;
      }

      if (choice === "status") {
        ctx.ui.notify(host.statusText(), "info");
        return;
      }

      if (choice === "refresh") {
        await host.refresh(ctx);
        ctx.ui.notify("Account router refreshed", "info");
        return;
      }

      const selectedAccount = rows.find((entry) => entry.row === choice);

      if (selectedAccount !== undefined) {
        host.pinAccount(selectedAccount.providerName);
        ctx.ui.notify(`Pinned ${selectedAccount.providerName}`, "info");
      }
    },
  });
}
