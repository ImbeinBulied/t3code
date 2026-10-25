import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  antigravityQuotaGroups,
  deepSeekPricingPeriod,
  primaryQuotaWindow,
  quotaCountdown,
  quotaPace,
} from "./ThreadUsageLimits.logic";

const now = Date.parse("2026-10-24T12:00:00.000Z");
const weekly: ServerProviderUsageWindow = {
  id: "weekly",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 35,
  resetsAt: "2026-10-30T12:00:00.000Z",
  windowDurationMins: 7 * 24 * 60,
};

describe("DeepSeek pricing period", () => {
  it.each([
    ["2026-10-26T00:59:59Z", "off-peak"],
    ["2026-10-26T01:00:00Z", "peak"],
    ["2026-10-26T03:59:59Z", "peak"],
    ["2026-10-26T04:00:00Z", "off-peak"],
    ["2026-10-26T05:59:59Z", "off-peak"],
    ["2026-10-26T06:00:00Z", "peak"],
    ["2026-10-26T09:59:59Z", "peak"],
    ["2026-10-26T10:00:00Z", "off-peak"],
    ["2026-10-26T06:45:00+05:45", "peak"],
    ["2026-10-26T09:45:00+05:45", "off-peak"],
    ["2026-10-24T02:00:00Z", "off-peak"],
    ["2026-10-25T07:00:00Z", "off-peak"],
  ])("reports %s as %s using UTC weekdays and half-open peak windows", (timestamp, period) => {
    expect(deepSeekPricingPeriod(Date.parse(timestamp))).toBe(period);
  });

  it.each([
    "2026-01-01",
    "2026-02-23",
    "2026-04-06",
    "2026-05-05",
    "2026-06-19",
    "2026-09-25",
    "2026-10-07",
    "2026-10-10",
  ])("keeps holidays and adjusted working weekends off-peak on %s", (day) => {
    expect(deepSeekPricingPeriod(Date.parse(`${day}T02:00:00Z`))).toBe("off-peak");
  });

  it("does not guess peak pricing without a verified holiday calendar", () => {
    expect(deepSeekPricingPeriod(Date.parse("2027-01-04T02:00:00Z"))).toBeNull();
    expect(deepSeekPricingPeriod(Date.parse("2027-01-04T12:00:00Z"))).toBe("off-peak");
    expect(deepSeekPricingPeriod(NaN)).toBeNull();
  });
});

describe("quota summaries", () => {
  it("keeps Gemini allowances separate and excludes unavailable Claude/GPT models", () => {
    const sharedWeekly: ServerProviderUsageWindow = {
      ...weekly,
      id: "3p-weekly",
      label: "Claude & GPT (shared) · Weekly",
      usedPercent: 60,
    };
    const geminiWeekly: ServerProviderUsageWindow = {
      ...weekly,
      id: "gemini-weekly",
      label: "Gemini · Weekly",
      usedPercent: 15,
    };
    const geminiSession: ServerProviderUsageWindow = {
      ...geminiWeekly,
      id: "gemini-5h",
      label: "Gemini · 5-hour",
      kind: "session",
      windowDurationMins: 300,
    };
    const argonWeekly: ServerProviderUsageWindow = {
      ...weekly,
      id: "gemini-argon-wtu-weekly",
      label: "Gemini 4 Argon · Weekly",
      usedPercent: 80,
    };
    expect(
      antigravityQuotaGroups([
        sharedWeekly,
        geminiWeekly,
        geminiSession,
        argonWeekly,
        { ...sharedWeekly, id: "claude-weekly", label: "Claude · Weekly" },
        { ...sharedWeekly, id: "gpt-weekly", label: "GPT · Weekly" },
      ]),
    ).toEqual([
      { label: "Gemini 4 Argon", windows: [argonWeekly] },
      { label: "Gemini", windows: [geminiSession, geminiWeekly] },
    ]);
    expect(antigravityQuotaGroups([sharedWeekly])).toEqual([]);
  });

  it("preserves Antigravity quotas whose reset cadence is not reported", () => {
    const reported: ServerProviderUsageWindow = {
      id: "gemini-quota",
      label: "Gemini · Reported quota",
      kind: "other",
      usedPercent: 25,
    };
    expect(antigravityQuotaGroups([reported])).toEqual([{ label: "Gemini", windows: [reported] }]);
    expect(antigravityQuotaGroups([])).toEqual([]);
  });

  it("prioritizes the monthly Go allowance and the weekly Codex allowance", () => {
    const session: ServerProviderUsageWindow = { ...weekly, id: "session", kind: "session" };
    const monthly: ServerProviderUsageWindow = { ...weekly, id: "monthly", kind: "monthly" };
    expect(primaryQuotaWindow([session, weekly, monthly])).toBe(monthly);
    expect(primaryQuotaWindow([session, weekly])).toBe(weekly);
    expect(primaryQuotaWindow([])).toBeNull();
  });

  it("compares usage to elapsed quota time and divides remaining allowance across remaining days", () => {
    const pace = quotaPace(weekly, now);
    expect(pace?.remainingPercent).toBe(65);
    expect(pace?.dailyPercent).toBeCloseTo(65 / 6);
    expect(pace?.deltaPercent).toBeCloseTo(35 - 100 / 7);
  });

  it("uses flat remaining allowance during the final day instead of inflating a daily budget", () => {
    const pace = quotaPace({ ...weekly, resetsAt: "2026-10-24T18:00:00.000Z" }, now);
    expect(pace?.dailyPercent).toBeNull();
    expect(pace?.remainingPercent).toBe(65);
  });

  it("does not invent a pace without a billing period or after a reset has passed", () => {
    expect(quotaPace({ ...weekly, windowDurationMins: undefined }, now)?.deltaPercent).toBeNull();
    expect(quotaPace({ ...weekly, resetsAt: undefined }, now)).toBeNull();
    expect(quotaPace({ ...weekly, resetsAt: "2026-10-24T12:00:00.000Z" }, now)).toBeNull();
    expect(quotaPace({ ...weekly, resetsAt: "invalid" }, now)).toBeNull();
  });

  it("keeps minutes visible in long countdowns and rounds a pending reset up", () => {
    expect(quotaCountdown("2026-10-30T13:42:00.000Z", now)).toBe("6d 1h 42m");
    expect(quotaCountdown("2026-10-24T12:00:01.000Z", now)).toBe("1m");
    expect(quotaCountdown("2026-10-24T12:00:00.000Z", now)).toBe("Awaiting reset");
    expect(quotaCountdown(undefined, now)).toBeNull();
  });
});
