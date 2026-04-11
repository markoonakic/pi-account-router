import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerAccountRouterCommand } from "./commands/account-router.js";

export function installAccountRouter(pi: Pick<ExtensionAPI, "registerCommand">): void {
  registerAccountRouterCommand(pi, {
    async listAccounts() {
      return [];
    },
    async addAccount() {
      // Full runtime wiring arrives in Task 11.
    },
    pinAccount() {
      // Full runtime wiring arrives in Task 11.
    },
    unpin() {
      // Full runtime wiring arrives in Task 11.
    },
    async refresh() {
      // Full runtime wiring arrives in Task 11.
    },
    statusText() {
      return "pi-account-router scaffold loaded.";
    },
    debugText() {
      return JSON.stringify({ scaffold: true }, null, 2);
    },
  });
}
