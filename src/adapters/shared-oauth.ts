import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

import type { AdapterCapabilities, ProviderAdapter, ProviderFamilyId } from "./types.js";

type OAuthModelTransformer = (models: Model<Api>[], credentials: OAuthCredentials) => Model<Api>[];

export interface OAuthAdapterConfig {
  family: ProviderFamilyId;
  displayName: string;
  aliasLabel: string;
  capabilities: AdapterCapabilities;
  usesCallbackServer?: boolean;
  login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
  refreshToken: (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
  getApiKey: (credentials: OAuthCredentials) => string;
  modifyModels?: (providerName: string) => OAuthModelTransformer | undefined;
}

function getAliasProviderName(family: ProviderFamilyId, index: number): string {
  return index <= 1 ? family : `${family}-${index}`;
}

export function createOAuthAdapter(config: OAuthAdapterConfig): ProviderAdapter {
  return {
    family: config.family,
    displayName: config.displayName,
    capabilities: config.capabilities,
    buildAliasOAuth(index: number) {
      const providerName = getAliasProviderName(config.family, index);
      const modifyModels = config.modifyModels?.(providerName);

      return {
        name: `${config.aliasLabel} #${index}`,
        ...(config.usesCallbackServer === undefined ? {} : { usesCallbackServer: config.usesCallbackServer }),
        async login(callbacks: unknown) {
          return config.login(callbacks as OAuthLoginCallbacks);
        },
        async refreshToken(credentials: unknown) {
          return config.refreshToken(credentials as OAuthCredentials);
        },
        getApiKey(credentials: unknown) {
          return config.getApiKey(credentials as OAuthCredentials);
        },
        ...(modifyModels === undefined
          ? {}
          : {
              modifyModels(models: unknown[], credentials: unknown) {
                return modifyModels(models as Model<Api>[], credentials as OAuthCredentials);
              },
            }),
      };
    },
  };
}
