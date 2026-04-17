import { LoginDialogComponent, type AuthStorage, type ExtensionAPI, type ExtensionUIContext, type ModelRegistry } from "@mariozechner/pi-coding-agent";
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
  ui: Pick<ExtensionUIContext, "notify" | "input"> & Partial<Pick<ExtensionUIContext, "custom">>;
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
): Promise<boolean> {
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
    return true;
  } catch {
    ctx.ui.notify("Could not open a browser automatically. Please open the login URL manually.", "warning");
    return false;
  }
}

async function notifyAuth(
  pi: Pick<ExtensionAPI, "exec">,
  ctx: AddAccountAndLoginContext,
  info: OAuthAuthInfo,
): Promise<void> {
  const opened = await openLoginInBrowser(pi, ctx, info.url);

  if (opened) {
    ctx.ui.notify(info.instructions ?? "A browser window should open. Complete login to finish.", "info");
    return;
  }

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

async function promptForManualCode(ctx: AddAccountAndLoginContext): Promise<string> {
  return promptForRequiredInput(ctx, "Paste redirect URL below, or complete login in browser:");
}

type NativeLikeLoginContext = AddAccountAndLoginContext;

type NativeLikeLoginOptions = {
  providerName: string;
  ctx: NativeLikeLoginContext;
  pi: Pick<ExtensionAPI, "exec">;
};

async function loginWithFallbackPrompts(options: NativeLikeLoginOptions): Promise<void> {
  await options.ctx.modelRegistry.authStorage.login(options.providerName, {
    onAuth: (info) => {
      void notifyAuth(options.pi, options.ctx, info);
    },
    onPrompt: async (prompt) => promptForText(options.ctx, prompt),
    onManualCodeInput: async () => promptForManualCode(options.ctx),
    onProgress: (message) => {
      options.ctx.ui.notify(message, "info");
    },
  });
}

export async function loginWithNativeLikeDialog(options: NativeLikeLoginOptions): Promise<void> {
  if (typeof options.ctx.ui.custom !== "function") {
    await loginWithFallbackPrompts(options);
    return;
  }

  const result = await options.ctx.ui.custom<{ success: boolean; error?: string } | undefined>((tui, _theme, _keybindings, done) => {
    let settled = false;
    let manualCodeResolve: ((value: string) => void) | undefined;
    let manualCodeReject: ((error: Error) => void) | undefined;
    const manualCodePromise = new Promise<string>((resolve, reject) => {
      manualCodeResolve = resolve;
      manualCodeReject = reject;
    });

    const dialog = new LoginDialogComponent(tui, options.providerName, (_success, message) => {
      if (!settled) {
        settled = true;
        done({ success: false, error: message ?? "Login cancelled" });
      }
    });

    void (async () => {
      try {
        await options.ctx.modelRegistry.authStorage.login(options.providerName, {
          onAuth: (info) => {
            dialog.showAuth(info.url, info.instructions);
            void dialog.showManualInput("Paste redirect URL below, or complete login in browser:")
              .then((value) => {
                if (value && manualCodeResolve) {
                  manualCodeResolve(value);
                  manualCodeResolve = undefined;
                  manualCodeReject = undefined;
                }
              })
              .catch(() => {
                if (manualCodeReject) {
                  manualCodeReject(new Error("Authentication input cancelled by user"));
                  manualCodeResolve = undefined;
                  manualCodeReject = undefined;
                }
              });
          },
          onPrompt: async (prompt) => dialog.showPrompt(prompt.message, prompt.placeholder),
          onProgress: (message) => {
            dialog.showProgress(message);
          },
          onManualCodeInput: () => manualCodePromise,
          signal: dialog.signal,
        });

        if (!settled) {
          settled = true;
          done({ success: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!settled) {
          settled = true;
          done({ success: false, error: message });
        }
      }
    })();

    return dialog;
  });

  if (!result?.success) {
    throw new Error(result?.error ?? "Login cancelled");
  }
}

export async function addAccountAndLogin(options: AddAccountAndLoginOptions): Promise<string> {
  const aliasProviderName = getNextAliasProviderName(options.family, options.existingProviderNames);
  const doRegister = options.registerAliasProvider ?? registerAliasProvider;

  await doRegister(options.pi, options.ctx.modelRegistry, options.adapter, aliasProviderName);
  await loginWithNativeLikeDialog({
    providerName: aliasProviderName,
    ctx: options.ctx,
    pi: options.pi,
  });
  options.ctx.modelRegistry.refresh();
  return aliasProviderName;
}
