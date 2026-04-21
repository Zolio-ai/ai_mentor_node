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
const closeOnDisconnect = process.env.VOICE_AGENT_CLOSE_ON_DISCONNECT === "true";
const mongoUri = process.env.MONGODB_URI || "";
const mongoDbName = process.env.MONGODB_DB_NAME || "ai_mentor_app";
let workerDbConnectPromise = null;

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
  if (!userId || !internalApiKey) return { profile: null, studyContext: null };
  try {
    const profRes = await fetch(`${apiBaseUrl}/internal/candidates/${userId}/profile`, {
      headers: { "x-internal-key": internalApiKey },
    });
    const profilePayload = await profRes.json().catch(() => ({}));
    
    const studyRes = await fetch(`${apiBaseUrl}/internal/candidates/${userId}/study-context`, {
      headers: { "x-internal-key": internalApiKey },
    });
    const studyPayload = await studyRes.json().catch(() => ({}));

    return {
      profile: profilePayload?.profile || null,
      studyContext: studyPayload?.studyContext || null,
    };
  } catch (error) {
    console.error("[worker] fetch candidate data error", error);
    return { profile: null, studyContext: null };
  }
}

function buildAdaptiveMentorInstructions(profile, studyContext) {
  let baseInstructions = "";
  if (!profile) {
    baseInstructions = "Candidate profile is unavailable. Ask 3 quick diagnostic questions (target role/exam, strongest topic, weakest topic), then adapt mentoring plan from their answers.";
  } else {
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

    baseInstructions = [
      `Candidate name: ${profile.firstName || profile.name || "Candidate"}`,
      `Class: ${profile.class ?? "N/A"}, Stream: ${profile.stream || "N/A"}, Entrance Exam: ${profile.entranceExam || "N/A"}`,
      `Subject marks: Physics=${marks.physics ?? "N/A"}, Chemistry=${marks.chemistry ?? "N/A"}, Maths=${marks.maths ?? "N/A"}, Biology=${marks.biology ?? "N/A"}, CGPA10=${profile.cgpa10 ?? "N/A"}`,
      `Strongest subjects: ${strongest}`,
      `Weakest subjects: ${weakest}`,
      `Estimated level: ${levelBand}`,
    ].join("\n");
  }

  const studyInstructions = studyContext
    ? [
        "",
        "--- STUDY MATERIAL CONTEXT ---",
        `Current Subject: ${studyContext.subject}`,
        `Current Chapter: ${studyContext.currentChapter?.number}. ${studyContext.currentChapter?.title}`,
        `Current Topic: ${studyContext.currentTopic?.title}`,
        `Topic Content: ${studyContext.currentTopic?.content}`,
        `Overall Progress: ${studyContext.progressPercent}% (${studyContext.totalChapters} chapters total)`,
        "",
        "Mentoring Goal:",
        `- Guide the candidate through "${studyContext.currentTopic?.title}".`,
        "- Explain the content clearly, using LaTeX for formulas.",
        "- Once you feel they have understood this topic, conclude it clearly (e.g. 'Great, let's move to the next topic') and the system will advance the progress.",
        "------------------------------",
      ].join("\n")
    : "";

  return [
    baseInstructions,
    studyInstructions,
    "Mentoring behavior rules:",
    "- Personalize examples using strong subjects first, then bridge into weak subjects.",
    "- Spend more time on weakest two subjects with simpler step-by-step explanations.",
    "- Ask short check questions to validate understanding before moving on.",
    "- Give a practical micro-study plan (today, this week) tailored to weakest subjects.",
    "- Keep guidance concise, actionable, and confidence-building.",
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

function isBeyConcurrencyError(error) {
  const statusCode = Number(error?.statusCode || 0);
  const body = String(error?.body?.error || error?.body || "");
  return statusCode === 429 || body.toLowerCase().includes("concurrency limit");
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

async function detectTopicCompletionInternally(text) {
  const transcript = String(text || "").trim();
  if (!transcript || !internalApiKey) return false;
  // Simple heuristic for now, or could use another LLM call
  const conclusionPhrases = [
    "move to the next topic",
    "completed this topic",
    "finished this topic",
    "let's move on",
    "heading to the next chapter",
  ];
  const matched = conclusionPhrases.some((p) => transcript.toLowerCase().includes(p));
  return matched;
}

async function markTopicCompletedInternally(userId) {
  if (!userId || !internalApiKey) return;
  try {
    await fetch(`${apiBaseUrl}/internal/training/complete-topic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalApiKey,
      },
      body: JSON.stringify({ userId }),
    });
  } catch (error) {
    console.warn("[worker] failed to mark topic completed", error);
  }
}

async function detectAssessmentStartIntentInternally(text) {
  const transcript = String(text || "").trim();
  if (!transcript || !internalApiKey) return false;
  try {
    const response = await fetch(`${apiBaseUrl}/internal/assessment/start-intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalApiKey,
      },
      body: JSON.stringify({ text: transcript }),
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    return Boolean(payload?.startAssessment);
  } catch {
    return false;
  }
}

async function buildAssessmentQuestionsInternally(userId) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId || !internalApiKey) return null;
  try {
    const response = await fetch(`${apiBaseUrl}/internal/assessment/questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalApiKey,
      },
      body: JSON.stringify({ userId: safeUserId }),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const questions = Array.isArray(payload?.questions) ? payload.questions : [];
    return {
      title: String(payload?.title || "Quick Assessment"),
      questions,
    };
  } catch {
    return null;
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

function forwardAssistantChatToRoom(session, room, aiSpeechIdRef, trainingStateRef, userId, studyContext) {
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

    speechHandle.addDoneCallback(async () => {
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
          if (!wasInterrupted) {
            void room.localParticipant
              ?.sendText?.(text, { topic: "lk.chat" })
              .catch((error) => console.error("sendText failed", error));
          }
        }
        
        const isTopicConclusion = !wasInterrupted && (await detectTopicCompletionInternally(text));
        if (isTopicConclusion) {
          await markTopicCompletedInternally(userId);
        }

        const isLastQuestion = studyContext?.isCompleted || false;
        publishJson(room, "mentor.ai.transcript", {
          type: "assistant_transcript",
          id: speechHandle.id,
          text,
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
            sectionTitle: "Study plan completed",
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
        void (async () => {
          const shouldStartAssessment = await detectAssessmentStartIntentInternally(transcript);
          if (!shouldStartAssessment) return;
          const now = Date.now();
          const generated = await buildAssessmentQuestionsInternally(userId);
          const generatedQuestions = Array.isArray(generated?.questions) ? generated.questions : [];
          const fallbackQuestions = [
            {
              id: "q1",
              question: "Which law explains the relation F = m * a?",
              options: ["Newton's First Law", "Newton's Second Law", "Newton's Third Law", "Law of Gravitation"],
              correctAnswer: "Newton's Second Law",
            },
            {
              id: "q2",
              question: "What is the SI unit of force?",
              options: ["Joule", "Newton", "Pascal", "Watt"],
              correctAnswer: "Newton",
            },
            {
              id: "q3",
              question: "Which quantity has both magnitude and direction?",
              options: ["Speed", "Distance", "Scalar", "Velocity"],
              correctAnswer: "Velocity",
            },
          ];
          publishJson(ctx.room, "mentor.assessment", {
            type: "assessment_start",
            title: generated?.title || "Quick Assessment",
            questions: generatedQuestions.length > 0 ? generatedQuestions : fallbackQuestions,
            triggeredBy: transcript,
            timestamp: now,
          });
        })();
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
    const { profile, studyContext } = await fetchCandidateProfileInternally(userId);
    const adaptiveInstructions = buildAdaptiveMentorInstructions(profile, studyContext);

    const aiSpeechIdRef = { current: null };
    forwardAssistantChatToRoom(session, ctx.room, aiSpeechIdRef, trainingStateRef, userId, studyContext);

    await session.start({
      room: ctx.room,
      agent: new Assistant({
        getSpeechId: () => aiSpeechIdRef.current,
        publishPartial: (data) =>
          publishJson(ctx.room, "mentor.ai.transcript", {
            ...data,
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

    const avatar = new bey.AvatarSession({
      apiKey: process.env.BEY_API_KEY,
      avatarId: process.env.BEY_AVATAR_ID || undefined,
      avatarParticipantIdentity: process.env.BEY_AVATAR_IDENTITY || "bey-avatar-agent",
      avatarParticipantName: "Beyond Presence Avatar",
    });

    try {
      await avatar.start(session, ctx.room, {
        livekitUrl: process.env.LIVEKIT_URL,
        livekitApiKey: process.env.LIVEKIT_API_KEY,
        livekitApiSecret: process.env.LIVEKIT_API_SECRET,
      });
    } catch (error) {
      if (isBeyConcurrencyError(error)) {
        console.warn("[BEY] Avatar start skipped due to concurrency limit. Continuing voice-only session.");
      } else {
        console.warn("[BEY] Avatar start failed. Continuing voice-only session:", error?.message || error);
      }
    }

    const isResumeSession = await hasConversationHistory(userId);

    try {
      session.generateReply({
        instructions: isResumeSession
          ? "Welcome them back warmly and clearly say you are resuming from where they left off in the previous session. Briefly summarize likely focus areas from prior mentoring context (weakest two subjects), then ask what they want to continue with first. Keep it concise, calm, and supportive."
          : "Welcome them warmly to the AI Mentor session with a personalized opening that references their current academic level and two weakest subjects. Mention that they can ask unlimited doubts. Speak clearly and a bit slower than normal, with a calm tone. End with a doubt-focused check-in like 'Any other doubt you have?'.",
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
    requestFunc: async (job) => {
      const roomName = job.room?.name || "mentor-room";
      const safeRoom = roomName.replace(/[^a-zA-Z0-9_-]/g, "-");
      await job.accept("AI Mentor Agent", `agent-${safeRoom}`);
    },
  }),
);
