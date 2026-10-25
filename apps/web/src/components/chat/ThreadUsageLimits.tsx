import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import type { EnvironmentId, ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  collectExternalUsageLinks,
  collectLimitAccounts,
  collectLimitNotices,
  type LimitAccount,
} from "@t3tools/shared/usageLimits";
import { Clock3Icon, ExternalLinkIcon, GaugeIcon } from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { barColor } from "../usage/UsageLimits";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  antigravityQuotaGroups,
  deepSeekPricingPeriod,
  primaryQuotaWindow,
  quotaCountdown,
  quotaPace,
} from "./ThreadUsageLimits.logic";

function shortWindowLabel(window: ServerProviderUsageWindow) {
  if (window.kind === "session") {
    const minutes = window.windowDurationMins;
    return minutes && minutes % 60 === 0 ? `${minutes / 60}h` : "Session";
  }
  if (window.kind === "weekly") return "Weekly";
  if (window.kind === "monthly") return "Monthly";
  return window.label;
}

function QuotaSummary({ window }: { readonly window: ServerProviderUsageWindow }) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
      <span className="text-2xl font-medium leading-7 tracking-tight">
        {Math.round(window.usedPercent)}
        <span className="ml-0.5 text-sm text-muted-foreground">%</span>
      </span>
      <span className="text-3xs leading-3 text-muted-foreground">
        {shortWindowLabel(window)} used
      </span>
    </div>
  );
}

function DeepSeekPricingStatus({ now }: { readonly now: number }) {
  const period = deepSeekPricingPeriod(now);
  const color =
    period === "peak"
      ? "text-warning-foreground"
      : period === "off-peak"
        ? "text-success-foreground"
        : "text-muted-foreground";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="w-fit rounded-sm text-3xs leading-4 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        DeepSeek ·{" "}
        <span className={color}>
          {period === "peak" ? "Peak" : period === "off-peak" ? "Off-peak" : "Check pricing"}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="left">
        {period === null
          ? "Confirm current pricing: the Chinese public holiday calendar for this year is not available."
          : "Peak: Mon–Fri, 01:00–04:00 and 06:00–10:00 UTC. Other hours, weekends and Chinese public holidays are off-peak."}
      </TooltipPopup>
    </Tooltip>
  );
}

