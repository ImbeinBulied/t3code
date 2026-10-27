import {
  PromptPolishController,
  type PromptPolishControllerDependencies,
  type PromptPolishState,
  type PromptPolishTarget,
} from "./controller.ts";

export function createPromptPolishTarget(
  ownerKey: string,
  readText: () => string | null,
  commitDraft: (text: string) => void,
  subscribeToChanges: (onChange: () => void) => () => void,
): PromptPolishTarget {
  let revision = 0;
  return {
    ownerKey,
    readDraft: () => {
      const text = readText();
      if (text === null) return null;
      return { ownerKey, text, revision };
    },
    commitDraft: (nextText: string) => {
      commitDraft(nextText);
      revision += 1;
    },
    subscribe: (onChange) => {
      let previousText = readText();
      return subscribeToChanges(() => {
        const text = readText();
        if (text !== previousText) {
          previousText = text;
          revision += 1;
          onChange?.();
        }
      });
    },
  };
}

export class PromptPolishSession {
  readonly controller: PromptPolishController;
  private target: PromptPolishTarget | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(dependencies: Omit<PromptPolishControllerDependencies, "readDraft" | "commitDraft">) {
    this.controller = new PromptPolishController({
      ...dependencies,
      readDraft: () => this.target?.readDraft() ?? null,
      commitDraft: (text) => this.target?.commitDraft(text),
    });
  }

  setPolishPrompt(
    fn: (input: {
      readonly draft: string;
      readonly signal?: AbortSignal | undefined;
    }) => Promise<{ readonly polished: string }>,
  ): void {
    this.controller.setPolishPrompt(fn);
  }

  get ownerKey(): string | null {
    return this.target?.ownerKey ?? null;
  }

  get currentState(): PromptPolishState {
    return this.controller.currentState;
  }

  start(target: PromptPolishTarget): Promise<void> {
    if (this.target !== target) {
      this.unsubscribe?.();
      if (this.target !== null && this.target.ownerKey !== target.ownerKey) {
        this.controller.ownerChanged();
      }
      this.target = target;
      this.unsubscribe = target.subscribe(() => this.controller.draftChanged());
    }
    return this.controller.start();
  }

  apply(): void {
    this.controller.apply();
  }

  cancel(ownerKey?: string | null): void {
    if (ownerKey === undefined || ownerKey === null || this.ownerKey === ownerKey) {
      this.controller.cancel();
    }
  }

  ownerChanged(nextOwnerKey?: string | null): void {
    if (
      this.target !== null &&
      (nextOwnerKey === undefined || this.target.ownerKey !== nextOwnerKey)
    ) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.target = null;
      this.controller.ownerChanged();
    }
  }

  restoreOriginal(): void {
    this.controller.restoreOriginal();
  }

  dismissError(): void {
    this.controller.dismissError();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.target = null;
    this.controller.dispose();
  }
}
