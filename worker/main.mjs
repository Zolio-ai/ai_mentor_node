import { ServerOptions, cli, defineAgent, inference, voice, llm } from "@livekit/agents";
import * as bey from "@livekit/agents-plugin-bey";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { ConversationMessage } from "../src/models/index.mjs";
import { Assistant } from "./assistant.mjs";
import { SarvamStt } from "./sarvam-stt-livekit.mjs";
import { SarvamTts } from "./sarvam-tts-livekit.mjs";

dotenv.config();

const agentName = process.env.LIVEKIT_AGENT_NAME || "ai-mentor-bey-agent";
const livekitLlmModel = process.env.LIVEKIT_LLM_MODEL || "openai/gpt-4o-mini";
const syncAiTranscription = process.env.LIVEKIT_SYNC_TRANSCRIPTION !== "false";
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:4000";
const internalApiKey = process.env.INTERNAL_API_KEY || process.env.JWT_SECRET || "";
console.log("[DEBUG] Initialized environment in worker:", { apiBaseUrl, internalApiKey });
const endpointingDelayMs = Math.max(300, Number(process.env.VOICE_AGENT_ENDPOINTING_DELAY_MS || 1200));
const userAwayTimeoutSec = Math.max(20, Number(process.env.VOICE_AGENT_USER_AWAY_TIMEOUT_SECONDS || 45));
// Cost-safe default: always close user input/session when user disconnects.
const closeOnDisconnect = true;
const autoTopicAdvanceMs = 2 * 60 * 1000;
const workerHost = process.env.WORKER_HOST || "0.0.0.0";
const workerPort = Math.max(0, Number(process.env.WORKER_PORT || 8082));
const mongoUri = process.env.MONGODB_URI || "";
const mongoDbName = process.env.MONGODB_DB_NAME || "ai_mentor_app";
let workerDbConnectPromise = null;
const beyStartStateByRoom = new Map();
const beyCooldownBaseMs = Math.max(2000, Number(process.env.BEY_START_COOLDOWN_BASE_MS || 5000));
const beyCooldownMaxMs = Math.max(
  beyCooldownBaseMs,
  Number(process.env.BEY_START_COOLDOWN_MAX_MS || 45000),
);
const forceDeepgram =
  String(process.env.USE_DEEPGRAM || "")
    .toLowerCase()
    .trim() === "true";

function normalizeProvider(raw, fallback) {
  const provider = String(raw || fallback)
    .toLowerCase()
    .trim();
  if (provider === "sarwam") return "sarvam";
  return provider;
}

function createDeepgramStt() {
  return new deepgram.STT({
    model: process.env.DEEPGRAM_STT_MODEL || "nova-2-general",
    language: process.env.DEEPGRAM_STT_LANGUAGE || "en",
  });
}

function createDeepgramTts() {
  return new deepgram.TTS({
    model: process.env.DEEPGRAM_TTS_MODEL || "aura-2-asteria-en",
  });
}

function resolveStt() {
  if (forceDeepgram) return createDeepgramStt();
  const provider = normalizeProvider(process.env.VOICE_AGENT_STT_PROVIDER, "auto");
  if (provider === "deepgram") return createDeepgramStt();
  if (provider === "sarvam") return new SarvamStt();
  if (provider !== "auto") {
    throw new Error(`Unsupported STT provider "${provider}". Use: auto, sarvam, or deepgram.`);
  }

  try {
    return new SarvamStt();
  } catch (error) {
    console.warn(`[STT] Sarvam unavailable, falling back to Deepgram: ${error?.message || error}`);
    return createDeepgramStt();
  }
}

function resolveTts() {
  if (forceDeepgram) return createDeepgramTts();
  const provider = normalizeProvider(process.env.VOICE_AGENT_TTS_PROVIDER, "auto");
  if (provider === "deepgram") return createDeepgramTts();
  if (provider === "sarvam") return new SarvamTts();
  if (provider !== "auto") {
    throw new Error(`Unsupported TTS provider "${provider}". Use: auto, sarvam, or deepgram.`);
  }

  try {
    return new SarvamTts();
  } catch (error) {
    console.warn(`[TTS] Sarvam unavailable, falling back to Deepgram: ${error?.message || error}`);
    return createDeepgramTts();
  }
}

import {
  rankSubjects,
  fetchCandidateProfileInternally,
  fetchStudyContextInternally,
  buildAdaptiveMentorInstructions,
  extractUserIdFromRoomName,
  markTrainingCompletionInternally,
  detectEndIntentInternally,
  completeTopicInternally,
  hasConversationHistory,
  fetchConversationHistoryInternally,
  storeConversationMessageInternally
} from "./workerService.mjs";


