import { ServerOptions, cli, defineAgent, inference, voice } from "@livekit/agents";
import * as bey from "@livekit/agents-plugin-bey";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { Assistant } from "./assistant.mjs";
import { SarvamStt } from "./sarvam-stt-livekit.mjs";
import { SarvamTts } from "./sarvam-tts-livekit.mjs";

dotenv.config();

const agentName = process.env.LIVEKIT_AGENT_NAME || "ai-mentor-bey-agent";
const livekitLlmModel = process.env.LIVEKIT_LLM_MODEL || "openai/gpt-4o-mini";
const syncAiTranscription = process.env.LIVEKIT_SYNC_TRANSCRIPTION !== "false";
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:4000";
const internalApiKey = process.env.INTERNAL_API_KEY || process.env.JWT_SECRET || "";

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

function buildAdaptiveMentorInstructions(profile) {
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

function forwardAssistantChatToRoom(session, room, aiSpeechIdRef, trainingStateRef) {
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
          if (!wasInterrupted) {
            void room.localParticipant
              ?.sendText?.(text, { topic: "lk.chat" })
              .catch((error) => console.error("sendText failed", error));
          }
        }
        const isLastQuestion = false;
        publishJson(room, "mentor.ai.transcript", {
          type: "assistant_transcript",
          id: speechHandle.id,
          text,
          isLastQuestion,
          partial: false,
          interrupted: wasInterrupted,
          timestamp: Date.now(),
        });
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
      userAwayTimeout: 12,
      turnHandling: {
        endpointing: {
          mode: "fixed",
          // End user turn only after ~4s of silence.
          minDelay: 4000,
          maxDelay: 4000,
        },
        interruption: {
          enabled: true,
          minDuration: 800,
          minWords: 1,
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
    const adaptiveInstructions = buildAdaptiveMentorInstructions(candidateProfile);

    const aiSpeechIdRef = { current: null };
    forwardAssistantChatToRoom(session, ctx.room, aiSpeechIdRef, trainingStateRef);

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
    });

    const avatar = new bey.AvatarSession({
      apiKey: process.env.BEY_API_KEY,
      avatarId: process.env.BEY_AVATAR_ID || undefined,
      avatarParticipantIdentity: process.env.BEY_AVATAR_IDENTITY || "bey-avatar-agent",
      avatarParticipantName: "Beyond Presence Avatar",
    });

    await avatar.start(session, ctx.room, {
      livekitUrl: process.env.LIVEKIT_URL,
      livekitApiKey: process.env.LIVEKIT_API_KEY,
      livekitApiSecret: process.env.LIVEKIT_API_SECRET,
    });

    session.generateReply({
      instructions:
        "Welcome them warmly to the AI Mentor session with a personalized opening that references their current academic level and two weakest subjects. Mention that they can ask unlimited doubts. Speak clearly and a bit slower than normal, with a calm tone. End with a doubt-focused check-in like 'Any other doubt you have?'.",
    });
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
