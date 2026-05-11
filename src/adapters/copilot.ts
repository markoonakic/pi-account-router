import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import { getGitHubCopilotBaseUrl, loginGitHubCopilot, normalizeDomain, refreshGitHubCopilotToken } from "@earendil-works/pi-ai/oauth";

import { FAMILY_DEFS } from "../providers/families.js";
import { createOAuthAdapter } from "./shared-oauth.js";

const family = FAMILY_DEFS["github-copilot"];

function modifyCopilotModels(providerName: string, models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[] {
  const enterpriseDomain =
    typeof credentials.enterpriseUrl === "string" ? (normalizeDomain(credentials.enterpriseUrl) ?? undefined) : undefined;
  const token = typeof credentials.access === "string" ? credentials.access : undefined;
  const baseUrl = getGitHubCopilotBaseUrl(token, enterpriseDomain);

  return models.map((model) => (model.provider === providerName ? { ...model, baseUrl } : model));
}

export const copilotAdapter = createOAuthAdapter({
  family: family.id,
  displayName: family.displayName,
  aliasLabel: "GitHub Copilot",
  capabilities: family.capabilities,
  async login(callbacks) {
    return loginGitHubCopilot({
      onAuth: (url: string, instructions?: string) => callbacks.onAuth({
        url,
        ...(instructions === undefined ? {} : { instructions }),
      }),
      onPrompt: callbacks.onPrompt,
      ...(callbacks.onProgress === undefined ? {} : { onProgress: callbacks.onProgress }),
      ...(callbacks.signal === undefined ? {} : { signal: callbacks.signal }),
    });
  },
  async refreshToken(credentials) {
    const enterpriseDomain =
      typeof credentials.enterpriseUrl === "string" ? (normalizeDomain(credentials.enterpriseUrl) ?? undefined) : undefined;
    return refreshGitHubCopilotToken(credentials.refresh, enterpriseDomain);
  },
  getApiKey(credentials) {
    return credentials.access;
  },
  modifyModels(providerName) {
    return (models, credentials) => modifyCopilotModels(providerName, models, credentials);
  },
});
