export type PromptPolishPhase = "idle" | "polishing" | "preview" | "error";

export type PromptPolishDraftSnapshot = {
  readonly ownerKey: string;
  readonly text: string;
  readonly revision: number;
};

export type PromptPolishState = {
  readonly phase: PromptPolishPhase;
  readonly ownerKey: string | null;
  readonly originalDraft: PromptPolishDraftSnapshot | null;
  readonly polishedText: string | null;
  readonly error: string | null;
  readonly restorableOriginal: {
    readonly ownerKey: string;
    readonly text: string;
    readonly originalText: string;
    readonly appliedText: string;
    readonly appliedRevision: number;
  } | null;
};

export type PromptPolishTarget = {
  readonly ownerKey: string;
  readonly readDraft: () => PromptPolishDraftSnapshot | null;
  readonly commitDraft: (text: string) => void;
  readonly subscribe: (onChange?: () => void) => () => void;
};

export type PromptPolishControllerDependencies = {
  readonly polishPrompt: (input: {
    readonly draft: string;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<{ readonly polished: string }>;
  readonly readDraft: () => PromptPolishDraftSnapshot | null;
  readonly commitDraft: (text: string) => void;
  readonly onStateChange: (state: PromptPolishState) => void;
};

const IDLE_STATE: PromptPolishState = {
  phase: "idle",
  ownerKey: null,
  originalDraft: null,
  polishedText: null,
  error: null,
  restorableOriginal: null,
};

export class PromptPolishController {
  private state: PromptPolishState = IDLE_STATE;
  private activeOperationId = 0;
  private activeAbortController: AbortController | null = null;
  private dependencies: PromptPolishControllerDependencies;

  constructor(dependencies: PromptPolishControllerDependencies) {
    this.dependencies = dependencies;
  }

  get currentState(): PromptPolishState {
    return this.state;
  }

  setPolishPrompt(
    fn: (input: {
      readonly draft: string;
      readonly signal?: AbortSignal | undefined;
    }) => Promise<{ readonly polished: string }>,
  ): void {
    this.dependencies = {
      ...this.dependencies,
      polishPrompt: fn,
    };
  }

  start(): Promise<void> {
    const draft = this.dependencies.readDraft();
    if (!draft || draft.text.trim().length === 0) {
      return Promise.resolve();
    }

    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const operationId = ++this.activeOperationId;
    this.transitionTo({
      phase: "polishing",
      ownerKey: draft.ownerKey,
      originalDraft: draft,
      polishedText: null,
      error: null,
      restorableOriginal: this.state.restorableOriginal,
    });

    return this.dependencies
      .polishPrompt({ draft: draft.text, signal: abortController.signal })
      .then((result) => {
        if (operationId !== this.activeOperationId) {
          return;
        }
        this.activeAbortController = null;

        const currentDraft = this.dependencies.readDraft();
        if (
          !currentDraft ||
          currentDraft.ownerKey !== draft.ownerKey ||
          currentDraft.revision !== draft.revision ||
          currentDraft.text !== draft.text
        ) {
          this.transitionTo({
            ...IDLE_STATE,
            restorableOriginal: this.state.restorableOriginal,
          });
          return;
        }

        this.transitionTo({
          phase: "preview",
          ownerKey: draft.ownerKey,
          originalDraft: draft,
          polishedText: result.polished,
          error: null,
          restorableOriginal: this.state.restorableOriginal,
        });
      })
      .catch((error) => {
        if (operationId !== this.activeOperationId) {
          return;
        }
        this.activeAbortController = null;

        if (
          (error && typeof error === "object" && "name" in error && error.name === "AbortError") ||
          abortController.signal.aborted
        ) {
          this.transitionTo({
            ...IDLE_STATE,
            restorableOriginal: this.state.restorableOriginal,
          });
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Failed to polish draft.";

        this.transitionTo({
          phase: "error",
          ownerKey: draft.ownerKey,
          originalDraft: draft,
          polishedText: null,
          error: message,
          restorableOriginal: this.state.restorableOriginal,
        });
      });
  }

  apply(): void {
    if (this.state.phase !== "preview" || !this.state.polishedText || !this.state.originalDraft) {
      return;
    }

    const { originalDraft, polishedText } = this.state;
    const currentDraft = this.dependencies.readDraft();
    if (
      !currentDraft ||
      currentDraft.ownerKey !== originalDraft.ownerKey ||
      currentDraft.revision !== originalDraft.revision ||
      currentDraft.text !== originalDraft.text
    ) {
      this.transitionTo({
        ...IDLE_STATE,
        restorableOriginal: this.state.restorableOriginal,
      });
      return;
    }

    this.dependencies.commitDraft(polishedText);

    this.transitionTo({
      phase: "idle",
      ownerKey: null,
      originalDraft: null,
      polishedText: null,
      error: null,
      restorableOriginal: {
        ownerKey: originalDraft.ownerKey,
        text: originalDraft.text,
        originalText: originalDraft.text,
        appliedText: polishedText,
        appliedRevision: this.dependencies.readDraft()?.revision ?? currentDraft.revision,
      },
    });
  }

  restoreOriginal(): void {
    if (!this.state.restorableOriginal) {
      return;
    }

    const { restorableOriginal } = this.state;
    const currentDraft = this.dependencies.readDraft();
    if (
      !currentDraft ||
      currentDraft.ownerKey !== restorableOriginal.ownerKey ||
      currentDraft.text !== restorableOriginal.appliedText ||
      currentDraft.revision !== restorableOriginal.appliedRevision
    ) {
      this.transitionTo({
        ...this.state,
        restorableOriginal: null,
      });
      return;
    }

    this.dependencies.commitDraft(restorableOriginal.originalText);

    this.transitionTo({
      ...this.state,
      restorableOriginal: null,
    });
  }

  draftChanged(): void {
    const original = this.state.restorableOriginal;
    if (!original) return;
    const draft = this.dependencies.readDraft();
    if (
      !draft ||
      draft.ownerKey !== original.ownerKey ||
      draft.text !== original.appliedText ||
      draft.revision !== original.appliedRevision
    ) {
      this.transitionTo({ ...this.state, restorableOriginal: null });
    }
  }

  cancel(): void {
    this.activeOperationId++;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.transitionTo({
      phase: "idle",
      ownerKey: null,
      originalDraft: null,
      polishedText: null,
      error: null,
      restorableOriginal: null,
    });
  }

  ownerChanged(): void {
    this.cancel();
    if (this.state.restorableOriginal !== null) {
      this.transitionTo({
        ...this.state,
        restorableOriginal: null,
      });
    }
  }

  dismissError(): void {
    if (this.state.phase === "error") {
      this.transitionTo({
        phase: "idle",
        ownerKey: null,
        originalDraft: null,
        polishedText: null,
        error: null,
        restorableOriginal: this.state.restorableOriginal,
      });
    }
  }

  dispose(): void {
    this.activeOperationId++;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  private transitionTo(nextState: PromptPolishState): void {
    this.state = nextState;
    this.dependencies.onStateChange(nextState);
  }
}
