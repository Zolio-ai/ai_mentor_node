import { ServerOptions, cli, defineAgent, inference, voice } from "@livekit/agents";
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

function rankSubjects(marks) {
  const pairs = Object.entries(marks || {})
    .map(([subject, value]) => [subject, Number(value)])
    .filter(([, value]) => Number.isFinite(value));
  const sorted = [...pairs].sort((a, b) => b[1] - a[1]);
  return {
    strongest: sorted.slice(0, 2),
    weakest: [...sorted].sort((a, b) => a[1] - b[1]).slice(0, 2),
    all: sorted,
  };
}

async function fetchCandidateProfileInternally(userId) {
  if (!userId || !internalApiKey) return null;
  try {
    const response = await fetch(`${apiBaseUrl}/internal/candidates/${userId}/profile`, {
      headers: {
        "x-internal-key": internalApiKey,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    return payload?.profile || null;
  } catch {
    return null;
  }
}

async function fetchStudyContextInternally(userId) {
  if (!userId || !internalApiKey) return null;
  try {
    const response = await fetch(`${apiBaseUrl}/internal/candidates/${userId}/study-context`, {
      headers: {
        "x-internal-key": internalApiKey,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    return payload?.studyContext || null;
  } catch {
    return null;
  }
}

function buildAdaptiveMentorInstructions(profile, studyContext = null) {
  if (!profile) {
    return "Candidate profile is unavailable. Ask 3 quick diagnostic questions (target role/exam, strongest topic, weakest topic), then adapt mentoring plan from their answers.";
  }

  const marks = {
    physics: profile?.marks?.physics,
    chemistry: profile?.marks?.chemistry,
    maths: profile?.marks?.maths,
    biology: profile?.marks?.biology,
  };
  const ranked = rankSubjects(marks);
  const strongest = ranked.strongest.map(([subject, score]) => `${subject} (${score})`).join(", ") || "N/A";
  const weakest = ranked.weakest.map(([subject, score]) => `${subject} (${score})`).join(", ") || "N/A";
  const avg =
    ranked.all.length > 0
      ? Number((ranked.all.reduce((sum, [, score]) => sum + score, 0) / ranked.all.length).toFixed(1))
      : null;

  let levelBand = "beginner";
  if (avg != null && avg >= 85) levelBand = "advanced";
  else if (avg != null && avg >= 70) levelBand = "intermediate";

  const studyContextLines = [];
  if (studyContext?.currentChapter?.title || studyContext?.currentTopic?.title) {
    const chapterTitle = String(studyContext?.currentChapter?.title || "Current chapter").trim();
    const topicTitle = String(studyContext?.currentTopic?.title || "Current topic").trim();
    const subject = String(studyContext?.subject || "Current subject").trim();
    studyContextLines.push(
      `Current study-plan subject: ${subject}`,
      `Current study-plan chapter: ${chapterTitle}`,
      `Current study-plan topic: ${topicTitle}`,
      "Topic-priority mentoring rules:",
      "- Prioritize doubts from the current study-plan topic before switching to other topics.",
      "- If learner asks unrelated question, answer briefly and then bring them back to current topic doubts.",
      "- At the end of each response, ask one short doubt-check specifically about current chapter/topic.",
      '- Use natural prompts like: "Any doubts in this topic?" or "Any confusion in this chapter point?".',
    );
  }

  return [
    `Candidate name: ${profile.firstName || profile.name || "Candidate"}`,
    `Class: ${profile.class ?? "N/A"}, Stream: ${profile.stream || "N/A"}, Entrance Exam: ${profile.entranceExam || "N/A"}`,
    `Subject marks: Physics=${marks.physics ?? "N/A"}, Chemistry=${marks.chemistry ?? "N/A"}, Maths=${marks.maths ?? "N/A"}, Biology=${marks.biology ?? "N/A"}, CGPA10=${profile.cgpa10 ?? "N/A"}`,
    `Strongest subjects: ${strongest}`,
    `Weakest subjects: ${weakest}`,
    `Estimated level: ${levelBand}`,
    "Mentoring behavior rules:",
    "- Personalize examples using strong subjects first, then bridge into weak subjects.",
    "- Spend more time on weakest two subjects with simpler step-by-step explanations.",
    "- Ask short check questions to validate understanding before moving on.",
    "- Give a practical micro-study plan (today, this week) tailored to weakest subjects.",
    "- Keep guidance concise, actionable, and confidence-building.",
    ...studyContextLines,
  ].join("\n");
}

function publishJson(room, topic, data) {
  try {
    const payload = new TextEncoder().encode(JSON.stringify(data));
    void room.localParticipant
      ?.publishData?.(payload, { reliable: true, topic })
      .catch((error) => console.error("publishData failed", topic, error.message));
  } catch (error) {
    console.error("publishJson failed", error);
  }
}

function sanitizeAssistantText(rawText) {
  const text = String(rawText || "");
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^[\s>*#-]+/gm, "")
    .replace(/`+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isBeyConcurrencyError(error) {
  const statusCode = Number(error?.statusCode || 0);
  const body = String(error?.body?.error || error?.body || "");
  return statusCode === 429 || body.toLowerCase().includes("concurrency limit");
}

function isBeyTimeoutError(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return name.includes("timeout") || message.includes("timeout");
}

function getBeyRoomStartState(roomName) {
  const key = String(roomName || "").trim() || "__default__";
  let state = beyStartStateByRoom.get(key);
  if (!state) {
    state = { inFlight: false, cooldownUntil: 0, failureCount: 0 };
    beyStartStateByRoom.set(key, state);
  }
  return { key, state };
}

function tryAcquireBeyStart(roomName) {
  const now = Date.now();
  const { key, state } = getBeyRoomStartState(roomName);
  if (state.inFlight) {
    return { allowed: false, reason: "in_flight", waitMs: 0 };
  }
  if (state.cooldownUntil > now) {
    return {
      allowed: false,
      reason: "cooldown",
      waitMs: Math.max(0, state.cooldownUntil - now),
    };
  }
  state.inFlight = true;
  beyStartStateByRoom.set(key, state);
  return { allowed: true, key };
}

function releaseBeyStart(roomKey, error = null) {
  const now = Date.now();
  const state = beyStartStateByRoom.get(roomKey);
  if (!state) return;
  state.inFlight = false;
  if (!error) {
    state.failureCount = 0;
    state.cooldownUntil = 0;
    beyStartStateByRoom.set(roomKey, state);
    return;
  }

  state.failureCount += 1;
  const isRetryableBeyFailure = isBeyConcurrencyError(error) || isBeyTimeoutError(error);
  const step = isRetryableBeyFailure ? 1.8 : 1.4;
  const cooldownMs = Math.min(
    beyCooldownMaxMs,
    Math.round(beyCooldownBaseMs * Math.pow(step, Math.max(0, state.failureCount - 1))),
  );
  state.cooldownUntil = now + cooldownMs;
  beyStartStateByRoom.set(roomKey, state);
}

function extractUserIdFromRoomName(roomName) {
  const match = String(roomName || "").match(/^mentor-(.+)$/);
  return match?.[1] || "";
}

async function markTrainingCompletionInternally(roomName, isLastQuestion) {
  const userId = extractUserIdFromRoomName(roomName);
  if (!userId || !isLastQuestion || !internalApiKey) return;
  try {
    const response = await fetch(`${apiBaseUrl}/internal/training/completion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalApiKey,
      },
      body: JSON.stringify({ userId, isLastQuestion }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("[completion] internal mark failed", response.status, text);
    }
  } catch (error) {
    console.warn("[completion] internal mark error", error?.message || error);
  }
}

async function detectEndIntentInternally(text) {
  const transcript = String(text || "").trim();
  if (!transcript || !internalApiKey) return false;
  try {
    const response = await fetch(`${apiBaseUrl}/internal/training/end-intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalApiKey,
      },
      body: JSON.stringify({ text: transcript }),
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    return Boolean(payload?.endIntent);
  } catch {
    return false;
  }
}

async function completeTopicInternally(userId) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId || !internalApiKey) return;
  try {
    const response = await fetch(`${apiBaseUrl}/internal/training/complete-topic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalApiKey,
      },
      body: JSON.stringify({ userId: safeUserId }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("[study-progress] auto complete-topic failed", response.status, text);
    }
  } catch (error) {
    console.warn("[study-progress] auto complete-topic error", error?.message || error);
  }
}

async function ensureWorkerDbConnected() {
  if (mongoose.connection.readyState === 1) return;
  if (workerDbConnectPromise) return workerDbConnectPromise;
  if (!mongoUri) throw new Error("MONGODB_URI is missing.");
  workerDbConnectPromise = mongoose.connect(mongoUri, { dbName: mongoDbName }).finally(() => {
    workerDbConnectPromise = null;
  });
  return workerDbConnectPromise;
}

async function hasConversationHistory(userId) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return false;
  try {
    await ensureWorkerDbConnected();
    const count = await ConversationMessage.countDocuments({ userId: safeUserId });
    return count > 0;
  } catch {
    return false;
  }
}

async function storeConversationMessageInternally({ userId, roomName, role, text, speechId = "", interrupted = false }) {
  const safeText = String(text || "").trim();
  if (!userId || !safeText) return;
  try {
    await ensureWorkerDbConnected();
    await ConversationMessage.create({
      userId,
      roomName: String(roomName || "").trim(),
      role,
      text: safeText,
      speechId: String(speechId || "").trim(),
      interrupted: Boolean(interrupted),
      source: "voice-agent",
    });
  } catch (error) {
    console.warn("[conversation] persist error", error?.message || error);
  }
}

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

    const session = new voice.AgentSession({
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
      const transcript = (event?.transcript || "").trim();
      if (!transcript) return;

      publishJson(ctx.room, "mentor.user.transcript", {
        type: "user_transcript",
        id: `user-turn-${userTurnSeq}`,
        text: transcript,
        final: Boolean(event?.isFinal),
        timestamp: Date.now(),
      });

      if (event?.isFinal) {
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
      }
      lastInterimTranscript = transcript;
      lastInterimAtMs = Date.now();
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
    const adaptiveInstructions = buildAdaptiveMentorInstructions(candidateProfile, studyContext);

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
      const studyFocusPrompt =
        chapterTitle || topicTitle
          ? `Their current study plan focus is chapter "${chapterTitle || "current chapter"}" and topic "${topicTitle || "current topic"}". Ask if they have any doubts specifically in this chapter/topic and start from there.`
          : "Ask what topic from their current study plan they want to clear doubts in first.";
      session.generateReply({
        instructions: isResumeSession
          ? `Welcome them back warmly and clearly say you are resuming from where they left off in the previous session. Briefly summarize likely focus areas from prior mentoring context (weakest two subjects). ${studyFocusPrompt} Keep it concise, calm, and supportive.`
          : `Welcome them warmly to the AI Mentor session with a personalized opening that references their current academic level and two weakest subjects. Mention that they can ask unlimited doubts. ${studyFocusPrompt} Speak clearly and a bit slower than normal, with a calm tone.`,
      });
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
