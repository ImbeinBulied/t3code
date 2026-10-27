import { CheckIcon, Loader2Icon, RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react";
import React from "react";

import { cn } from "../../lib/utils.ts";
import { Button } from "../ui/button.tsx";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";
import type { UseComposerPolishReturn } from "./useComposerPolish.ts";

export function ComposerPolishBar(props: {
  readonly polish: UseComposerPolishReturn;
  readonly className?: string;
}) {
  const { state, apply, cancel, restoreOriginal, dismissError } = props.polish;

  if (state.phase === "idle" && !state.restorableOriginal) {
    return null;
  }

  if (state.phase === "error") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive",
          props.className,
        )}
      >
        <span className="truncate">{state.error ?? "Prompt polish failed."}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={dismissError}
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

  if (state.phase === "polishing") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-xs text-foreground",
          props.className,
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Loader2Icon className="size-3.5 animate-spin text-primary" />
          <span className="font-medium">Polishing draft...</span>
        </div>
        <button
          type="button"
          onClick={cancel}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Cancel"
        >
          <XIcon className="size-3.5" />
          <span>Cancel</span>
        </button>
      </div>
    );
  }

  if (state.phase === "preview" && state.polishedText !== null) {
    return (
      <div
        className={cn(
          "flex flex-col gap-2 p-2.5 rounded-lg border border-primary/30 bg-primary/10 text-xs text-foreground",
          props.className,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-medium text-primary">
            <SparklesIcon className="size-3.5" />
            <span>Prompt polish preview</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={cancel}>
              <XIcon className="size-3 mr-1" />
              Cancel
            </Button>
            <Button type="button" size="xs" variant="default" onClick={apply}>
              <CheckIcon className="size-3 mr-1" />
              Apply
            </Button>
          </div>
        </div>
        <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-background/80 p-2 text-xs border border-border/50 text-foreground">
          {state.polishedText}
        </div>
      </div>
    );
  }

  if (state.phase === "idle" && state.restorableOriginal) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-1 rounded-lg border border-border/40 bg-muted/40 text-xs text-muted-foreground",
          props.className,
        )}
      >
        <span>Prompt polished. Original draft preserved.</span>
        <button
          type="button"
          onClick={restoreOriginal}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-muted text-foreground font-medium transition-colors"
        >
          <RotateCcwIcon className="size-3" />
          <span>Restore original</span>
        </button>
      </div>
    );
  }

  return null;
}

export function ComposerPolishButton(props: {
  readonly isBusy: boolean;
  readonly disabled?: boolean;
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
            disabled={props.disabled || props.isBusy}
            data-composer-action="polish"
            aria-label="Polish prompt"
            onPointerDown={(event) => event.preventDefault()}
            onClick={props.onClick}
            className={props.className}
          >
            {props.isBusy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          </Button>
        }
      />
      <TooltipPopup>Polish prompt</TooltipPopup>
    </Tooltip>
  );
}
