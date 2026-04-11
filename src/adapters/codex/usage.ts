import type { AccountSnapshot, ProviderAccount } from "../types.js";

const FIVE_HOURS = 5 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const WINDOW_TOLERANCE_SECONDS = 120;
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_BADGES = ["usage", "silent failover", "native login"] as const;

interface CodexUsageWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

interface CodexRateLimit {
  primary_window?: CodexUsageWindow;
  secondary_window?: CodexUsageWindow;
}

interface CodexUsageResponse {
  plan_type?: unknown;
  rate_limit?: CodexRateLimit;
}

export interface ParsedCodexUsage {
  planType: string;
  fiveHourLeft?: number;
  weeklyLeft?: number;
  resetAtFiveHour?: number;
  resetAtWeekly?: number;
}

interface CodexAuthLike {
  access?: unknown;
  accountId?: unknown;
}

function isMatchingWindow(window: CodexUsageWindow | undefined, seconds: number): boolean {
  return typeof window?.limit_window_seconds === "number"
    && Math.abs(window.limit_window_seconds - seconds) <= WINDOW_TOLERANCE_SECONDS;
}

function findWindow(rateLimit: CodexRateLimit | undefined, seconds: number): CodexUsageWindow | undefined {
  return [rateLimit?.primary_window, rateLimit?.secondary_window].find((window) => isMatchingWindow(window, seconds));
}

function normalizeRemainingPercent(usedPercent: number | undefined): number | undefined {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
    return undefined;
  }

  return Math.max(0, Math.min(100, 100 - usedPercent));
}

function normalizeResetAt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseCodexUsage(data: CodexUsageResponse | undefined): ParsedCodexUsage {
  const fiveHourWindow = findWindow(data?.rate_limit, FIVE_HOURS);
  const weeklyWindow = findWindow(data?.rate_limit, SEVEN_DAYS);
  const fiveHourLeft = normalizeRemainingPercent(fiveHourWindow?.used_percent);
  const weeklyLeft = normalizeRemainingPercent(weeklyWindow?.used_percent);
  const resetAtFiveHour = normalizeResetAt(fiveHourWindow?.reset_at);
  const resetAtWeekly = normalizeResetAt(weeklyWindow?.reset_at);

  return {
    planType: typeof data?.plan_type === "string" ? data.plan_type : "unknown",
    ...(fiveHourLeft === undefined ? {} : { fiveHourLeft }),
    ...(weeklyLeft === undefined ? {} : { weeklyLeft }),
    ...(resetAtFiveHour === undefined ? {} : { resetAtFiveHour }),
    ...(resetAtWeekly === undefined ? {} : { resetAtWeekly }),
  };
}

function createEmptyCodexSnapshot(): AccountSnapshot {
  return {
    summary: "",
    details: [],
    score: 0,
    badges: [...CODEX_BADGES],
  };
}

export function buildCodexAccountSnapshot(parsed: ParsedCodexUsage): AccountSnapshot {
  const details = [
    parsed.planType !== "unknown" ? parsed.planType : undefined,
    parsed.fiveHourLeft !== undefined ? `5h ${parsed.fiveHourLeft}%` : undefined,
    parsed.weeklyLeft !== undefined ? `7d ${parsed.weeklyLeft}%` : undefined,
  ].filter((value): value is string => value !== undefined);

  return {
    summary: details.join(" | "),
    details,
    score: (parsed.fiveHourLeft ?? 0) + (parsed.weeklyLeft ?? 0),
    badges: [...CODEX_BADGES],
  };
}

function getAccessToken(account: ProviderAccount): string | undefined {
  const auth = account.auth as CodexAuthLike | undefined;
  return typeof auth?.access === "string" && auth.access.length > 0 ? auth.access : undefined;
}

function getAccountId(account: ProviderAccount): string | undefined {
  const auth = account.auth as CodexAuthLike | undefined;
  return typeof auth?.accountId === "string" && auth.accountId.length > 0 ? auth.accountId : undefined;
}

export async function fetchCodexAccountSnapshot(
  account: ProviderAccount,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountSnapshot> {
  const accessToken = getAccessToken(account);
  if (accessToken === undefined) {
    return createEmptyCodexSnapshot();
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "pi-account-router",
    };
    const accountId = getAccountId(account);
    if (accountId !== undefined) {
      headers["chatgpt-account-id"] = accountId;
    }

    const response = await fetchImpl(CODEX_USAGE_URL, {
      method: "GET",
      headers,
      ...(signal === undefined ? {} : { signal }),
    });

    if (!response.ok) {
      return createEmptyCodexSnapshot();
    }

    return buildCodexAccountSnapshot(parseCodexUsage(await response.json()));
  } catch {
    return createEmptyCodexSnapshot();
  }
}
