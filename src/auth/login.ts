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
  pi: Pick<ExtensionAPI, "registerProvider">;
}

function notifyAuth(ctx: AddAccountAndLoginContext, info: OAuthAuthInfo): void {
  const message = info.instructions ? `${info.instructions}\n${info.url}` : info.url;
  ctx.ui.notify(message, "info");
}

async function promptForText(ctx: AddAccountAndLoginContext, prompt: OAuthPrompt): Promise<string> {
  return prompt.placeholder === undefined
    ? (await ctx.ui.input(prompt.message)) ?? ""
    : (await ctx.ui.input(prompt.message, prompt.placeholder)) ?? "";
}

async function promptForManualCode(ctx: AddAccountAndLoginContext): Promise<string> {
  return (await ctx.ui.input("Enter authentication code")) ?? "";
}

export async function addAccountAndLogin(options: AddAccountAndLoginOptions): Promise<string> {
  const aliasProviderName = getNextAliasProviderName(options.family, options.existingProviderNames);
  const doRegister = options.registerAliasProvider ?? registerAliasProvider;

  await doRegister(options.pi, options.ctx.modelRegistry, options.adapter, aliasProviderName);

  await options.ctx.modelRegistry.authStorage.login(aliasProviderName, {
    onAuth: (info) => {
      notifyAuth(options.ctx, info);
    },
    onPrompt: async (prompt) => promptForText(options.ctx, prompt),
    onManualCodeInput: async () => promptForManualCode(options.ctx),
    onProgress: (message) => {
      options.ctx.ui.notify(message, "info");
    },
  });

  options.ctx.modelRegistry.refresh();
  return aliasProviderName;
}
