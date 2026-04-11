import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function installAccountRouter(pi: Pick<ExtensionAPI, "registerCommand">): void {
  pi.registerCommand("account-router", {
    description: "Manage pi-account-router.",
    handler: async () => undefined,
  });
}
