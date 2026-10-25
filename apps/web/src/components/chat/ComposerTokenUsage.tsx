import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { ChevronDownIcon, GaugeIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type UsageCounts = {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly label: string;
};

type UsageCountKey =
  | "inputTokens"
  | "cachedInputTokens"
  | "cacheCreationTokens"
  | "outputTokens"
  | "reasoningTokens";

const tokenFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const compactTokenFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatTokens(value: number | null): string {
  return value === null ? "N/A" : tokenFormatter.format(value);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function timestampMs(value: OrchestrationV2ProviderTurn["startedAt"]): number | null {
  return value === null ? null : DateTime.toEpochMillis(value);
}

function latestMainAgentTurn(
  turns: ReadonlyArray<OrchestrationV2ProviderTurn>,
): OrchestrationV2ProviderTurn | null {
  let latest: OrchestrationV2ProviderTurn | null = null;
  for (const turn of turns) {
    if (turn.runAttemptId === null) continue;
    const turnStartedAt = timestampMs(turn.startedAt) ?? timestampMs(turn.completedAt);
    const latestStartedAt =
      latest === null ? null : (timestampMs(latest.startedAt) ?? timestampMs(latest.completedAt));
    if (
      latest === null ||
      (turnStartedAt !== null && (latestStartedAt === null || turnStartedAt > latestStartedAt)) ||
      (turnStartedAt === latestStartedAt && turn.ordinal > latest.ordinal)
    ) {
      latest = turn;
    }
  }
  return latest;
}

function usageCounts(turn: OrchestrationV2ProviderTurn): UsageCounts | null {
  const report = turn.turnTokenUsage;
  if (report && (report.usageStatus !== "unavailable" || turn.tokenUsage === undefined)) {
    return {
      inputTokens: report.inputTokens ?? null,
      cachedInputTokens: report.cachedInputTokens ?? null,
      cacheCreationTokens: report.cacheCreationTokens ?? null,
      outputTokens: report.outputTokens ?? null,
      reasoningTokens: report.reasoningTokens ?? null,
      label:
        report.usageStatus === "complete"
          ? "Reported"
          : report.usageStatus === "partial"
            ? "Partial"
            : "Unavailable",
    };
  }
  if (turn.tokenUsage) {
    return {
      inputTokens: turn.tokenUsage.inputTokens ?? null,
      cachedInputTokens: turn.tokenUsage.cachedInputTokens ?? null,
      cacheCreationTokens: null,
      outputTokens: turn.tokenUsage.outputTokens ?? null,
      reasoningTokens: turn.tokenUsage.reasoningOutputTokens ?? null,
      label: turn.status === "running" ? "Live" : "Provider snapshot",
    };
  }
  return report
    ? {
        inputTokens: report.inputTokens ?? null,
        cachedInputTokens: report.cachedInputTokens ?? null,
        cacheCreationTokens: report.cacheCreationTokens ?? null,
        outputTokens: report.outputTokens ?? null,
        reasoningTokens: report.reasoningTokens ?? null,
        label: "Unavailable",
      }
    : null;
}

function totalFor(
  turns: ReadonlyArray<OrchestrationV2ProviderTurn>,
  key: UsageCountKey,
): number | null {
  let total = 0;
  let hasValue = false;
  for (const turn of turns) {
    const usage = turn.turnTokenUsage;
    if (turn.runAttemptId === null || usage === undefined || usage.usageStatus === "unavailable") {
      continue;
    }
    const value = usage[key];
    if (typeof value === "number") {
      total += value;
      hasValue = true;
    }
  }
  return hasValue ? total : null;
}

function UsageLine({
  label,
  usage,
  outputRate,
  durationMs,
}: {
  readonly label: string;
  readonly usage: UsageCounts;
  readonly outputRate?: number | null;
  readonly durationMs?: number | null;
}) {
  const metrics = [
    { label: "Input", value: formatTokens(usage.inputTokens) },
    { label: "Cached input", value: formatTokens(usage.cachedInputTokens) },
    { label: "Output", value: formatTokens(usage.outputTokens) },
    ...(usage.reasoningTokens === null
      ? []
      : [{ label: "Reasoning", value: formatTokens(usage.reasoningTokens) }]),
    ...(usage.cacheCreationTokens === null
      ? []
      : [{ label: "Cache write", value: formatTokens(usage.cacheCreationTokens) }]),
    ...(outputRate === undefined
      ? []
      : [
          {
            label: "Avg. output",
            value: outputRate === null ? "N/A" : `${outputRate.toFixed(1)} tok/s`,
          },
        ]),
    ...(durationMs === undefined
      ? []
      : [{ label: "Elapsed", value: durationMs === null ? "N/A" : formatDuration(durationMs) }]),
  ];

  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-2xs font-medium text-secondary-label">{label}</h4>
        <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-3xs text-muted-foreground">
          {usage.label}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-2xs leading-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground">{metric.label}</dt>
            <dd className="font-medium text-secondary-label tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TelemetryMetric({
  children,
  description,
}: {
  readonly children: ReactNode;
  readonly description: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}

export function ComposerTokenUsage({
  providerTurns,
  contextWindow,
  cost,
}: {
  readonly providerTurns: ReadonlyArray<OrchestrationV2ProviderTurn>;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly cost: ContextWindowSnapshot["cost"];
}) {
  const mainAgentTurns = providerTurns.filter((turn) => turn.runAttemptId !== null);
  const latestTurn = latestMainAgentTurn(mainAgentTurns);
  const latestUsage = latestTurn === null ? null : usageCounts(latestTurn);
  const latestTurnStartedAt = latestTurn === null ? null : timestampMs(latestTurn.startedAt);
  const latestTurnIsRunning = latestTurn?.status === "running";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!latestTurnIsRunning || latestTurnStartedAt === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [latestTurnIsRunning, latestTurnStartedAt]);

  const completedAt = latestTurn === null ? null : timestampMs(latestTurn.completedAt);
  const endAt = latestTurnIsRunning ? now : completedAt;
  const durationMs =
    latestTurnStartedAt === null || endAt === null
      ? null
      : Math.max(0, endAt - latestTurnStartedAt);
  const outputRate =
    latestUsage?.outputTokens !== null &&
    latestUsage?.outputTokens !== undefined &&
    durationMs !== null &&
    durationMs > 0
      ? latestUsage.outputTokens / (durationMs / 1_000)
      : null;

  const reportedResponses = mainAgentTurns.filter(
    (turn) =>
      turn.turnTokenUsage !== undefined && turn.turnTokenUsage.usageStatus !== "unavailable",
  ).length;
  const threadTotals: UsageCounts = {
    inputTokens: totalFor(mainAgentTurns, "inputTokens"),
    cachedInputTokens: totalFor(mainAgentTurns, "cachedInputTokens"),
    cacheCreationTokens: totalFor(mainAgentTurns, "cacheCreationTokens"),
    outputTokens: totalFor(mainAgentTurns, "outputTokens"),
    reasoningTokens: totalFor(mainAgentTurns, "reasoningTokens"),
    label: "Reported",
  };

  if (latestTurn === null && reportedResponses === 0) return null;

  const totals = reportedResponses > 0 ? threadTotals : latestUsage;
  const completeCacheCoverage = mainAgentTurns.every((turn) => {
    const usage = turn.turnTokenUsage;
    return (
      usage === undefined ||
      usage.usageStatus === "unavailable" ||
      (usage.inputTokens !== undefined && usage.cachedInputTokens !== undefined)
    );
  });
  const cacheHit =
    completeCacheCoverage &&
    totals?.inputTokens !== null &&
    totals?.inputTokens !== undefined &&
    totals.inputTokens > 0 &&
    totals.cachedInputTokens !== null
      ? Math.min(100, (totals.cachedInputTokens / totals.inputTokens) * 100)
      : null;
  const compact = (value: number | null) =>
    value === null ? "N/A" : compactTokenFormatter.format(value).toLowerCase();
  const contextPercent = contextWindow?.usedPercentage ?? null;
  const totalsLabel = reportedResponses > 0 ? "Thread" : "Response";
  const costLabel =
    cost == null
      ? null
      : cost.currency.toUpperCase() === "USD"
        ? `$${cost.amount.toFixed(2)}`
        : `${cost.amount.toFixed(2)} ${cost.currency}`;

  return (
    <div
      className="@container/composer-usage relative mx-auto min-w-0 max-w-(--chat-content-max-width) rounded-xl bg-background px-3 pt-2 sm:px-4"
      data-chat-composer-token-usage="true"
      role="region"
      aria-label="Generation telemetry"
    >
      <Collapsible>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-2xs leading-4 text-muted-foreground tabular-nums">
          {contextWindow !== null ? (
            <TelemetryMetric
              description={
                <>
                  Context window: {formatTokens(contextWindow.usedTokens)}
                  {contextWindow.maxTokens == null
                    ? " tokens in use."
                    : ` of ${formatTokens(contextWindow.maxTokens)} tokens in use.`}
                  {contextWindow.remainingTokens === null
                    ? null
                    : ` ${formatTokens(contextWindow.remainingTokens)} tokens remaining.`}{" "}
                  This is the current context, separate from thread-wide token totals.
                </>
              }
            >
              <span>Context</span>
              {contextPercent === null ? null : (
                <span
                  aria-hidden
                  className="h-1 w-10 overflow-hidden rounded-full bg-foreground/10"
                >
                  <span
                    className={`block h-full rounded-full ${
                      contextPercent >= 90
                        ? "bg-destructive"
                        : contextPercent >= 75
                          ? "bg-warning"
                          : "bg-foreground/45"
                    }`}
                    style={{ width: `${contextPercent}%` }}
                  />
                </span>
              )}
              <span className="font-medium text-secondary-label">
                {contextPercent === null
                  ? compact(contextWindow.usedTokens)
                  : `${Math.round(contextPercent)}%`}
              </span>
            </TelemetryMetric>
          ) : null}
          <TelemetryMetric
            description={
              <>
                {totalsLabel} tokens: {formatTokens(totals?.inputTokens ?? null)} input and{" "}
                {formatTokens(totals?.outputTokens ?? null)} output.
                {reportedResponses > 0
                  ? ` Totals cover ${reportedResponses} reported main-agent ${reportedResponses === 1 ? "response" : "responses"}.`
                  : " Counts from the latest provider snapshot."}
              </>
            }
          >
            <span>{totalsLabel}</span>
            <span className="font-medium text-secondary-label">
              {compact(totals?.inputTokens ?? null)}{" "}
              <span className="font-normal text-muted-foreground">in</span>
            </span>
            <span aria-hidden className="text-muted-foreground/50">
              /
            </span>
            <span className="font-medium text-secondary-label">
              {compact(totals?.outputTokens ?? null)}{" "}
              <span className="font-normal text-muted-foreground">out</span>
            </span>
          </TelemetryMetric>
          {cacheHit === null ? null : (
            <TelemetryMetric
              description={`${formatTokens(totals?.cachedInputTokens ?? null)} input tokens read from cache. Cache hit is the share of reported input reused from cache.`}
            >
              <span>Cached</span>
              <span className="font-medium text-secondary-label">{Math.round(cacheHit)}%</span>
            </TelemetryMetric>
          )}
          {outputRate === null ? null : (
            <TelemetryMetric description="Average output tokens per second over the latest turn. Elapsed time includes tool calls and pauses.">
              <GaugeIcon className="size-3" aria-hidden />
              <span>Avg. output</span>
              <span className="font-medium text-secondary-label">
                {outputRate.toFixed(1)} tok/s
              </span>
            </TelemetryMetric>
          )}
          {costLabel === null ? null : (
            <TelemetryMetric description="Cost reported by the provider.">
              <span>Cost</span>
              <span className="font-medium text-secondary-label">{costLabel}</span>
            </TelemetryMetric>
          )}
          <CollapsibleTrigger
            render={<Button variant="ghost-muted" size="micro" />}
            className="group ml-auto"
          >
            Details
            <ChevronDownIcon
              className="size-3 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </CollapsibleTrigger>
        </div>
        <CollapsiblePanel animate={false}>
          <div className="mt-2 flex max-h-72 flex-col gap-3 overflow-y-auto rounded-xl border border-border/60 bg-card p-3.5">
            {contextWindow !== null ? (
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/50 pb-2.5 text-2xs leading-4">
                <span className="font-medium text-secondary-label">Context window</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatTokens(contextWindow.usedTokens)}
                  {contextWindow.maxTokens == null
                    ? " tokens used"
                    : ` / ${formatTokens(contextWindow.maxTokens)} tokens`}
                  {contextWindow.remainingTokens === null
                    ? null
                    : ` · ${compact(contextWindow.remainingTokens)} remaining`}
                </span>
              </div>
            ) : null}
            <div className="grid min-w-0 grid-cols-1 gap-4 @lg/composer-usage:grid-cols-2">
              {latestTurn !== null && latestUsage !== null ? (
                <UsageLine
                  label={latestTurnIsRunning ? "Current response" : "Last response"}
                  usage={latestUsage}
                  outputRate={outputRate}
                  durationMs={durationMs}
                />
              ) : (
                <p className="text-2xs leading-4 text-muted-foreground">
                  Token counts are not available for this response.
                </p>
              )}
              {reportedResponses > 0 ? (
                <UsageLine
                  label={`Thread total · ${reportedResponses} ${reportedResponses === 1 ? "response" : "responses"}`}
                  usage={threadTotals}
                />
              ) : null}
            </div>
            <p className="border-t border-border/50 pt-2.5 text-3xs leading-relaxed text-muted-foreground">
              Input includes cache reads and writes. Output includes reasoning. Thread totals cover
              reported main-agent responses only. Average output includes tool calls and pauses.
            </p>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