function forwardAssistantChatToRoom(session, room, aiSpeechIdRef, trainingStateRef, userId) {
  const { SpeechCreated } = voice.AgentSessionEventTypes;
  const forwardedItemIds = new Set();
  let completionEventSent = false;
  const safeFlagValue = (value) => {
    if (typeof value === "function") {
      try {
        return Boolean(value());
      } catch {
        return false;
      }
    }
    return value === true;
  };

  session.on(SpeechCreated, (event) => {
    const speechHandle = event?.speechHandle;
    if (!speechHandle) return;

    if (aiSpeechIdRef) {
      aiSpeechIdRef.current = speechHandle.id;
    }

    speechHandle.addDoneCallback(() => {
      const wasInterrupted =
        safeFlagValue(speechHandle?.interrupted) ||
        safeFlagValue(speechHandle?.isInterrupted) ||
        safeFlagValue(speechHandle?.playoutInterrupted);
      for (const item of speechHandle.chatItems || []) {
        if (!item || item.type !== "message" || item.role !== "assistant") continue;
        const text = typeof item.textContent === "string" ? item.textContent.trim() : "";
        if (!text && !wasInterrupted) continue;
        if (text && !forwardedItemIds.has(item.id)) {
          forwardedItemIds.add(item.id);
          const cleanedText = sanitizeAssistantText(text);
          if (!wasInterrupted) {
            void room.localParticipant
              ?.sendText?.(cleanedText, { topic: "lk.chat" })
              .catch((error) => console.error("sendText failed", error));
          }
          if (cleanedText !== text) {
            item.textContent = cleanedText;
          }
        }
        const isLastQuestion = false;
        publishJson(room, "mentor.ai.transcript", {
          type: "assistant_transcript",
          id: speechHandle.id,
          text: sanitizeAssistantText(text),
          isLastQuestion,
          partial: false,
          interrupted: wasInterrupted,
          timestamp: Date.now(),
        });
        if (text) {
          void storeConversationMessageInternally({
            userId,
            roomName: room?.name || "",
            role: "assistant",
            text,
            speechId: speechHandle.id,
            interrupted: wasInterrupted,
          });
        }
        if (!completionEventSent && !wasInterrupted && isLastQuestion) {
          completionEventSent = true;
          if (trainingStateRef) {
            trainingStateRef.completionReached = true;
          }
          void markTrainingCompletionInternally(room?.name, true);
          publishJson(room, "mentor.training.status", {
            type: "training_completion_reached",
            id: speechHandle.id,
            sectionTitle: "Continuous mentoring mode",
            timestamp: Date.now(),
          });
        }
      }
    });
  });
}

