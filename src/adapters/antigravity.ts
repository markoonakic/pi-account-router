import { loginAntigravity, refreshAntigravityToken } from "@mariozechner/pi-ai/oauth";

import { FAMILY_DEFS } from "../providers/families.js";
import { createOAuthAdapter } from "./shared-oauth.js";

const family = FAMILY_DEFS["google-antigravity"];

export const antigravityAdapter = createOAuthAdapter({
  family: family.id,
  displayName: family.displayName,
  aliasLabel: "Antigravity",
  capabilities: family.capabilities,
  usesCallbackServer: true,
  async login(callbacks) {
    return loginAntigravity(callbacks.onAuth, callbacks.onProgress, callbacks.onManualCodeInput);
  },
  async refreshToken(credentials) {
    if (typeof credentials.projectId !== "string") {
      throw new Error("Antigravity credentials missing projectId");
    }

    return refreshAntigravityToken(credentials.refresh, credentials.projectId);
  },
  getApiKey(credentials) {
    return JSON.stringify({ token: credentials.access, projectId: credentials.projectId });
  },
});
