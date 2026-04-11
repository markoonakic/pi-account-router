import { loginGeminiCli, refreshGoogleCloudToken } from "@mariozechner/pi-ai/oauth";

import { FAMILY_DEFS } from "../providers/families.js";
import { createOAuthAdapter } from "./shared-oauth.js";

const family = FAMILY_DEFS["google-gemini-cli"];

export const geminiCliAdapter = createOAuthAdapter({
  family: family.id,
  displayName: family.displayName,
  aliasLabel: "Google Cloud Code Assist",
  capabilities: family.capabilities,
  usesCallbackServer: true,
  async login(callbacks) {
    return loginGeminiCli(callbacks.onAuth, callbacks.onProgress, callbacks.onManualCodeInput);
  },
  async refreshToken(credentials) {
    if (typeof credentials.projectId !== "string") {
      throw new Error("Google Cloud credentials missing projectId");
    }

    return refreshGoogleCloudToken(credentials.refresh, credentials.projectId);
  },
  getApiKey(credentials) {
    return JSON.stringify({ token: credentials.access, projectId: credentials.projectId });
  },
});
