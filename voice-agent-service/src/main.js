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

dotenv.config({ path: ".env.local" });
dotenv.config();
startHealthServer();

export default defineAgent({
  entry: async (ctx) => {
    ctx.logContextFields = {
      room: ctx.room.name,
    };

    const session = new voice.AgentSession({
      stt: new inference.STT({
        model: "deepgram/nova-3",
        language: "multi",
      }),
      llm: new inference.LLM({
        model: "openai/gpt-4.1-mini",
      }),
      tts: new inference.TTS({
        model: "deepgram/aura-2",
        voice: "orpheus",
        language: "en",
      }),
      allowInterruptions: true,
      voiceOptions: {
        preemptiveGeneration: true,
      },
    });

    if (AVATAR_ID) {
      console.warn(
        "LIVEAVATAR_AVATAR_ID is set, but LiveAvatar is not currently supported in LiveKit Agents Node; running without avatar.",
      );
    }

    const beyConfig = resolveBeyConfig();

    await session.start({
      agent: new Assistant(),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
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
