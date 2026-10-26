import { decodeWavToFloat32 } from "@t3tools/shared/audioWav";

// Runs in a forked Node-mode child process so transformer weight downloads and ONNX inference
// cannot stall or crash the main desktop process.

process.once("disconnect", () => process.exit(0));

export type VoiceTranscriptionWorkerRequest =
  | {
      readonly type: "prepare";
      readonly requestId: string;
      readonly cacheDir: string;
      readonly modelName?: string | undefined;
    }
  | {
      readonly type: "transcribe";
      readonly requestId: string;
      readonly audioData:
        | Uint8Array
        | ArrayBuffer
        | number[]
        | { readonly type: "Buffer"; readonly data: number[] }
        | Record<string, number>;
      readonly mimeType?: string | undefined;
    }
  | {
      readonly type: "cancel";
      readonly requestId: string;
    };

export type VoiceTranscriptionWorkerResponse =
  | {
      readonly type: "ready";
    }
  | {
      readonly type: "prepare_result";
      readonly requestId: string;
      readonly success: boolean;
      readonly modelName: string;
      readonly locale: string;
      readonly error?: string | undefined;
    }
  | {
      readonly type: "transcribe_result";
      readonly requestId: string;
      readonly success: boolean;
      readonly text?: string | undefined;
      readonly error?: string | undefined;
    };

const cancelledRequestIds = new Set<string>();

// Cached pipeline across requests in this worker process
let cachedPipeline: any = null;
let cachedModelName: string | null = null;

export function normalizeAudioBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  if (Array.isArray(raw)) {
    return Uint8Array.from(raw);
  }
  if (typeof raw === "object" && raw !== null) {
    if ("type" in raw && raw.type === "Buffer" && "data" in raw && Array.isArray(raw.data)) {
      return Uint8Array.from(raw.data);
    }
    // JSON-serialized Uint8Array over default Node IPC becomes { "0": 82, "1": 73, ... }
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) {
      return new Uint8Array(0);
    }
    const bytes = new Uint8Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const value = record[String(i)];
      bytes[i] = typeof value === "number" ? value : 0;
    }
    return bytes;
  }
  return new Uint8Array(0);
}

async function handlePrepare(
  request: Extract<VoiceTranscriptionWorkerRequest, { type: "prepare" }>,
) {
  const modelName = request.modelName || "onnx-community/moonshine-base-ONNX";
  const locale = "en";

  if (cancelledRequestIds.has(request.requestId)) {
    process.send?.({
      type: "prepare_result",
      requestId: request.requestId,
      success: false,
      modelName,
      locale,
      error: "Cancelled",
    } satisfies VoiceTranscriptionWorkerResponse);
    return;
  }

  try {
    const { pipeline, env } = await import("@huggingface/transformers");

    env.cacheDir = request.cacheDir;
    env.allowLocalModels = true;
    env.allowRemoteModels = true;

    if (!cachedPipeline || cachedModelName !== modelName) {
      cachedPipeline = await pipeline("automatic-speech-recognition", modelName, {
        dtype: "q4",
        device: "cpu",
      });
      cachedModelName = modelName;
    }

    if (cancelledRequestIds.has(request.requestId)) {
      process.send?.({
        type: "prepare_result",
        requestId: request.requestId,
        success: false,
        modelName,
        locale,
        error: "Cancelled",
      } satisfies VoiceTranscriptionWorkerResponse);
      return;
    }

    process.send?.({
      type: "prepare_result",
      requestId: request.requestId,
      success: true,
      modelName,
      locale,
    } satisfies VoiceTranscriptionWorkerResponse);
  } catch (error: any) {
    process.send?.({
      type: "prepare_result",
      requestId: request.requestId,
      success: false,
      modelName,
      locale,
      error: error instanceof Error ? error.message : String(error),
    } satisfies VoiceTranscriptionWorkerResponse);
  }
}

async function handleTranscribe(
  request: Extract<VoiceTranscriptionWorkerRequest, { type: "transcribe" }>,
) {
  if (cancelledRequestIds.has(request.requestId)) {
    process.send?.({
      type: "transcribe_result",
      requestId: request.requestId,
      success: false,
      error: "Cancelled",
    } satisfies VoiceTranscriptionWorkerResponse);
    return;
  }

  try {
    if (!cachedPipeline) {
      throw new Error("Voice transcription model is not prepared.");
    }

    const audioBytes = normalizeAudioBytes(request.audioData);
    const float32Samples = decodeWavToFloat32(audioBytes);

    if (float32Samples.length === 0) {
      process.send?.({
        type: "transcribe_result",
        requestId: request.requestId,
        success: true,
        text: "",
      } satisfies VoiceTranscriptionWorkerResponse);
      return;
    }

    if (cancelledRequestIds.has(request.requestId)) {
      process.send?.({
        type: "transcribe_result",
        requestId: request.requestId,
        success: false,
        error: "Cancelled",
      } satisfies VoiceTranscriptionWorkerResponse);
      return;
    }

    const result = await cachedPipeline(float32Samples);

    if (cancelledRequestIds.has(request.requestId)) {
      process.send?.({
        type: "transcribe_result",
        requestId: request.requestId,
        success: false,
        error: "Cancelled",
      } satisfies VoiceTranscriptionWorkerResponse);
      return;
    }

    const text =
      typeof result === "object" && result !== null && "text" in result
        ? String(result.text).trim()
        : Array.isArray(result) && result[0] && "text" in result[0]
          ? String(result[0].text).trim()
          : "";

    process.send?.({
      type: "transcribe_result",
      requestId: request.requestId,
      success: true,
      text,
    } satisfies VoiceTranscriptionWorkerResponse);
  } catch (error: any) {
    process.send?.({
      type: "transcribe_result",
      requestId: request.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies VoiceTranscriptionWorkerResponse);
  }
}

if (typeof process.send === "function") {
  process.on("message", (rawMessage: unknown) => {
    if (typeof rawMessage !== "object" || rawMessage === null) return;
    const message = rawMessage as VoiceTranscriptionWorkerRequest;

    if (message.type === "cancel") {
      cancelledRequestIds.add(message.requestId);
    } else if (message.type === "prepare") {
      void handlePrepare(message);
    } else if (message.type === "transcribe") {
      void handleTranscribe(message);
    }
  });

  // Notify parent that the worker process is alive and listening
  process.send({ type: "ready" } satisfies VoiceTranscriptionWorkerResponse);
}
