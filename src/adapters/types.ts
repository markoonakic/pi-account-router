export type ProviderFamilyId =
  | "openai-codex"
  | "anthropic"
  | "github-copilot"
  | "google-gemini-cli"
  | "google-antigravity";

export interface AdapterCapabilities {
  usage: boolean;
  silentFailover: boolean;
  nativeLogin: boolean;
  reauth: boolean;
  experimental: boolean;
}

export interface RetryDisposition {
  action: "surface" | "retry";
  reason: "quota" | "auth" | "other";
  cooldownUntil?: number;
  clearPin?: boolean;
}

export interface AccountSnapshot {
  summary: string;
  details: string[];
  score: number;
  badges: string[];
}

export interface AliasOAuthConfig {
  name: string;
  usesCallbackServer?: boolean;
  login(callbacks: any): Promise<any>;
  refreshToken(credentials: any): Promise<any>;
  getApiKey(credentials: any): string;
  modifyModels?(models: any[], credentials: any): any[];
}

export interface ProviderAdapter {
  family: ProviderFamilyId;
  displayName: string;
  capabilities: AdapterCapabilities;
  buildAliasOAuth(index: number): AliasOAuthConfig;
  createSnapshot?(
    account: { providerName: string; auth?: any },
    signal?: AbortSignal,
  ): Promise<AccountSnapshot | undefined>;
  classifyRetry?(message: string): RetryDisposition;
}
