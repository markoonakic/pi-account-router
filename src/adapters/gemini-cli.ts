import type { OAuthCredentials } from "@earendil-works/pi-ai";

import { FAMILY_DEFS } from "../providers/families.js";
import { createOAuthAdapter } from "./shared-oauth.js";

const family = FAMILY_DEFS["google-gemini-cli"];

type AuthInfo = { url: string; instructions?: string };
type LoginGeminiCli = (
  onAuth: (info: AuthInfo) => void,
  onProgress?: (message: string) => void,
  onManualCodeInput?: () => Promise<string>,
) => Promise<OAuthCredentials>;
type RefreshGoogleCloudToken = (refreshToken: string, projectId: string) => Promise<OAuthCredentials>;

async function loadGoogleOAuthFunction<T extends (...args: never[]) => unknown>(name: string): Promise<T> {
  const oauth = (await import("@earendil-works/pi-ai/oauth")) as Record<string, unknown>;
  const fn = oauth[name];
  if (typeof fn !== "function") {
    throw new Error(
      `${name} is not exported by @earendil-works/pi-ai/oauth in this Pi version. ` +
        "Google Cloud Code Assist account routing needs a local OAuth implementation before it can be re-enabled.",
    );
  }
  return fn as T;
}

export const geminiCliAdapter = createOAuthAdapter({
  family: family.id,
  displayName: family.displayName,
  aliasLabel: "Google Cloud Code Assist",
  capabilities: family.capabilities,
  usesCallbackServer: true,
  async login(callbacks) {
    const loginGeminiCli = await loadGoogleOAuthFunction<LoginGeminiCli>("loginGeminiCli");
    return loginGeminiCli(callbacks.onAuth, callbacks.onProgress, callbacks.onManualCodeInput);
  },
  async refreshToken(credentials) {
    if (typeof credentials.projectId !== "string") {
      throw new Error("Google Cloud credentials missing projectId");
    }

    const refreshGoogleCloudToken = await loadGoogleOAuthFunction<RefreshGoogleCloudToken>("refreshGoogleCloudToken");
    return refreshGoogleCloudToken(credentials.refresh, credentials.projectId);
  },
  getApiKey(credentials) {
    return JSON.stringify({ token: credentials.access, projectId: credentials.projectId });
  },
});
