import type { AuthStorage, ExtensionAPI, ExtensionUIContext, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { OAuthAuthInfo, OAuthPrompt } from "@mariozechner/pi-ai";

import type { ProviderAdapter, ProviderFamilyId } from "../adapters/types.js";
import type { LiveModelRegistryReader } from "../models/live-registry.js";
import { getNextAliasProviderName } from "../providers/families.js";
import { registerAliasProvider } from "../providers/register.js";

export interface AddAccountAndLoginContext {
  modelRegistry: LiveModelRegistryReader & {
    authStorage: Pick<AuthStorage, "login">;
    refresh: ModelRegistry["refresh"];
  };
  ui: Pick<ExtensionUIContext, "notify" | "input">;
}

export interface AddAccountAndLoginOptions {
  family: ProviderFamilyId;
  existingProviderNames: string[];
  adapter: ProviderAdapter;
  registerAliasProvider?: typeof registerAliasProvider;
  ctx: AddAccountAndLoginContext;
  pi: Pick<ExtensionAPI, "registerProvider" | "exec">;
}

async function openLoginInBrowser(
  pi: Pick<ExtensionAPI, "exec">,
  ctx: AddAccountAndLoginContext,
  url: string,
): Promise<void> {
  let command: string;
  let args: string[];

  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    await pi.exec(command, args);
  } catch {
    ctx.ui.notify("Could not open a browser automatically. Please open the login URL manually.", "warning");
  }
}

function notifyAuth(ctx: AddAccountAndLoginContext, info: OAuthAuthInfo): void {
  const message = info.instructions ? `${info.instructions}\n${info.url}` : info.url;
  ctx.ui.notify(message, "info");
}

async function promptForRequiredInput(
  ctx: AddAccountAndLoginContext,
  message: string,
  placeholder?: string,
): Promise<string> {
  const value = placeholder === undefined
    ? await ctx.ui.input(message)
    : await ctx.ui.input(message, placeholder);

  if (value === undefined) {
    throw new Error("Authentication input cancelled by user");
  }

  return value;
}

async function promptForText(ctx: AddAccountAndLoginContext, prompt: OAuthPrompt): Promise<string> {
  return promptForRequiredInput(ctx, prompt.message, prompt.placeholder);
}

export async function addAccountAndLogin(options: AddAccountAndLoginOptions): Promise<string> {
  const aliasProviderName = getNextAliasProviderName(options.family, options.existingProviderNames);
  const doRegister = options.registerAliasProvider ?? registerAliasProvider;

  await doRegister(options.pi, options.ctx.modelRegistry, options.adapter, aliasProviderName);

  await options.ctx.modelRegistry.authStorage.login(aliasProviderName, {
    onAuth: (info) => {
      void openLoginInBrowser(options.pi, options.ctx, info.url);
      notifyAuth(options.ctx, info);
    },
    onPrompt: async (prompt) => promptForText(options.ctx, prompt),
    onProgress: (message) => {
      options.ctx.ui.notify(message, "info");
    },
  });

  options.ctx.modelRegistry.refresh();
  return aliasProviderName;
}
