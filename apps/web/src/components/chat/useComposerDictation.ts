import {
  createVoiceInputTarget,
  resolveVoiceComposerPresentation,
  VOICE_WAVEFORM_SAMPLE_COUNT,
  VoiceInputSession,
  voiceInputBlocksSubmission,
  type VoiceComposerPresentation,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import { useEffect, useRef, useState } from "react";

import { createDesktopVoiceTranscriber } from "../../lib/voice/desktopVoiceTranscriber.ts";
import { WebVoiceRecorder } from "../../lib/voice/webVoiceRecorder.ts";

export type UseComposerDictationInput = {
  readonly ownerKey: string;
  readonly readPrompt: () => string;
  readonly subscribeToChanges?: ((onChange: () => void) => () => void) | undefined;
  readonly readSelectionRange: () => { readonly start: number; readonly end: number };
  readonly onPromptChange: (prompt: string, expandedCursor: number) => number | void;
  readonly focusEditorAt: (cursor: number) => void;
};

export type UseComposerDictationReturn = {
  readonly isAvailable: boolean;
  readonly isBusy: boolean;
  readonly state: VoiceInputState;
  readonly presentation: VoiceComposerPresentation;
  readonly audioLevels: ReadonlyArray<number>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly cancel: () => void;
  readonly toggle: () => void;
  readonly openSettings: () => void;
};

const IDLE_STATE: VoiceInputState = {
  phase: "idle",
  error: null,
  errorAction: null,
};

function getDesktopBridge() {
  if (typeof window === "undefined") return null;
  return (window as unknown as { desktopBridge?: any }).desktopBridge ?? null;
}

function isDesktopVoiceInputAvailable(): boolean {
  const desktopBridge = getDesktopBridge();
  return Boolean(desktopBridge?.voiceInput);
}

export function useComposerDictation(input: UseComposerDictationInput): UseComposerDictationReturn {
  const isAvailable = isDesktopVoiceInputAvailable();
  const [state, setState] = useState<VoiceInputState>(IDLE_STATE);
  const [audioLevels, setAudioLevels] = useState<ReadonlyArray<number>>(() =>
    Array(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0),
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const latestInput = useRef(input);
  // oxlint-disable-next-line t3code/react-effect-budget -- lifecycle integration with dictation and speech recognition services
  useEffect(() => {
    latestInput.current = input;
  }, [input]);

  const [services] = useState(() => {
    const recorder = new WebVoiceRecorder({
      onMeteringUpdate: (levels) => {
        setAudioLevels(levels);
      },
    });
    const session = new VoiceInputSession({
      recorder,
      getTranscriber: () => createDesktopVoiceTranscriber(),
      requestPermission: async () => {
        const desktopBridge = getDesktopBridge();
        if (!desktopBridge?.voiceInput) {
          return { granted: false, canAskAgain: false };
        }
        const status = await desktopBridge.voiceInput.getMicrophoneStatus();
        if (status === "granted") {
          return { granted: true, canAskAgain: true };
        }
        if (status === "not-determined") {
          const granted = await desktopBridge.voiceInput.requestMicrophoneAccess();
          return { granted, canAskAgain: true };
        }
        return { granted: false, canAskAgain: false };
      },
      configureRecording: async () => {},
      releaseRecording: async () => {},
      deleteRecording: () => {
        recorder.deleteRecording();
      },
      onStateChange: (nextState) => {
        setState(nextState);
      },
    });
    return { recorder, session };
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- lifecycle integration with dictation and speech recognition services
  useEffect(() => {
    return () => {
      services.session.controller.dispose();
      services.recorder.dispose();
    };
  }, [services]);

  // oxlint-disable-next-line t3code/react-effect-budget -- lifecycle integration with dictation and speech recognition services
  useEffect(() => {
    if (services.session.ownerKey !== null && services.session.ownerKey !== input.ownerKey) {
      services.session.controller.ownerChanged();
    }
  }, [input.ownerKey, services]);

  // Timer for elapsed seconds during recording
  // oxlint-disable-next-line t3code/react-effect-budget -- lifecycle integration with dictation and speech recognition services
  useEffect(() => {
    if (state.phase !== "recording") {
      return;
    }
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - startTime) / 1000);
    }, 100);
    return () => {
      clearInterval(interval);
      setElapsedSeconds(0);
    };
  }, [state.phase]);

  const start = () => {
    if (!isAvailable) return;
    const captured = latestInput.current;
    const target = createVoiceInputTarget(
      captured.ownerKey,
      () => latestInput.current.readPrompt(),
      (text, selection) => {
        const maybeCollapsedCursor = latestInput.current.onPromptChange(text, selection.start);
        const focusCursor =
          typeof maybeCollapsedCursor === "number" ? maybeCollapsedCursor : selection.start;
        window.requestAnimationFrame(() => {
          latestInput.current.focusEditorAt(focusCursor);
        });
      },
      captured.readSelectionRange(),
      captured.subscribeToChanges ?? (() => () => {}),
    );
    void services.session.start(target);
  };

  const stop = () => {
    void services.session.controller.stop();
  };

  const cancel = () => {
    services.session.cancel(latestInput.current.ownerKey);
  };

  const toggle = () => {
    if (state.phase === "idle" || state.phase === "error") {
      start();
    } else if (state.phase === "recording") {
      stop();
    } else if (state.phase === "preparing" || state.phase === "transcribing") {
      cancel();
    }
  };

  const openSettings = () => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge?.openSystemSettings) {
      void desktopBridge.openSystemSettings("microphone");
    }
  };

  const effectiveElapsedSeconds = state.phase === "recording" ? elapsedSeconds : 0;
  const presentation = resolveVoiceComposerPresentation(state, effectiveElapsedSeconds);
  const isBusy = voiceInputBlocksSubmission(state);

  return {
    isAvailable,
    state,
    presentation,
    audioLevels,
    isBusy,
    start,
    stop,
    cancel,
    toggle,
    openSettings,
  };
}
