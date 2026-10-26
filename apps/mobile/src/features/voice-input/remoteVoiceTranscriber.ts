import {
  throwIfVoiceTranscriptionAborted,
  VoiceTranscriptionError,
  type PreparedVoiceTranscription,
  type VoiceTranscriber,
  type VoiceTranscriptionOptions,
} from "@t3tools/client-runtime/voice-input";
import { File } from "expo-file-system";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  "3gp": "audio/3gpp",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
};

export type RemoteVoiceTranscription = (
  audioBase64: string,
  mimeType: string,
  locale: string,
) => Promise<{ readonly text: string; readonly locale: string }>;

function deviceLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

export function mimeTypeForRecording(uri: string): string {
  const extension = uri.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "audio/mp4";
}

/** Records on the device and lets the connected environment transcribe the upload. */
export function createRemoteVoiceTranscriber(
  transcribe: RemoteVoiceTranscription,
): VoiceTranscriber {
  return {
    prepare: (options) => prepareRemoteVoiceTranscription(deviceLocale(), transcribe, options),
  };
}

async function prepareRemoteVoiceTranscription(
  locale: string,
  transcribe: RemoteVoiceTranscription,
  { signal }: VoiceTranscriptionOptions,
): Promise<PreparedVoiceTranscription> {
  throwIfVoiceTranscriptionAborted(signal);
  return {
    locale,
    transcribe: (uri, options) => transcribeVoiceRecording(uri, locale, transcribe, options),
  };
}

async function transcribeVoiceRecording(
  uri: string,
  locale: string,
  transcribe: RemoteVoiceTranscription,
  { signal }: VoiceTranscriptionOptions,
): Promise<string> {
  try {
    throwIfVoiceTranscriptionAborted(signal);
    const audioBase64 = await new File(uri).base64();
    throwIfVoiceTranscriptionAborted(signal);
    const result = await transcribe(audioBase64, mimeTypeForRecording(uri), locale);
    throwIfVoiceTranscriptionAborted(signal);
    return result.text;
  } catch (error) {
    throwIfVoiceTranscriptionAborted(signal);
    if (error instanceof VoiceTranscriptionError) throw error;
    throw new VoiceTranscriptionError(
      "transcription-failed",
      "The connected environment could not transcribe this recording.",
      { cause: error },
    );
  }
}
