import { loginAnthropic, refreshAnthropicToken } from "@earendil-works/pi-ai/oauth";

import { FAMILY_DEFS } from "../providers/families.js";
import { createOAuthAdapter } from "./shared-oauth.js";

const family = FAMILY_DEFS["anthropic"];

export const anthropicAdapter = createOAuthAdapter({
  family: family.id,
  displayName: family.displayName,
  aliasLabel: "Anthropic",
  capabilities: family.capabilities,
  usesCallbackServer: true,
  async login(callbacks) {
    return loginAnthropic({
      onAuth: callbacks.onAuth,
      onPrompt: callbacks.onPrompt,
      ...(callbacks.onProgress === undefined ? {} : { onProgress: callbacks.onProgress }),
      ...(callbacks.onManualCodeInput === undefined ? {} : { onManualCodeInput: callbacks.onManualCodeInput }),
    });
  },
  async refreshToken(credentials) {
    return refreshAnthropicToken(credentials.refresh);
  },
  getApiKey(credentials) {
    return credentials.access;
  },
});
