import type { ChatComposerProps } from "./ChatComposer";
import { type ComposerCommandItem } from "./ComposerCommandMenu";
import {
  type ComposerDispatchMode,
  resolveComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import { type ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import {
  type ComposerPromptHistoryPosition,
  buildComposerPromptHistoryEntries,
  stepComposerPromptHistory,
} from "./composerPromptHistory";
import {
  type ComposerSubmissionIntent,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  composerSubmissionIntentForKey,
} from "../../composer-logic";
import { type PendingUserInput } from "../../session-logic";
import { type PreviewAnnotationPayload } from "@t3tools/contracts";
import { type ReviewCommentContext } from "../../reviewCommentContext";
import { composerTargetKey } from "../../composerDraftStore";
import { listContinuationForEnter, listIndentForTab } from "../../composer-list-continuation";
import { type Dispatch, type RefObject, type SetStateAction, useLayoutEffect, useRef } from "react";

/**
 * The composer's key handling inside the editor: send shortcuts, the slash/mention menu,
 * prompt history on ArrowUp/ArrowDown, plan-mode toggle, and list continuation.
 */
export function useComposerCommandKey(input: {
  readonly keybindings: ChatComposerProps["keybindings"];
  readonly sendShortcut: ChatComposerProps["settings"]["sendShortcut"];
  readonly routeKind: ChatComposerProps["routeKind"];
  readonly phase: ChatComposerProps["phase"];
  readonly isCompacting: boolean;
  readonly followUpBehavior: ChatComposerProps["settings"]["followUpBehavior"];
  readonly isSoftwareKeyboardOpen: boolean;
  readonly planModeUiEnabled: boolean;
  readonly isLiteralPendingAnswer: boolean;
  readonly dictation?: {
    readonly isBusy: boolean;
    readonly presentation: { readonly confirmationEnabled: boolean };
    readonly cancel: () => void;
    readonly stop: () => void;
  };
  readonly pendingUserInputs: ReadonlyArray<PendingUserInput>;
  readonly promptHistoryMessages: ChatComposerProps["promptHistoryMessages"];
  readonly promptHistoryPositionRef: RefObject<{
    targetKey: string;
    position: ComposerPromptHistoryPosition;
  } | null>;
  readonly composerDraftTarget: ChatComposerProps["composerDraftTarget"];
  readonly promptRef: ChatComposerProps["promptRef"];
  readonly composerImagesRef: ChatComposerProps["composerImagesRef"];
  readonly composerFilesRef: ChatComposerProps["composerFilesRef"];
  readonly composerTerminalContextsRef: ChatComposerProps["composerTerminalContextsRef"];
  readonly composerPreviewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly composerReviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly composerEditorRef: RefObject<ComposerPromptEditorHandle | null>;
  readonly composerMenuOpenRef: RefObject<boolean>;
  readonly composerMenuItemsRef: RefObject<ComposerCommandItem[]>;
  readonly activeComposerMenuItemRef: RefObject<ComposerCommandItem | null>;
  readonly setComposerDraftPrompt: (
    target: ChatComposerProps["composerDraftTarget"],
    prompt: string,
  ) => void;
  readonly setComposerCursor: Dispatch<SetStateAction<number>>;
  readonly setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  readonly setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  readonly dismissComposerTrigger: (trigger: ComposerTrigger | null) => void;
  readonly toggleInteractionMode: () => void;
  readonly nudgeComposerMenuHighlight: (key: "ArrowDown" | "ArrowUp") => void;
  readonly onSelectComposerItem: (item: ComposerCommandItem) => void;
  readonly resolveActiveComposerTrigger: () => { trigger: ComposerTrigger | null };
  readonly readComposerSnapshot: () => { value: string };
  readonly applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { expandedCursorAfterReplace?: number },
  ) => boolean;
  readonly submitComposer: (
    event: undefined,
    dispatchMode: ComposerDispatchMode,
    submissionIntent: ComposerSubmissionIntent,
  ) => void;
}) {
  const {
    keybindings,
    sendShortcut,
    routeKind,
    phase,
    isCompacting,
    followUpBehavior,
    isSoftwareKeyboardOpen,
    planModeUiEnabled,
    isLiteralPendingAnswer,
    dictation,
    pendingUserInputs,
    promptHistoryMessages,
    promptHistoryPositionRef,
    composerDraftTarget,
    promptRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    composerPreviewAnnotations,
    composerReviewComments,
    composerEditorRef,
    composerMenuOpenRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    setComposerDraftPrompt,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,
    dismissComposerTrigger,
    toggleInteractionMode,
    nudgeComposerMenuHighlight,
    onSelectComposerItem,
    resolveActiveComposerTrigger,
    readComposerSnapshot,
    applyPromptReplacement,
    submitComposer,
  } = input;

  const promptHistoryTargetKey = composerTargetKey(composerDraftTarget);
  const promptHistoryMessagesRef = useRef(promptHistoryMessages);
  useLayoutEffect(() => {
    promptHistoryMessagesRef.current = promptHistoryMessages;
  }, [promptHistoryMessages]);

  const replacePromptFromHistory = (prompt: string) => {
    setComposerDraftPrompt(composerDraftTarget, prompt);
    const endPosition = prompt.length;
    composerEditorRef.current?.replacePrompt(prompt, endPosition);
    setComposerCursor(endPosition);
    dismissComposerTrigger(resolveActiveComposerTrigger().trigger);
    composerMenuOpenRef.current = false;
  };

  const navigatePromptHistory = (
    direction: "backward" | "forward",
    event?: { preventDefault: () => void },
  ) => {
    if (
      pendingUserInputs.length > 0 ||
      composerImagesRef.current.length > 0 ||
      composerFilesRef.current.length > 0 ||
      composerTerminalContextsRef.current.length > 0 ||
      composerPreviewAnnotations.length > 0 ||
      composerReviewComments.length > 0
    ) {
      return false;
    }
    const currentPosition = promptHistoryPositionRef.current;
    const position =
      currentPosition && currentPosition.targetKey === promptHistoryTargetKey
        ? currentPosition.position
        : null;
    const isAtEnd =
      (composerEditorRef.current?.readSelectionRange()?.start ?? 0) === promptRef.current.length;
    const isAtStart = (composerEditorRef.current?.readSelectionRange()?.start ?? 0) === 0;
    if (direction === "backward" && !position && !isAtEnd) {
      return false;
    }
    if (direction === "forward" && position && isAtEnd) {
      event?.preventDefault();
    }
    if (direction === "backward" && (position || isAtEnd)) {
      event?.preventDefault();
    }
    if (direction === "forward" && !position && !isAtStart) {
      return false;
    }
    const step = stepComposerPromptHistory({
      direction,
      entries: buildComposerPromptHistoryEntries(promptHistoryMessagesRef.current),
      position,
      currentPrompt: promptRef.current,
    });
    if (!step) return false;
    promptHistoryPositionRef.current = step.position
      ? { targetKey: promptHistoryTargetKey, position: step.position }
      : null;
    replacePromptFromHistory(step.prompt);
    return true;
  };

  const onComposerCommandKey = (key: string, event: KeyboardEvent, isTaskItem = false) => {
    if (dictation?.isBusy) {
      if (key === "Escape") {
        event.preventDefault();
        dictation.cancel();
        return true;
      }
      if (key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (dictation.presentation.confirmationEnabled) {
          dictation.stop();
        }
        return true;
      }
      return true;
    }

    const submissionIntent = composerSubmissionIntentForKey({
      event,
      keybindings,
      isSoftwareKeyboardOpen,
      isDraftThread: routeKind === "draft",
      isRunning: phase === "running",
      sendShortcut,
      prompt: promptRef.current,
    });
    if (key === "Tab" && event.shiftKey && submissionIntent === null) {
      if (!planModeUiEnabled) return false;
      toggleInteractionMode();
      return true;
    }
    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive =
      !isLiteralPendingAnswer && (composerMenuOpenRef.current || trigger !== null);
    if (key === "Escape") {
      if (!menuIsActive || event.isComposing || event.keyCode === 229) return false;
      dismissComposerTrigger(trigger);
      composerMenuOpenRef.current = false;
      return true;
    }
    if (menuIsActive && (submissionIntent === null || submissionIntent === "foreground")) {
      const currentItems = composerMenuItemsRef.current;
      const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if ((key === "Enter" || key === "Tab") && selectedItem) {
        onSelectComposerItem(selectedItem);
        return true;
      }
    }
    if ((key === "ArrowUp" || key === "ArrowDown") && submissionIntent === null) {
      return navigatePromptHistory(key === "ArrowUp" ? "backward" : "forward", event);
    }
    if (submissionIntent) {
      submitComposer(
        undefined,
        resolveComposerDispatchMode({
          running: phase === "running",
          alternateModifier: submissionIntent === "alternate",
          activeTurnDefault: followUpBehavior,
          canSteer: !isCompacting,
        }),
        submissionIntent,
      );
      return true;
    }
    if (key === "Enter" && isTaskItem) return false;
    if (
      !isLiteralPendingAnswer &&
      !event.isComposing &&
      (key === "Enter" || (key === "Tab" && !event.shiftKey))
    ) {
      const selection = composerEditorRef.current?.readSelectionRange();
      const snapshot = readComposerSnapshot();
      if (selection && selection.start === selection.end && snapshot.value === promptRef.current) {
        const edit =
          key === "Enter"
            ? listContinuationForEnter(snapshot.value, selection.start)
            : listIndentForTab(snapshot.value, selection.start, selection.end);
        if (
          edit &&
          applyPromptReplacement(edit.start, edit.end, edit.replacement, {
            expandedCursorAfterReplace: edit.cursorAfter,
          })
        ) {
          return true;
        }
      }
    }
    return false;
  };

  return {
    onComposerCommandKey,
  };
}
