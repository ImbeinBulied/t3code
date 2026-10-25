import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { elapsedShare } from "@t3tools/shared/usageLimits";

const DAY_MS = 86_400_000;
const ANTIGRAVITY_GROUP_ORDER = new Map([
  ["Gemini 4 Argon", 0],
  ["Gemini", 1],
]);

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
  return [...groups]
    .toSorted(
      ([left], [right]) =>
        (ANTIGRAVITY_GROUP_ORDER.get(left) ?? ANTIGRAVITY_GROUP_ORDER.size) -
        (ANTIGRAVITY_GROUP_ORDER.get(right) ?? ANTIGRAVITY_GROUP_ORDER.size),
    )
    .map(([label, windows]) => ({
      label,
      windows: windows.toSorted(
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
