import {
  ServerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from "@livekit/agents";
import * as bey from "@livekit/agents-plugin-bey";
import { BackgroundVoiceCancellation } from "@livekit/noise-cancellation-node";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { Assistant } from "./assistant.js";
import { AVATAR_ID } from "./config.js";
import { resolveBeyConfig } from "./avatar-config.js";
import { startHealthServer } from "./health-server.js";
import { INITIAL_GREETING } from "./prompts.js";
import { forwardAssistantChatToRoom } from "./forward-assistant-chat.js";
import { SarvamStt } from "./sarvam-stt-livekit.js";
import { SarvamTts } from "./sarvam-tts-livekit.js";

dotenv.config({ path: ".env.local" });
dotenv.config();
startHealthServer();

function normalizeProvider(raw, fallback) {
  const provider = (raw || fallback).toLowerCase().trim();
  if (provider === "sarwam") return "sarvam";
  return provider;
}

function resolveStt() {
  const provider = normalizeProvider(process.env.VOICE_AGENT_STT_PROVIDER, "sarvam");
  console.info(`[voice] STT provider: ${provider}`);
  if (provider !== "sarvam") {
    throw new Error(`Unsupported STT provider "${provider}". This service is locked to Sarvam.`);
  }
  return new SarvamStt();
}

function resolveTts() {
  const provider = normalizeProvider(process.env.VOICE_AGENT_TTS_PROVIDER, "sarvam");
  console.info(`[voice] TTS provider: ${provider}`);
  if (provider !== "sarvam") {
    throw new Error(`Unsupported TTS provider "${provider}". This service is locked to Sarvam.`);
  }
  return new SarvamTts();
}

export default defineAgent({
  entry: async (ctx) => {
    ctx.logContextFields = {
      room: ctx.room.name,
    };

    const session = new voice.AgentSession({
      stt: resolveStt(),
      llm: new inference.LLM({
        model: process.env.VOICE_AGENT_LLM_MODEL || "openai/gpt-4.1-mini",
      }),
      tts: resolveTts(),
      allowInterruptions: true,
      // More stable turn-taking for human speech: wait for completed user turn
      // before generating, reducing split/partial responses.
      preemptiveGeneration: false,
      // Slightly shorter away timeout so stalled turns recover sooner.
      userAwayTimeout: 10,
      turnHandling: {
        // User requested slower commit: process after about 4s of silence.
        endpointing: {
          mode: "fixed",
          minDelay: 4000,
          maxDelay: 4000,
        },
        // Avoid false barge-ins when user says brief fillers.
        interruption: {
          enabled: true,
          minDuration: 900,
          minWords: 2,
        },
      },
    });

    if (AVATAR_ID) {
      console.warn(
        "LIVEAVATAR_AVATAR_ID is set, but LiveAvatar is not currently supported in LiveKit Agents Node; running without avatar.",
      );
    }

    const beyConfig = resolveBeyConfig();
    const enableBvc =
      (process.env.VOICE_AGENT_ENABLE_NOISE_CANCELLATION || "false") === "true";
    const interimFallbackEnabled =
      (process.env.VOICE_AGENT_ENABLE_INTERIM_FALLBACK || "true") === "true";
    const interimFallbackMaxAgeMs = Number(
      process.env.VOICE_AGENT_INTERIM_FALLBACK_MAX_AGE_MS || 20000,
    );
    let lastInterimTranscript = "";
    let lastInterimAtMs = 0;

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      const transcript = (ev?.transcript || "").trim();
      if (!transcript) return;
      if (ev?.isFinal) {
        console.info(`[STT final] ${transcript}`);
        lastInterimTranscript = "";
        lastInterimAtMs = 0;
        return;
      }
      lastInterimTranscript = transcript;
      lastInterimAtMs = Date.now();
    });

    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (!interimFallbackEnabled) return;
      if (ev?.newState !== "away") return;
      if (!lastInterimTranscript) return;
      const ageMs = Date.now() - lastInterimAtMs;
      if (ageMs > interimFallbackMaxAgeMs) return;

      const fallbackText = lastInterimTranscript;
      lastInterimTranscript = "";
      lastInterimAtMs = 0;
      console.warn(
        `[STT fallback] using interim transcript due to away timeout: "${fallbackText}"`,
      );
      session.generateReply({ userInput: fallbackText });
    });

    forwardAssistantChatToRoom(session, ctx.room);

    await session.start({
      agent: new Assistant(),
      room: ctx.room,
      inputOptions: {
        ...(enableBvc ? { noiseCancellation: BackgroundVoiceCancellation() } : {}),
      },
    });
    console.info("Agent voice session started");

    await ctx.connect();
    console.info(`Connected to room: ${ctx.room.name}`);

    if (beyConfig.apiKey) {
      console.info(
        `Beyond avatar enabled (avatarId=${beyConfig.avatarId || "default"})`,
      );
      const avatar = new bey.AvatarSession({
        apiKey: beyConfig.apiKey,
        avatarId: beyConfig.avatarId || undefined,
        avatarParticipantIdentity: beyConfig.participantIdentity,
        avatarParticipantName: beyConfig.participantName,
        connOptions: {
          maxRetry: 5,
          retryIntervalMs: 3000,
          timeoutMs: 30000,
        },
      });
      void (async () => {
        try {
          await avatar.start(session, ctx.room, {
            livekitUrl: process.env.LIVEKIT_URL,
            livekitApiKey: process.env.LIVEKIT_API_KEY,
            livekitApiSecret: process.env.LIVEKIT_API_SECRET,
          });
          console.info("Beyond avatar session started");
        } catch (error) {
          // Keep voice agent available if avatar provider is temporarily unreachable.
          console.error(
            "Beyond avatar start failed; continuing in voice-only mode.",
            error,
          );
        }
      })();
    } else {
      console.warn(
        "Beyond Presence avatar disabled: set BEY_API_KEY (or BEYOND_API_KEY) to enable avatar participant.",
      );
    }

    session.generateReply({
      instructions: INITIAL_GREETING,
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "ai-mentor-node",
  }),
);
