import type { OAuthCredentials } from "@earendil-works/pi-ai";

import { FAMILY_DEFS } from "../providers/families.js";
import { createOAuthAdapter } from "./shared-oauth.js";

const family = FAMILY_DEFS["google-antigravity"];

type AuthInfo = { url: string; instructions?: string };
type LoginAntigravity = (
  onAuth: (info: AuthInfo) => void,
  onProgress?: (message: string) => void,
  onManualCodeInput?: () => Promise<string>,
) => Promise<OAuthCredentials>;
type RefreshAntigravityToken = (refreshToken: string, projectId: string) => Promise<OAuthCredentials>;

async function loadGoogleOAuthFunction<T extends (...args: never[]) => unknown>(name: string): Promise<T> {
  const oauth = (await import("@earendil-works/pi-ai/oauth")) as Record<string, unknown>;
  const fn = oauth[name];
  if (typeof fn !== "function") {
    throw new Error(
      `${name} is not exported by @earendil-works/pi-ai/oauth in this Pi version. ` +
        "Antigravity account routing needs a local OAuth implementation before it can be re-enabled.",
    );
  }
  return fn as T;
}

export const antigravityAdapter = createOAuthAdapter({
  family: family.id,
  displayName: family.displayName,
  aliasLabel: "Antigravity",
  capabilities: family.capabilities,
  usesCallbackServer: true,
  async login(callbacks) {
    const loginAntigravity = await loadGoogleOAuthFunction<LoginAntigravity>("loginAntigravity");
    return loginAntigravity(callbacks.onAuth, callbacks.onProgress, callbacks.onManualCodeInput);
  },
  async refreshToken(credentials) {
    if (typeof credentials.projectId !== "string") {
      throw new Error("Antigravity credentials missing projectId");
    }

    const refreshAntigravityToken = await loadGoogleOAuthFunction<RefreshAntigravityToken>("refreshAntigravityToken");
    return refreshAntigravityToken(credentials.refresh, credentials.projectId);
  },
  getApiKey(credentials) {
    return JSON.stringify({ token: credentials.access, projectId: credentials.projectId });
  },
});
