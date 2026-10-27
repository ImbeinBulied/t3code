import { memo } from "react";
import { ComposerDictationBar, ComposerDictationButton } from "./ComposerDictationBar";
import { ComposerPolishBar, ComposerPolishButton } from "./ComposerPolishBar";
import type { useComposerDictation } from "./useComposerDictation";
import type { useComposerPolish } from "./useComposerPolish";

interface ComposerForkBarsProps {
  readonly dictation: ReturnType<typeof useComposerDictation>;
  readonly polish: ReturnType<typeof useComposerPolish>;
  readonly className?: string;
}

export const ComposerForkBars = memo(function ComposerForkBars({
  dictation,
  polish,
  className = "mx-3 mb-2 sm:mx-4",
}: ComposerForkBarsProps) {
  return (
    <>
      <ComposerDictationBar dictation={dictation} className={className} />
      <ComposerPolishBar polish={polish} className={className} />
    </>
  );
});

interface ComposerForkButtonsProps {
  readonly dictation: ReturnType<typeof useComposerDictation>;
  readonly polish: ReturnType<typeof useComposerPolish>;
  readonly disabled?: boolean;
}

export const ComposerForkButtons = memo(function ComposerForkButtons({
  dictation,
  polish,
  disabled,
}: ComposerForkButtonsProps) {
  return (
    <>
      <ComposerDictationButton isBusy={dictation.isBusy} onClick={dictation.toggle} />
      <ComposerPolishButton
        isBusy={polish.isBusy}
        isDisabled={disabled || polish.isDisabled}
        onClick={polish.polishDraft}
      />
    </>
  );
});
