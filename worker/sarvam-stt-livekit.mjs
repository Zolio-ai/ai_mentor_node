import { shortuuid, stt } from "@livekit/agents";

const DEFAULT_BASE_URL = "https://api.sarvam.ai";

function pcm16ToWavBuffer(pcmBuffer, sampleRate = 16000, channels = 1) {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);
  return wav;
}

function extractTranscript(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.transcript === "string") return payload.transcript;
  if (typeof payload.text === "string") return payload.text;
  if (payload.data && typeof payload.data === "object") return extractTranscript(payload.data);
  if (Array.isArray(payload.results) && payload.results.length > 0) {
    const first = payload.results[0];
    if (first && typeof first.transcript === "string") return first.transcript;
    if (first && typeof first.text === "string") return first.text;
  }
  return "";
}

async function transcribe({ apiKey, baseUrl, model, languageCode, sampleRate, pcmBuffer }) {
  const wav = pcm16ToWavBuffer(pcmBuffer, sampleRate, 1);
  const body = new FormData();
  body.append("language_code", languageCode || "unknown");
  body.append("model", model);
  body.append("file", new Blob([wav], { type: "audio/wav" }), "turn.wav");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey },
    body,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Sarvam STT failed: ${res.status} ${res.statusText} ${JSON.stringify(json)}`);
  }
  return {
    transcript: extractTranscript(json).trim(),
    language: json?.language_code || languageCode || "unknown",
  };
}

export class SarvamStt extends stt.STT {
  label = "sarvam.STT";
  #opts;

  constructor(opts = {}) {
    super({ streaming: true, interimResults: false, alignedTranscript: false });
    const apiKey = opts.apiKey || process.env.SARVAM_API_KEY || process.env.SARWAM_API_KEY;
    if (!apiKey) throw new Error("SARVAM_API_KEY (or SARWAM_API_KEY) is required");
    this.#opts = {
      apiKey,
      baseUrl: opts.baseUrl || process.env.SARVAM_API_BASE_URL || DEFAULT_BASE_URL,
      model: opts.model || process.env.SARVAM_STT_MODEL || "saarika:v2.5",
      languageCode: opts.languageCode || process.env.SARVAM_STT_LANGUAGE || "en-IN",
      sampleRate: Number(opts.sampleRate || process.env.SARVAM_STT_SAMPLE_RATE || 16000),
    };
  }

  get model() {
    return this.#opts.model;
  }

  get provider() {
    return "Sarvam";
  }

  async _recognize() {
    throw new Error("Sarvam STT recognize() is not implemented; use stream()");
  }

  stream(options) {
    return new SarvamSpeechStream(this, this.#opts, options?.connOptions);
  }
}

class SarvamSpeechStream extends stt.SpeechStream {
  label = "sarvam.SpeechStream";
  #opts;
  #maxChunkBytes;

  constructor(sttInstance, opts, connOptions) {
    super(sttInstance, opts.sampleRate, connOptions);
    this.#opts = opts;
    const maxChunkSeconds = Number(process.env.SARVAM_STT_MAX_CHUNK_SECONDS || 1);
    this.#maxChunkBytes = Math.max(1, Math.floor(opts.sampleRate * 2 * maxChunkSeconds));
  }

  async #emitTurn(chunks) {
    if (!chunks.length) return;
    const pcmBuffer = Buffer.concat(chunks);
    const requestId = shortuuid();
    const { transcript, language } = await transcribe({ ...this.#opts, pcmBuffer });
    if (!transcript) return;

    const alt = {
      language,
      text: transcript,
      startTime: this.startTimeOffset,
      endTime: this.startTimeOffset + 0.01,
      confidence: 1,
    };
    this.queue.put({ type: stt.SpeechEventType.START_OF_SPEECH, requestId });
    this.queue.put({ type: stt.SpeechEventType.FINAL_TRANSCRIPT, requestId, alternatives: [alt] });
    this.queue.put({ type: stt.SpeechEventType.END_OF_SPEECH, requestId, alternatives: [alt] });
  }

  async run() {
    let chunks = [];
    let totalBytes = 0;
    while (!this.closed) {
      const next = await this.input.next();
      if (next.done) {
        await this.#emitTurn(chunks);
        break;
      }
      const frame = next.value;
      if (frame === stt.SpeechStream.FLUSH_SENTINEL) {
        await this.#emitTurn(chunks);
        chunks = [];
        totalBytes = 0;
        continue;
      }
      const bytes = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      chunks.push(bytes);
      totalBytes += bytes.length;
      if (totalBytes >= this.#maxChunkBytes) {
        await this.#emitTurn(chunks);
        chunks = [];
        totalBytes = 0;
      }
    }
  }
}