export default defineAgent({
  entry: async (ctx) => {
    ctx.logContextFields = { room: ctx.room.name };
    let lastInterimTranscript = "";
    let lastInterimAtMs = 0;
    let userTurnSeq = 0;
    const trainingStateRef = { completionReached: false };

    const chatCtx = new llm.ChatContext();

    const session = new voice.AgentSession({
      chatCtx,
      stt: resolveStt(),
      llm: new inference.LLM({
        model: livekitLlmModel,
      }),
      tts: resolveTts(),
      allowInterruptions: true,
      preemptiveGeneration: false,
      userAwayTimeout: userAwayTimeoutSec,
      turnHandling: {
        endpointing: {
          mode: "fixed",
          // Lower endpointing delay for faster turn closure.
          minDelay: endpointingDelayMs,
          maxDelay: endpointingDelayMs,
        },
        interruption: {
          enabled: true,
          // Avoid startup/session-noise interruptions immediately killing playout.
          minDuration: 1200,
          minWords: 2,
        },
      },
    });

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
      console.log("[DEBUG] UserInputTranscribed event received:", JSON.stringify(event));
      const transcript = (event?.transcript || "").trim();
      if (!transcript) return;

      publishJson(ctx.room, "mentor.user.transcript", {
        type: "user_transcript",
        id: `user-turn-${userTurnSeq}`,
        text: transcript,
        final: Boolean(event?.isFinal),
        timestamp: Date.now(),
      });

      if (userId) {
        void storeConversationMessageInternally({
          userId,
          roomName: ctx.room?.name || "",
          role: "user",
          text: transcript,
          speechId: `user-turn-${userTurnSeq}`,
          interrupted: false,
        });
      }
      if (trainingStateRef.completionReached) {
        void (async () => {
          const shouldEnd = await detectEndIntentInternally(transcript);
          if (!shouldEnd) return;
          publishJson(ctx.room, "mentor.training.status", {
            type: "training_end_requested",
            text: transcript,
            timestamp: Date.now(),
          });
        })();
      }
      userTurnSeq += 1;
      lastInterimTranscript = "";
      lastInterimAtMs = 0;
      return;
    });

    session.on(voice.AgentSessionEventTypes.UserStateChanged, (event) => {
      if (event?.newState !== "away") return;
      if (!lastInterimTranscript) return;
      const ageMs = Date.now() - lastInterimAtMs;
      if (ageMs > 15000) return;

      const fallbackText = lastInterimTranscript;
      lastInterimTranscript = "";
      lastInterimAtMs = 0;
      console.warn("[STT fallback] using last interim transcript", { fallbackText });
      session.generateReply({ userInput: fallbackText });
    });

    session.on(voice.AgentSessionEventTypes.Error, (event) => {
      const message = String(event?.error?.message || "");
      const isAbort =
        message.toLowerCase().includes("request was aborted") ||
        message.toLowerCase().includes("user_initiated");
      if (isAbort) {
        // Interruptions can cancel in-flight LLM calls; treat as expected.
        console.warn("[AGENT] Ignoring expected abort during interruption", { message });
        return;
      }
      console.error("[AGENT] Session error", {
        message,
        name: event?.error?.name,
      });
    });

    await ctx.connect();

    const userId = extractUserIdFromRoomName(ctx.room?.name || "");
    const candidateProfile = await fetchCandidateProfileInternally(userId);
    const studyContext = await fetchStudyContextInternally(userId);
    console.log(`[DEBUG] Worker fetch after connect - candidateProfile:`, JSON.stringify(candidateProfile));
    console.log(`[DEBUG] Worker fetch after connect - studyContext:`, JSON.stringify(studyContext));
    const adaptiveInstructions = buildAdaptiveMentorInstructions(candidateProfile, studyContext);

    chatCtx.addMessage({
      role: "system",
      text: adaptiveInstructions,
    });

    const historyMessages = await fetchConversationHistoryInternally(userId);
    for (const msg of historyMessages) {
      chatCtx.addMessage({
        role: msg.role === "assistant" ? "assistant" : "user",
        text: msg.text,
      });
    }

    const originalPush = chatCtx.messages.push.bind(chatCtx.messages);
    chatCtx.messages.push = function (...items) {
      const res = originalPush(...items);
      for (const value of items) {
        if (value && value.text && value.role && value.role !== "system") {
          console.log(`[DEBUG] messages.push intercepted:`, value.role, value.text);
          void storeConversationMessageInternally({
            userId,
            roomName: ctx.room?.name || "",
            role: value.role === "assistant" ? "assistant" : "user",
            text: value.text,
            speechId: value.id || "push-" + Date.now(),
            interrupted: false,
          });
        }
      }
      return res;
    };

    const originalAddMessage = chatCtx.addMessage.bind(chatCtx);
    chatCtx.addMessage = function (msg) {
      originalAddMessage(msg);
      if (msg && msg.text && msg.role && msg.role !== "system") {
        console.log(`[DEBUG] chatCtx.addMessage intercepted:`, msg.role, msg.text);
        void storeConversationMessageInternally({
          userId,
          roomName: ctx.room?.name || "",
          role: msg.role === "assistant" ? "assistant" : "user",
          text: msg.text,
          speechId: msg.id || "ctx-" + Date.now(),
          interrupted: false,
        });
      }
    };

    const aiSpeechIdRef = { current: null };
    forwardAssistantChatToRoom(session, ctx.room, aiSpeechIdRef, trainingStateRef, userId);

    await session.start({
      room: ctx.room,
      agent: new Assistant({
        getSpeechId: () => aiSpeechIdRef.current,
        publishPartial: (data) =>
          publishJson(ctx.room, "mentor.ai.transcript", {
            ...data,
            text: sanitizeAssistantText(data?.text),
            isLastQuestion: false,
          }),
        additionalInstructions: adaptiveInstructions,
      }),
      outputOptions: {
        // Keep AI transcript aligned with avatar playout unless explicitly disabled.
        syncTranscription: syncAiTranscription,
      },
      inputOptions: {
        participantIdentity: userId ? `user-${userId}` : undefined,
        closeOnDisconnect,
      },
    });

    const autoTopicTimer = setInterval(() => {
      void completeTopicInternally(userId);
    }, autoTopicAdvanceMs);
    const clearAutoTopicTimer = () => {
      clearInterval(autoTopicTimer);
    };
    ctx.room?.on?.("disconnected", clearAutoTopicTimer);

    const handleDataChannelChat = (payload, participant, kind, topic) => {
      try {
        const str = new TextDecoder().decode(payload);
        console.log(`[DEBUG] Received data channel payload. Topic: ${topic}, Str: ${str}`);
        let msgText = str;
        try {
          const parsed = JSON.parse(str);
          msgText = parsed.message || parsed.text || str;
        } catch (_) {}

        if (msgText && typeof msgText === "string" && msgText.trim()) {
          console.log(`[DEBUG] Storing typed text message from student via data channel:`, msgText);
          void storeConversationMessageInternally({
            userId,
            roomName: ctx.room?.name || "",
            role: "user",
            text: msgText,
            speechId: "chat-" + Date.now(),
            interrupted: false,
          });
          chatCtx.addMessage({
            role: "user",
            text: msgText,
          });
        }
      } catch (err) {
        console.error("[DEBUG] Error parsing dataReceived in worker:", err);
      }
    };

    const handleChatMessage = (message, participant) => {
      try {
        console.log(`[DEBUG] Received chat message event. Message:`, message);
        const text = typeof message === "object" ? (message?.message || message?.text) : message;
        if (text && typeof text === "string" && text.trim()) {
          console.log(`[DEBUG] Storing typed text message from student via chat message:`, text);
          void storeConversationMessageInternally({
            userId,
            roomName: ctx.room?.name || "",
            role: "user",
            text,
            speechId: "chat-" + Date.now(),
            interrupted: false,
          });
          chatCtx.addMessage({
            role: "user",
            text,
          });
        }
      } catch (err) {
        console.error("[DEBUG] Error parsing chatMessage in worker:", err);
      }
    };

    ctx.room?.on?.("dataReceived", handleDataChannelChat);
    ctx.room?.on?.("chatMessage", handleChatMessage);

    const avatar = new bey.AvatarSession({
      apiKey: process.env.BEY_API_KEY,
      avatarId: process.env.BEY_AVATAR_ID || undefined,
      avatarParticipantIdentity: process.env.BEY_AVATAR_IDENTITY || "bey-avatar-agent",
      avatarParticipantName: "Beyond Presence Avatar",
    });

    const beyStart = tryAcquireBeyStart(ctx.room?.name || "");
    if (!beyStart.allowed) {
      if (beyStart.reason === "in_flight") {
        console.warn("[BEY] Avatar start skipped; another start attempt is already running for this room.");
      } else {
        console.warn(
          `[BEY] Avatar start skipped due to cooldown (${Math.ceil((beyStart.waitMs || 0) / 1000)}s remaining).`,
        );
      }
    } else {
      let avatarStartError = null;
      try {
        await avatar.start(session, ctx.room, {
          livekitUrl: process.env.LIVEKIT_URL,
          livekitApiKey: process.env.LIVEKIT_API_KEY,
          livekitApiSecret: process.env.LIVEKIT_API_SECRET,
        });
      } catch (error) {
        avatarStartError = error;
        if (isBeyConcurrencyError(error)) {
          console.warn("[BEY] Avatar start skipped due to concurrency limit. Continuing voice-only session.");
        } else if (isBeyTimeoutError(error)) {
          console.warn("[BEY] Avatar start timed out. Continuing voice-only session.");
        } else {
          console.warn("[BEY] Avatar start failed. Continuing voice-only session:", error?.message || error);
        }
      } finally {
        releaseBeyStart(beyStart.key, avatarStartError);
      }
    }

    const isResumeSession = await hasConversationHistory(userId);

    try {
      // Let avatar/audio subscriptions settle before first greeting so resume voice
      // does not get dropped on fast reconnects.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const chapterTitle = String(studyContext?.currentChapter?.title || "").trim();
      const topicTitle = String(studyContext?.currentTopic?.title || "").trim();
      
      const studyFocusPrompt = chapterTitle || topicTitle
        ? `I see you are working on the topic "${topicTitle}" in chapter "${chapterTitle}". Are you ready to clear doubts in this topic or would you like me to share a specific example?`
        : "What topic from your current study plan would you like to clear doubts in first?";

      const welcomeGreeting = isResumeSession
        ? `Welcome back to your mentoring session! It is great to see you again. ${studyFocusPrompt}`
        : `Welcome warmly to your AI Mentor session. Remember that you can ask unlimited doubts about any topic. ${studyFocusPrompt}`;

      chatCtx.addMessage({
        role: "assistant",
        text: welcomeGreeting,
      });

      const aiSpeechId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "speech-" + Date.now();
      aiSpeechIdRef.current = aiSpeechId;

      publishJson(ctx.room, "mentor.ai.transcript", {
        type: "assistant_transcript",
        id: aiSpeechId,
        text: welcomeGreeting,
        partial: false,
        timestamp: Date.now(),
        isLastQuestion: false,
      });

      void storeConversationMessageInternally({
        userId,
        roomName: ctx.room?.name || "",
        role: "assistant",
        text: welcomeGreeting,
        speechId: aiSpeechId,
      });

      await session.say(welcomeGreeting);
    } catch (error) {
      console.warn("[AGENT] Skipped initial greeting because session is no longer running:", error?.message || error);
    }
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName,
    host: workerHost,
    port: workerPort,
    requestFunc: async (job) => {
      const roomName = job.room?.name || "mentor-room";
      const safeRoom = roomName.replace(/[^a-zA-Z0-9_-]/g, "-");
      await job.accept("AI Mentor Agent", `agent-${safeRoom}`);
    },
  }),
);
