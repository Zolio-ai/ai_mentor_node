import {
  ServerOptions,
  cli,
  defineAgent,
  inference,
  llm,
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
import { ASSISTANT_INSTRUCTIONS } from "./prompts.js";
import { forwardAssistantChatToRoom } from "./forward-assistant-chat.js";
import { SarvamStt } from "./sarvam-stt-livekit.js";
import { SarvamTts } from "./sarvam-tts-livekit.js";

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
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
    
    // Shared state to track signals for the next chat message
    const agentStateSignals = { pendingAssessmentTopics: null };

    const fctx = {
      trigger_assessment: llm.tool({
        description: "Trigger an assessment test for the user. If the user wants a general test, leave topicNames empty. CRITICAL: ONLY use topics from CURRENT WEEK TOPICS in the context. NEVER test topics from other weeks.",
        parameters: {
          type: "object",
          properties: {
            topicNames: {
              type: "array",
              items: { type: "string" },
              description: "ONLY topics from CURRENT WEEK TOPICS list. Leave empty for a comprehensive review of the current week."
            }
          },
          required: []
        },
        execute: async (args) => {
          const topicNames = args.topicNames || [];
          agentStateSignals.pendingAssessmentTopics = topicNames;
          console.log('[DEBUG] Sending VOICE_TRIGGER_ASSESSMENT signal', { topics: topicNames });
          
          // Send data message to frontend via LiveKit (Primary Path)
          const encoder = new TextEncoder();
          const data = encoder.encode(JSON.stringify({
            action: "VOICE_TRIGGER_ASSESSMENT",
            topics: topicNames
          }));
          
          console.info(`[assessment] Publishing VOICE_TRIGGER_ASSESSMENT for topics: ${topicNames.join(', ') || 'comprehensive'}`);
          await ctx.room.localParticipant.publishData(data, { reliable: true });

          if (topicNames.length > 0) {
            return `I've sent the quiz for ${topicNames.join(', ')} to your screen. Please complete the MCQ test to continue.`;
          } else {
            return `I've started a comprehensive review test for this week on your screen. Please complete it so we can track your progress.`;
          }
        },
      }),


      mark_topic_completed: llm.tool({
        description: "Mark a study topic as completed for the student",
        parameters: {
          type: "object",
          properties: {
            topicName: {
              type: "string",
              description: "The name of the topic that was completed",
            },
          },
          required: ["topicName"],
        },
        execute: async (args) => {
          const participants = Array.from(ctx.room.remoteParticipants.values());
          // Find first participant that isn't another bot/agent if possible
          const student = participants.find(p => p.identity && !p.identity.includes('agent'));
          const studentId = student?.identity || participants[0]?.identity;

          if (!studentId) return "I couldn't identify the student to mark progress.";

          try {
            // 1. Mark in StudyPlan progress
            const response = await fetch(`${BACKEND_URL}/api/data/internal/update-topic`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                studentId,
                topicName: args.topicName,
                secret: process.env.INTERNAL_KEY
              })
            });
            
            if (!response.ok) throw new Error(`Server responded with ${response.status}`);
            
            // 2. Resolve any pending reminders for this topic
            await fetch(`${BACKEND_URL}/api/data/internal/resolve-reminder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    topicName: args.topicName,
                    type: 'TOPIC_PENDING',
                    secret: process.env.INTERNAL_KEY
                })
            });

            const result = await response.json();
            if (result.success) {
              return `Successfully marked "${args.topicName}" as completed.`;
            } else {
              return `Failed to mark topic: ${result.message}`;
            }
          } catch (error) {
            return `Error updating progress: ${error.message}`;
          }
        },
      }),

      create_reminder: llm.tool({
        description: "Create a reminder for a topic the user has not completed yet",
        parameters: {
          type: "object",
          properties: {
            topicName: { type: "string" }
          },
          required: ["topicName"]
        },
        execute: async (args) => {
            const participants = Array.from(ctx.room.remoteParticipants.values());
            const student = participants.find(p => p.identity && !p.identity.includes('agent'));
            const studentId = student?.identity || participants[0]?.identity;

            if (!studentId) return "Student not found.";
            
            const res = await fetch(`${BACKEND_URL}/api/data/internal/reminder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    topicName: args.topicName,
                    type: 'TOPIC_PENDING',
                    secret: process.env.INTERNAL_KEY
                })
            });
            if (!res.ok) return "I'm having trouble saving that reminder right now. Please try again in a moment.";
            return `Okay, I've noted that ${args.topicName} is still pending. I'll remind you next time!`;
        }
      }),

      schedule_test: llm.tool({
        description: "Schedule a test for a specific topic on a future date",
        parameters: {
          type: "object",
          properties: {
            topicName: { type: "string" },
            date: { type: "string", description: "ISO date string (YYYY-MM-DD format)" }
          },
          required: ["topicName", "date"]
        },
        execute: async (args) => {
            const participants = Array.from(ctx.room.remoteParticipants.values());
            const student = participants.find(p => p.identity && !p.identity.includes('agent'));
            const studentId = student?.identity || participants[0]?.identity;

            if (!studentId) return "Student not found.";

            // Parse the date - ensure it's a valid ISO date string
            let parsedDate = args.date;
            const dateObj = new Date(args.date);
            if (isNaN(dateObj.getTime())) {
                return "I couldn't understand that date. Please provide a valid date in YYYY-MM-DD format.";
            }
            // Use ISO string format for consistent storage
            parsedDate = dateObj.toISOString();

            const res = await fetch(`${BACKEND_URL}/api/data/internal/reminder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    topicName: args.topicName,
                    type: 'TEST_SCHEDULED',
                    scheduledDate: parsedDate,
                    secret: process.env.INTERNAL_KEY
                })
            });
            if (!res.ok) return "I couldn't schedule the test. Please check the date and try again.";
            const dateDisplay = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            return `Perfect. I've scheduled a test for ${args.topicName} on ${dateDisplay}.`;
        }
      }),

      resolve_reminder: llm.tool({
        description: "Mark a reminder or scheduled test as resolved",
        parameters: {
          type: "object",
          properties: {
            topicName: { type: "string" },
            type: { type: "string", enum: ["TOPIC_PENDING", "TEST_SCHEDULED"] }
          },
          required: ["topicName", "type"]
        },
        execute: async (args) => {
            const participants = Array.from(ctx.room.remoteParticipants.values());
            const student = participants.find(p => p.identity && !p.identity.includes('agent'));
            const studentId = student?.identity || participants[0]?.identity;

            if (!studentId) return "Student not found.";
            
            await fetch(`${BACKEND_URL}/api/data/internal/resolve-reminder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    topicName: args.topicName,
                    type: args.type,
                    secret: process.env.INTERNAL_KEY
                })
            });
            return `Confirmed. I've updated your status for ${args.topicName}.`;
        }
      }),
    };

    // Determine student progress and reminders before starting session
    const participants = Array.from(ctx.room.remoteParticipants.values());
    const student = participants.find(p => p.identity && !p.identity.includes('agent'));
    const studentId = student?.identity || participants[0]?.identity;
    let progressContext = "";
    let reminderContext = "";

    if (studentId) {
       try {
          // Fetch Weekly Progress
          const progressRes = await fetch(`${BACKEND_URL}/api/data/internal/current-week-progress`, {
              headers: { 'x-internal-secret': process.env.INTERNAL_KEY, 'x-student-id': studentId }
          });
          const pResult = await progressRes.json();
          if (pResult.success && pResult.data) {
              const { weekNumber, weekTitle, allTopics, topicStatus, isWeekCompleted, isLastDayOfWeek } = pResult.data;

              // DEBUG: Log what we received
              console.log(`[DEBUG] Student ${studentId} - Week ${weekNumber} (${weekTitle}) - Topics:`, allTopics);

              const statusSummary = topicStatus.map(ts => `"${ts.topic}": ${ts.status}`).join('; ');
              const allTopicsList = allTopics.map(t => `"${t}"`).join(', ');
              progressContext = `WEEK ${weekNumber} (${weekTitle}). GLOBAL STATUS: ${isWeekCompleted ? "COMPLETED" : "IN PROGRESS"}. IS_LAST_DAY_OF_WEEK: ${isLastDayOfWeek ? "true" : "false"}. CURRENT WEEK TOPICS: [${allTopicsList}]. TOPIC BREAKDOWN: [${statusSummary}]`;
          } else {
              console.log(`[DEBUG] No progress data for student ${studentId}:`, pResult);
          }

          // Fetch Active Reminders / Schedules
          const reminderRes = await fetch(`${BACKEND_URL}/api/data/internal/reminders`, {
              headers: { 'x-internal-secret': process.env.INTERNAL_KEY, 'x-student-id': studentId }
          });
          const rResult = await reminderRes.json();
          if (rResult.success && rResult.data?.length) {
              const pending = rResult.data.filter(r => r.type === 'TOPIC_PENDING').map(r => r.topicName);
              const scheduled = rResult.data.filter(r => r.type === 'TEST_SCHEDULED');
              
              if (pending.length) reminderContext += `PENDING REMINDERS: ${pending.join(', ')}. `;
              if (scheduled.length) {
                  reminderContext += `SCHEDULED TESTS FOR TODAY: ${scheduled.map(s => s.topicName).join(', ')}. `;
              }
          }
       } catch (e) {
          console.error("Failed to fetch context", e);
       }
    }

    const session = new voice.AgentSession({
      stt: resolveStt(),
      llm: new inference.LLM({
        model: process.env.VOICE_AGENT_LLM_MODEL || "gpt-4o-mini",
        fctx: fctx
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

    forwardAssistantChatToRoom(session, ctx.room, agentStateSignals);

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

    // Bridge chat messages to the voice agent
    ctx.room.on('dataReceived', (payload, participant) => {
      if (participant?.identity === ctx.room.localParticipant.identity) return;

      const decoder = new TextDecoder();
      const rawData = decoder.decode(payload);

      try {
        const data = JSON.parse(rawData);
        // Handle different possible chat message formats (LiveKit versions vary)
        const chatText = data.message || data.text;
        
        if (chatText && typeof chatText === 'string') {
          console.info(`[chat] Received from ${participant?.identity}: "${chatText}"`);
          session.generateReply({ userInput: chatText });
        }
      } catch (e) {
        // Log raw data if it's not JSON to help debug unexpected message formats
        const snippet = rawData.length > 50 ? rawData.substring(0, 50) + "..." : rawData;
        console.debug(`[dataReceived] Non-JSON payload received: ${snippet}`);
      }
    });

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

    const todayStr = new Date().toISOString().split('T')[0];
    session.generateReply({
      instructions: `TODAY's DATE: ${todayStr}. ` +
        (progressContext ? `STATUS: ${progressContext}` : "") +
        (reminderContext ? `\n\nPENDING: ${reminderContext}` : ""),
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "ai-mentor-node",
  }),
);
