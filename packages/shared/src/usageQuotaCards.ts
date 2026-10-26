import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { elapsedShare } from "./usageLimits.ts";

const DAY_MS = 86_400_000;
// https://en.bjhd.gov.cn/workinginhaidian/supportingservices/publicholidays/202512/t20251211_4797062.shtml
const DEEPSEEK_HOLIDAYS: Readonly<Record<number, readonly (readonly [string, string])[]>> = {
  2026: [
    ["2026-01-01", "2026-01-03"],
    ["2026-02-15", "2026-02-23"],
    ["2026-04-04", "2026-04-06"],
    ["2026-05-01", "2026-05-05"],
    ["2026-06-19", "2026-06-21"],
    ["2026-09-25", "2026-09-27"],
    ["2026-10-01", "2026-10-07"],
  ],
};
const ANTIGRAVITY_GROUP_ORDER = new Map([
  ["Gemini 4 Argon", 0],
  ["Gemini", 1],
]);

export function deepSeekPricingPeriod(now: number) {
  if (!Number.isFinite(now)) return null;
  const date = DateTime.toDateUtc(DateTime.makeUnsafe(now));
  const day = date.getUTCDay();
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const peakHours = (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600);
  if (day === 0 || day === 6 || !peakHours) return "off-peak";

  // https://api-docs.deepseek.com/quick_start/pricing/ excludes Chinese public holidays.
  // Peak windows fall within the same calendar date in UTC and China (09:00–18:00).
  const holidays = DEEPSEEK_HOLIDAYS[date.getUTCFullYear()];
  if (holidays === undefined) return null;
  const today = date.toISOString().slice(0, 10);
  return holidays.some(([start, end]) => today >= start && today <= end) ? "off-peak" : "peak";
}

export function antigravityQuotaGroups(windows: readonly ServerProviderUsageWindow[]) {
  const groups = new Map<string, ServerProviderUsageWindow[]>();
  for (const window of windows) {
    if (
      window.id.startsWith("3p-") ||
      window.id.startsWith("claude-") ||
      window.id.startsWith("gpt-")
    ) {
      continue;
    }
    const label = window.label.split(" · ")[0]?.trim() || window.label;
    const group = groups.get(label);
    if (group) group.push(window);
    else groups.set(label, [window]);
  }
  // Hermes has no toSorted, so both sorts copy first.
  const order = (label: string) =>
    ANTIGRAVITY_GROUP_ORDER.get(label) ?? ANTIGRAVITY_GROUP_ORDER.size;
  return [...groups]
    .sort(([left], [right]) => order(left) - order(right))
    .map(([label, groupWindows]) => ({
      label,
      windows: [...groupWindows].sort(
        (left, right) =>
          (left.windowDurationMins ?? Infinity) - (right.windowDurationMins ?? Infinity),
      ),
    }));
}

export function primaryQuotaWindow(windows: readonly ServerProviderUsageWindow[]) {
  return (
    windows.find((window) => window.kind === "monthly") ??
    windows.find((window) => window.kind === "weekly") ??
    windows.find((window) => window.kind === "session") ??
    windows[0] ??
    null
  );
}

export function quotaPace(window: ServerProviderUsageWindow, now: number) {
  const resetAt = window.resetsAt === undefined ? NaN : Date.parse(window.resetsAt);
  if (!Number.isFinite(resetAt) || resetAt <= now) return null;
  const daysLeft = (resetAt - now) / DAY_MS;
  const remaining = 100 - window.usedPercent;
  const elapsed = elapsedShare(window, now);
  return {
    remainingPercent: remaining,
    dailyPercent: daysLeft >= 1 ? remaining / daysLeft : null,
    deltaPercent: elapsed === null ? null : window.usedPercent - elapsed * 100,
  };
}

export function quotaCountdown(resetsAt: string | undefined, now: number) {
  const resetAt = resetsAt === undefined ? NaN : Date.parse(resetsAt);
  if (!Number.isFinite(resetAt)) return null;
  const totalMinutes = Math.ceil((resetAt - now) / 60_000);
  if (totalMinutes <= 0) return "Awaiting reset";
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, minutes ? `${minutes}m` : null]
    .filter((part) => part !== null)
    .join(" ");
}
