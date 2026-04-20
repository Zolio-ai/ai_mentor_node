import { AudioByteStream, shortuuid, tts } from "@livekit/agents";

const DEFAULT_BASE_URL = "https://api.sarvam.ai";

function extractAudioBase64(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.audio === "string") return payload.audio;
  if (typeof payload.audio_base64 === "string") return payload.audio_base64;
  if (Array.isArray(payload.audios) && typeof payload.audios[0] === "string") return payload.audios[0];
  if (payload.data && typeof payload.data === "object") return extractAudioBase64(payload.data);
  return "";
}

async function requestTts({ apiKey, baseUrl, model, speaker, languageCode, sampleRate, text }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/text-to-speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": apiKey },
    body: JSON.stringify({
      text,
      model,
      speaker,
      sample_rate: sampleRate,
      target_language_code: languageCode || "en-IN",
    }),
  });
  return { res, json: await res.json().catch(() => null) };
}

async function synthesize(opts) {
  const { res, json } = await requestTts(opts);
  if (!res.ok) {
    throw new Error(`Sarvam TTS failed: ${res.status} ${res.statusText} ${JSON.stringify(json)}`);
  }
  const audio = extractAudioBase64(json);
  if (!audio) throw new Error(`Sarvam TTS returned no audio: ${JSON.stringify(json)}`);
  return Buffer.from(audio, "base64");
}

export class SarvamTts extends tts.TTS {
  label = "sarvam.TTS";
  #opts;

  constructor(opts = {}) {
    const sampleRate = Number(opts.sampleRate || process.env.SARVAM_TTS_SAMPLE_RATE || 24000);
    super(sampleRate, 1, { streaming: false, alignedTranscript: false });
    const apiKey = opts.apiKey || process.env.SARVAM_API_KEY || process.env.SARWAM_API_KEY;
    if (!apiKey) throw new Error("SARVAM_API_KEY (or SARWAM_API_KEY) is required");
    const model = opts.model || process.env.SARVAM_TTS_MODEL || "bulbul:v2";
    const defaultSpeaker = model === "bulbul:v3" ? "aditya" : "anushka";
    this.#opts = {
      apiKey,
      baseUrl: opts.baseUrl || process.env.SARVAM_API_BASE_URL || DEFAULT_BASE_URL,
      model,
      speaker: opts.speaker || process.env.SARVAM_TTS_SPEAKER || defaultSpeaker,
      languageCode: opts.languageCode || process.env.SARVAM_TTS_LANGUAGE || "en-IN",
      sampleRate,
    };
  }

  get model() {
    return this.#opts.model;
  }
  get provider() {
    return "Sarvam";
  }

  synthesize(text, connOptions, abortSignal) {
    return new SarvamChunkedStream(this, text, this.#opts, connOptions, abortSignal);
  }

  stream(options) {
    return new SarvamSynthesizeStream(this, this.#opts, options?.connOptions);
  }
}

class SarvamChunkedStream extends tts.ChunkedStream {
  label = "sarvam.ChunkedStream";
  #opts;
  constructor(ttsInstance, text, opts, connOptions, abortSignal) {
    super(text, ttsInstance, connOptions, abortSignal);
    this.#opts = opts;
  }
  async run() {
    const requestId = shortuuid();
    const segmentId = shortuuid();
    const bstream = new AudioByteStream(this.#opts.sampleRate, 1);
    const pcm = await synthesize({ ...this.#opts, text: this.inputText });
    for (const frame of bstream.write(pcm)) this.queue.put({ requestId, segmentId, frame, final: false });
    for (const frame of bstream.flush()) this.queue.put({ requestId, segmentId, frame, final: true });
    this.queue.close();
  }
}

class SarvamSynthesizeStream extends tts.SynthesizeStream {
  label = "sarvam.SynthesizeStream";
  #opts;
  constructor(ttsInstance, opts, connOptions) {
    super(ttsInstance, connOptions);
    this.#opts = opts;
  }
  async run() {
    for await (const text of this.input) {
      if (typeof text !== "string") continue;
      const requestId = shortuuid();
      const segmentId = shortuuid();
      const bstream = new AudioByteStream(this.#opts.sampleRate, 1);
      const pcm = await synthesize({ ...this.#opts, text });
      for (const frame of bstream.write(pcm)) this.queue.put({ requestId, segmentId, frame, final: false });
      for (const frame of bstream.flush()) this.queue.put({ requestId, segmentId, frame, final: true });
    }
    this.queue.put(tts.SynthesizeStream.END_OF_STREAM);
  }
}
