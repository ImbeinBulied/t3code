import {
  normalizeVoiceInputDecibels,
  VOICE_WAVEFORM_SAMPLE_COUNT,
  type VoiceRecorder,
} from "@t3tools/client-runtime/voice-input";

import { encodeMonoWav, resampleAudioBuffer } from "./wavEncoding.ts";

const VOICE_METERING_INTERVAL_MS = 80;

export interface WebVoiceRecorderOptions {
  readonly onMeteringUpdate?: ((levels: ReadonlyArray<number>) => void) | undefined;
}

export class WebVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentGainNode: GainNode | null = null;
  private recordedChunks: Float32Array[] = [];
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private audioLevels: number[] = Array(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0);
  private onMeteringUpdate?: ((levels: ReadonlyArray<number>) => void) | undefined;
  private isRecording = false;

  constructor(options: WebVoiceRecorderOptions = {}) {
    this.onMeteringUpdate = options.onMeteringUpdate;
  }

  get levels(): ReadonlyArray<number> {
    return this.audioLevels;
  }

  async prepareToRecordAsync(): Promise<void> {
    this.cleanup();
    this.recordedChunks = [];
    this.audioLevels = Array(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.stream = stream;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioContextClass();
    this.audioContext = audioContext;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    this.sourceNode = source;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    this.analyserNode = analyser;

    // Buffer size 4096, 1 input channel, 1 output channel
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode = processor;

    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    this.silentGainNode = silentGain;

    source.connect(analyser);
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
  }

  record(_options?: { readonly forDuration?: number }): void {
    if (!this.processorNode || !this.analyserNode) {
      throw new Error("WebVoiceRecorder is not prepared.");
    }

    this.isRecording = true;
    this.recordedChunks = [];

    this.processorNode.onaudioprocess = (event) => {
      if (!this.isRecording) return;
      const inputBuffer = event.inputBuffer.getChannelData(0);
      this.recordedChunks.push(new Float32Array(inputBuffer));
    };

    const timeData = new Float32Array(this.analyserNode.fftSize);
    this.meteringInterval = setInterval(() => {
      if (!this.analyserNode || !this.isRecording) return;

      this.analyserNode.getFloatTimeDomainData(timeData);
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const val = timeData[i] ?? 0;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / timeData.length);
      const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
      const normalized = normalizeVoiceInputDecibels(db);

      this.audioLevels = [...this.audioLevels.slice(1), normalized];
      this.onMeteringUpdate?.(this.audioLevels);
    }, VOICE_METERING_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.isRecording = false;

    if (this.meteringInterval) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    const chunks = this.recordedChunks;
    const currentSampleRate = this.audioContext?.sampleRate ?? 16000;

    this.cleanup();

    // Flatten chunks
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Resample to 16 kHz if necessary
    const resampled =
      currentSampleRate !== 16000
        ? resampleAudioBuffer(combined, currentSampleRate, 16000)
        : combined;

    // Encode to WAV Blob
    const wavBlob = encodeMonoWav(resampled, 16000);
    const uri = URL.createObjectURL(wavBlob);
    this.uri = uri;
  }

  deleteRecording(): void {
    if (this.uri) {
      URL.revokeObjectURL(this.uri);
      this.uri = null;
    }
  }

  private cleanup(): void {
    if (this.meteringInterval) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      try {
        this.processorNode.disconnect();
      } catch {}
      this.processorNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {}
      this.analyserNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    if (this.silentGainNode) {
      try {
        this.silentGainNode.disconnect();
      } catch {}
      this.silentGainNode = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  dispose(): void {
    this.isRecording = false;
    this.cleanup();
    this.deleteRecording();
  }
}