function QuotaFooter({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const countdown = quotaCountdown(window.resetsAt, now);
  const pace = quotaPace(window, now);
  const delta = pace?.deltaPercent ?? null;
  const paceLabel =
    delta === null
      ? null
      : Math.abs(delta) < 0.5
        ? "On pace"
        : `${delta > 0 ? "Over" : "Under"} pace by ${Math.abs(delta).toFixed(1)}%`;
  const paceColor =
    delta === null || Math.abs(delta) < 0.5
      ? "text-muted-foreground"
      : delta > 0
        ? "text-warning-foreground"
        : "text-success-foreground";

  return (
    <>
      {countdown !== null && window.resetsAt ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="flex w-fit max-w-full items-center gap-1.5 rounded-sm text-2xs leading-4 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <Clock3Icon className="size-3 shrink-0" aria-hidden />
            <span className="tabular-nums">
              {shortWindowLabel(window)}{" "}
              {countdown === "Awaiting reset" ? "awaiting reset" : `resets in ${countdown}`}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="left">
            {shortWindowLabel(window)} resets{" "}
            {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {pace !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-border/50 pt-2.5 text-3xs leading-4 tabular-nums">
          {paceLabel ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={0}
                    className={`inline-flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${paceColor}`}
                  />
                }
              >
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
                {paceLabel}
              </TooltipTrigger>
              <TooltipPopup side="left">
                Pace compares quota used with the elapsed share of the billing period. The
                difference is shown in percentage points.
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <span className="text-muted-foreground">
            {pace.dailyPercent === null
              ? `${pace.remainingPercent.toFixed(1)}% left`
              : `${pace.dailyPercent.toFixed(1)}% / day left`}
          </span>
        </div>
      ) : null}
    </>
  );
}

function AccountQuotaCard({
  account,
  showIdentity,
  now,
}: {
  readonly account: LimitAccount;
  readonly showIdentity: boolean;
  readonly now: number;
}) {
  const primary = primaryQuotaWindow(account.limits.windows);
  if (primary === null) return null;
  const isAntigravity = account.driver === "antigravity";
  const isOpenCodeGo = account.driver === "opencode" && primary.id.startsWith("go_");
  const supporting = account.limits.windows.filter((window) => window !== primary);
  const summaryOnly = supporting.length > 0 && (account.driver === "codex" || isOpenCodeGo);
  const barWindows = summaryOnly ? supporting : [primary, ...supporting];
  const windowGroups = isAntigravity
    ? antigravityQuotaGroups(account.limits.windows)
    : [{ label: null, windows: barWindows }];
  if (windowGroups.length === 0) return null;
  const name =
    account.driver === "codex"
      ? "ChatGPT (Codex)"
      : isOpenCodeGo
        ? "OpenCode Go"
        : (providerClients.get(account.driver)?.label ?? account.driver);
  const period =
    primary.kind === "monthly"
      ? "Monthly quota"
      : primary.kind === "weekly"
        ? "Weekly quota"
        : primary.kind === "session"
          ? "Session quota"
          : primary.label;
  const color = account.accentColor ?? barColor(account.driver);

  return (
    <section
      aria-label={`${name} ${isAntigravity ? "usage limits" : period.toLowerCase()}`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card/70 p-3.5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/50">
            <ProviderInstanceIcon
              driverKind={account.driver}
              displayName={name}
              iconClassName="size-4"
            />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h4 className="truncate text-xs font-medium leading-4">{name}</h4>
            {account.plan ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      className="truncate rounded-sm text-3xs leading-4 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  {account.plan}
                </TooltipTrigger>
                <TooltipPopup side="left">{account.plan}</TooltipPopup>
              </Tooltip>
            ) : null}
            {isOpenCodeGo ? <DeepSeekPricingStatus now={now} /> : null}
            {showIdentity && account.email ? (
              <RedactedSensitiveText
                value={account.email}
                ariaLabel="Toggle account email visibility"
                revealTooltip="Click to reveal account"
                hideTooltip="Click to hide account"
                className="w-fit max-w-full truncate text-3xs text-muted-foreground"
              />
            ) : showIdentity && account.displayName ? (
              <span className="truncate text-3xs text-muted-foreground">{account.displayName}</span>
            ) : null}
          </div>
        </div>
        {isAntigravity ? (
          <span className="shrink-0 rounded-md bg-foreground/5 px-2 py-1 text-3xs leading-4 text-muted-foreground">
            Model quotas
          </span>
        ) : (
          <QuotaSummary window={primary} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        {windowGroups.map((group) => {
          const groupPrimary = group.label === null ? null : primaryQuotaWindow(group.windows);
          const windows = isAntigravity
            ? group.windows.filter((window) => window.kind !== "weekly")
            : group.windows;
          return (
            <div
              key={group.label ?? "quota"}
              className="flex min-w-0 flex-col gap-2.5 not-first:border-t not-first:border-border/50 not-first:pt-2.5"
            >
              {group.label === null ? null : (
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <h5 className="pt-1 text-2xs font-medium leading-4 text-secondary-label">
                    {group.label}
                  </h5>
                  {groupPrimary ? <QuotaSummary window={groupPrimary} /> : null}
                </div>
              )}
              {windows.map((window) => {
                const left =
                  !isAntigravity && window === primary
                    ? null
                    : quotaCountdown(window.resetsAt, now);
                const label =
                  isAntigravity && window.kind === "other"
                    ? window.label.split(" · ").slice(1).join(" · ") || window.label
                    : shortWindowLabel(window);
                const percent = isAntigravity ? 100 - window.usedPercent : window.usedPercent;
                const valueLabel = isAntigravity ? "remaining" : "used";
                return (
                  <div key={window.id} className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex min-w-0 items-baseline justify-between gap-2 text-2xs leading-4 tabular-nums">
                      <span className="min-w-0 break-words text-secondary-label">{label}</span>
                      <div className="flex shrink-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
                        {left === null ? null : (
                          <span className="text-3xs text-muted-foreground">
                            {left === "Awaiting reset" ? left : `${left} left`}
                          </span>
                        )}
                        <span className="font-medium text-secondary-label">
                          {Math.round(percent)}%
                          <span className="ml-1 font-normal text-muted-foreground">
                            {valueLabel}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${name} ${window.label} ${valueLabel}`}
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${percent}%`,
                          backgroundColor:
                            isAntigravity && percent <= 25 ? "var(--warning)" : color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {groupPrimary ? <QuotaFooter window={groupPrimary} now={now} /> : null}
            </div>
          );
        })}
      </div>
      {isAntigravity ? null : <QuotaFooter window={primary} now={now} />}
    </section>
  );
}

export function ThreadUsageLimits({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const allPresentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const canRefresh = useAtomValue(serverEnvironment.refreshProviders.permissionAtom(environmentId));
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  const presentation = allPresentations.get(environmentId);
  if (!presentation?.serverConfig) return null;

  const presentations = new Map([[environmentId, presentation]]);
  const accounts = collectLimitAccounts(presentations);
  const notices = collectLimitNotices(presentations);
  const externalLinks = collectExternalUsageLinks(presentations);
  const refreshDisabled =
    isRefreshing || !canRefresh || presentation.connection.phase !== "connected";

  const refresh = async () => {
    if (refreshDisabled) return;
    setIsRefreshing(true);
    try {
      const result = await refreshUsageLimits(environmentId, () =>
        refreshProviders({ environmentId, input: {} }),
      );
      if (result?._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        throw squashAtomCommandFailure(result);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not refresh usage limits",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <section
      aria-label="Usage limits"
      data-thread-usage-limits
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2 px-1.5">
        <h3 className="flex items-center gap-1.5 text-2xs font-medium text-secondary-label">
          <GaugeIcon className="size-3.5" aria-hidden />
          Usage limits
        </h3>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label="Refresh usage limits"
                  aria-busy={isRefreshing}
                  disabled={refreshDisabled}
                  onClick={() => void refresh()}
                >
                  <RefreshIcon refreshing={isRefreshing} />
                </Button>
              }
            />
            <TooltipPopup side="top">
              {isRefreshing ? "Refreshing usage limits…" : "Refresh usage limits"}
            </TooltipPopup>
          </Tooltip>
          <Button variant="ghost-muted" size="xs" render={<Link to="/usage" />}>
            Details
          </Button>
        </div>
      </div>
      {accounts.map((account) => (
        <AccountQuotaCard
          key={account.key}
          account={account}
          showIdentity={
            accounts.filter((candidate) => candidate.driver === account.driver).length > 1
          }
          now={now}
        />
      ))}
      {accounts.length === 0 && notices.length === 0 ? (
        <p className="dropdown-glass rounded-xl p-3.5 text-2xs leading-relaxed text-muted-foreground">
          No subscription limits reported by connected providers.
        </p>
      ) : null}
      {notices.map((notice) => (
        <p
          key={notice}
          className="dropdown-glass rounded-xl p-3.5 text-2xs leading-relaxed text-muted-foreground"
        >
          {notice}
        </p>
      ))}
      {externalLinks.map((link) => (
        <div key={link.url} className="self-start">
          <Button
            variant="link"
            size="xs"
            onClick={() => void ensureLocalApi().shell.openExternal(link.url)}
          >
            {link.label}
            <ExternalLinkIcon className="size-3" aria-hidden />
          </Button>
        </div>
      ))}
    </section>
  );
}
