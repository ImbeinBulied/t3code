import type { DesktopBridge } from "@t3tools/contracts";
import {
  throwIfVoiceTranscriptionAborted,
  VoiceTranscriptionError,
  type PreparedVoiceTranscription,
  type VoiceTranscriber,
  type VoiceTranscriptionOptions,
} from "@t3tools/client-runtime/voice-input";

function getDesktopBridge(): DesktopBridge | undefined {
  if (typeof globalThis !== "undefined" && (globalThis as any).desktopBridge) {
    return (globalThis as any).desktopBridge;
  }
  if (
    typeof window !== "undefined" &&
    (window as unknown as { desktopBridge?: DesktopBridge }).desktopBridge
  ) {
    return (window as unknown as { desktopBridge?: DesktopBridge }).desktopBridge;
  }
  return undefined;
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throwIfVoiceTranscriptionAborted(signal);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      try {
        throwIfVoiceTranscriptionAborted(signal);
      } catch (err) {
        reject(err);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function createDesktopVoiceTranscriber(): VoiceTranscriber | null {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge?.voiceInput) return null;

  const bridge = desktopBridge.voiceInput;

  return {
    async prepare(options: VoiceTranscriptionOptions): Promise<PreparedVoiceTranscription> {
      throwIfVoiceTranscriptionAborted(options.signal);

      const requestId = `prep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const onAbort = () => {
        void bridge.cancel({ requestId });
      };

      if (options.signal.aborted) {
        onAbort();
        throwIfVoiceTranscriptionAborted(options.signal);
      }

      options.signal.addEventListener("abort", onAbort, { once: true });

      try {
        const prepResult = await raceWithSignal(bridge.prepare({ requestId }), options.signal);
        options.signal.removeEventListener("abort", onAbort);
        throwIfVoiceTranscriptionAborted(options.signal);

        return {
          locale: prepResult.locale,
          async transcribe(
            uri: string,
            transcribeOptions: VoiceTranscriptionOptions,
          ): Promise<string> {
            throwIfVoiceTranscriptionAborted(transcribeOptions.signal);

            const transcribeRequestId = `trans-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const onTranscribeAbort = () => {
              void bridge.cancel({ requestId: transcribeRequestId });
            };

            if (transcribeOptions.signal.aborted) {
              onTranscribeAbort();
              throwIfVoiceTranscriptionAborted(transcribeOptions.signal);
            }

            transcribeOptions.signal.addEventListener("abort", onTranscribeAbort, { once: true });

            try {
              const res = await fetch(uri);
              if (!res.ok) {
                throw new VoiceTranscriptionError(
                  "transcription-failed",
                  `Failed to read recorded audio: ${res.statusText}`,
                );
              }
              const buffer = await res.arrayBuffer();
              const audioData = new Uint8Array(buffer);

              throwIfVoiceTranscriptionAborted(transcribeOptions.signal);

              const result = await raceWithSignal(
                bridge.transcribe({
                  requestId: transcribeRequestId,
                  audioData,
                  mimeType: "audio/wav",
                }),
                transcribeOptions.signal,
              );

              transcribeOptions.signal.removeEventListener("abort", onTranscribeAbort);
              throwIfVoiceTranscriptionAborted(transcribeOptions.signal);

              return result.text;
            } catch (error: any) {
              transcribeOptions.signal.removeEventListener("abort", onTranscribeAbort);
              if (
                transcribeOptions.signal.aborted ||
                (error instanceof Error && error.message.toLowerCase().includes("cancelled"))
              ) {
                throw new VoiceTranscriptionError(
                  "cancelled",
                  "Voice transcription was cancelled.",
                  { cause: error },
                );
              }
              throw error;
            }
          },
        };
      } catch (error: any) {
        options.signal.removeEventListener("abort", onAbort);
        if (
          options.signal.aborted ||
          (error instanceof Error && error.message.toLowerCase().includes("cancelled"))
        ) {
          throw new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled.", {
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}
