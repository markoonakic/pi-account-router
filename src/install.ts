import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function installAccountRouter(pi: Pick<ExtensionAPI, "registerCommand">): void {
  pi.registerCommand("account-router", {
    description: "Manage account routing commands.",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-account-router scaffold loaded.", "info");
    },
  });
}
