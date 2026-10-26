import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
} from "./controller.ts";
import type { VoiceTranscriber } from "./transcription.ts";

export type VoiceInputTarget = {
  readonly ownerKey: string;
  readonly label?: string;
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: VoiceInputControllerDependencies["commitDraft"];
  readonly subscribe: () => () => void;
  /** Per-composer transcription source; a remote server transcriber wins over the local one. */
  readonly transcriber?: VoiceTranscriber | null;
};

export function createVoiceInputTarget(
  ownerKey: string,
  readText: () => string | null,
  commitDraft: VoiceInputTarget["commitDraft"],
  selection: VoiceDraftSnapshot["selection"],
  subscribeToChanges: (onChange: () => void) => () => void,
  transcriber?: VoiceTranscriber | null,
): VoiceInputTarget {
  let revision = 0;
  return {
    ownerKey,
    ...(transcriber === undefined ? {} : { transcriber }),
    readDraft: () => {
      const text = readText();
      if (text === null) return null;
      return { ownerKey, text, selection, revision };
    },
    commitDraft,
    subscribe: () => {
      let previousText = readText();
      return subscribeToChanges(() => {
        const text = readText();
        if (text !== previousText) {
          previousText = text;
          revision += 1;
        }
      });
    },
  };
}

export class VoiceInputSession {
  readonly controller: VoiceInputController;
  private target: VoiceInputTarget | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(dependencies: Omit<VoiceInputControllerDependencies, "readDraft" | "commitDraft">) {
    this.controller = new VoiceInputController({
      ...dependencies,
      getTranscriber: () => this.target?.transcriber ?? dependencies.getTranscriber(),
      onStateChange: (state) => {
        if (!voiceInputBlocksSubmission(state)) {
          this.unsubscribe?.();
          this.unsubscribe = null;
        }
        dependencies.onStateChange(state);
      },
      readDraft: () => this.target?.readDraft() ?? null,
      commitDraft: (text, selection) => this.target?.commitDraft(text, selection),
    });
  }

  get ownerKey(): string | null {
    return this.target?.ownerKey ?? null;
  }

  get label(): string | null {
    return this.target?.label ?? null;
  }

  cancel(ownerKey: string | null): void {
    if (ownerKey !== null && this.ownerKey === ownerKey) this.controller.cancel();
  }

  retry(): Promise<void> {
    return this.target ? this.start(this.target) : Promise.resolve();
  }

  start(target: VoiceInputTarget): Promise<void> {
    if (voiceInputBlocksSubmission(this.controller.currentState)) return Promise.resolve();
    this.target = target;
    this.unsubscribe = target.subscribe();
    return this.controller.start();
  }
}
