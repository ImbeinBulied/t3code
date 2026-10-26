import type { EnvironmentId } from "@t3tools/contracts";
import { Platform } from "react-native";

import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";
import { createRemoteVoiceTranscriber } from "./remoteVoiceTranscriber";

/**
 * Android records locally and sends the audio to the connected environment, which owns the
 * speech model. iOS keeps Apple's on-device transcription.
 */
export function useMobileVoiceTranscriber(environmentId: EnvironmentId | null | undefined) {
  const transcribeVoice = useAtomCommand(orchestrationEnvironment.transcribeVoice, {
    reportFailure: false,
  });
  if (Platform.OS !== "android" || environmentId === undefined || environmentId === null) {
    return undefined;
  }
  return createRemoteVoiceTranscriber(async (audioBase64, mimeType) => {
    const result = await transcribeVoice({
      environmentId,
      input: { audioBase64, mimeType },
    });
    if (result._tag !== "Success") {
      throw new Error("The connected environment could not transcribe this recording.");
    }
    return result.value;
  });
}
