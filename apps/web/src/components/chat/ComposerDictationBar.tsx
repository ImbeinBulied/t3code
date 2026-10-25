import { CheckIcon, MicIcon, RefreshCwIcon, SettingsIcon, XIcon } from "lucide-react";
import React, { memo } from "react";

import { cn } from "../../lib/utils.ts";
import { Button } from "../ui/button.tsx";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";
import type { UseComposerDictationReturn } from "./useComposerDictation.ts";

const WAVEFORM_SLOTS = Array.from({ length: 24 }, (_, i) => `waveform-slot-${i}`);

export const VoiceWaveform = memo(function VoiceWaveform(props: {
  readonly audioLevels: ReadonlyArray<number>;
  readonly className?: string;
}) {
  const visibleLevels = props.audioLevels.slice(-24);
  return (
    <div aria-hidden="true" className={cn("flex items-center gap-0.75 h-4 px-1", props.className)}>
      {WAVEFORM_SLOTS.map((slotId, index) => {
        const lvl = visibleLevels[index] ?? 0;
        const height = Math.max(3, Math.min(16, Math.round(lvl * 16)));
        return (
          <div
            key={slotId}
            className="w-0.5 rounded-full bg-primary transition-all duration-75"
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
});

export function ComposerDictationBar(props: {
  readonly dictation: UseComposerDictationReturn;
  readonly className?: string;
}) {
  const { state, presentation, audioLevels, stop, cancel, start, openSettings } = props.dictation;

  if (state.phase === "idle") return null;

  if (state.phase === "error") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive",
          props.className,
        )}
      >
        <span className="truncate">{state.error ?? "Dictation error"}</span>
        <div className="flex items-center gap-1 shrink-0">
          {state.errorAction === "settings" ? (
            <button
              type="button"
              onClick={openSettings}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/20 hover:bg-destructive/30 text-destructive font-medium transition-colors"
            >
              <SettingsIcon className="size-3" />
              <span>Settings</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/20 hover:bg-destructive/30 text-destructive font-medium transition-colors"
            >
              <RefreshCwIcon className="size-3" />
              <span>Retry</span>
            </button>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={cancel}
                  className="p-1 rounded hover:bg-destructive/20 text-destructive/80 hover:text-destructive transition-colors"
                  aria-label="Dismiss"
                >
                  <XIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup>Dismiss</TooltipPopup>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-xs text-foreground",
        props.className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <span className="font-medium shrink-0">{presentation.statusLabel}</span>
        {state.phase === "recording" && <VoiceWaveform audioLevels={audioLevels} />}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={cancel}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Cancel (Escape)"
              >
                <XIcon className="size-3.5" />
                <span>Cancel</span>
              </button>
            }
          />
          <TooltipPopup>Cancel (Escape)</TooltipPopup>
        </Tooltip>

        {presentation.trailingAction === "confirm" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={!presentation.confirmationEnabled}
                  onClick={stop}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground font-medium shadow-xs transition-colors",
                    !presentation.confirmationEnabled && "opacity-50 cursor-not-allowed",
                  )}
                  aria-label="Done (Enter)"
                >
                  <CheckIcon className="size-3.5" />
                  <span>Done</span>
                </button>
              }
            />
            <TooltipPopup>Done (Enter)</TooltipPopup>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function ComposerDictationButton(props: {
  readonly isBusy: boolean;
  readonly onClick: () => void;
  readonly className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={props.isBusy ? "secondary" : "ghost"}
            size="icon-sm"
            data-composer-action="dictate"
            aria-label="Dictate (Mod+Shift+D)"
            onPointerDown={(event) => event.preventDefault()}
            onClick={props.onClick}
            className={props.className}
          >
            <MicIcon />
          </Button>
        }
      />
      <TooltipPopup>Dictate (Mod+Shift+D)</TooltipPopup>
    </Tooltip>
  );
}
