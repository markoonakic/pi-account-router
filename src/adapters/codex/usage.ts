const FIVE_HOURS = 5 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const WINDOW_TOLERANCE_SECONDS = 120;

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
