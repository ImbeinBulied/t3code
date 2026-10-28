import { memo } from "react";
import { ComposerDictationBar } from "./ComposerDictationBar";
import { ComposerPolishBar } from "./ComposerPolishBar";
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
