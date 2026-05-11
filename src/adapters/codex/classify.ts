import type { RetryDisposition } from "../types.js";

const QUOTA_PATTERNS = [
  /\b429\b/i,
  /rate.?limit/i,
  /usage.?limit/i,
  /quota/i,
  /too many requests/i,
  /limit reached/i,
  /capacity/i,
];

const AUTH_PATTERNS = [
  /\b401\b/i,
  /unauthorized/i,
  /authentication/i,
  /reauth/i,
  /login again/i,
  /token refresh/i,
  /invalid.?token/i,
  /expired.*token/i,
  /session expired/i,
];

const MODEL_UNSUPPORTED_PATTERNS = [
  /model is not supported/i,
  /not supported when using codex with a chatgpt account/i,
];

const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const MODEL_UNSUPPORTED_COOLDOWN_MS = 24 * QUOTA_COOLDOWN_MS;

export function classifyCodexRetry(message: string): RetryDisposition {
  if (MODEL_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      action: "retry",
      reason: "quota",
      cooldownUntil: Date.now() + MODEL_UNSUPPORTED_COOLDOWN_MS,
      clearPin: true,
    };
  }

  if (QUOTA_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      action: "retry",
      reason: "quota",
      cooldownUntil: Date.now() + QUOTA_COOLDOWN_MS,
      clearPin: true,
    };
  }

  if (AUTH_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      action: "retry",
      reason: "auth",
      clearPin: true,
    };
  }

  return {
    action: "surface",
    reason: "other",
  };
}
