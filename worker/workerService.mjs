import mongoose from "mongoose";
import dotenv from "dotenv";
import { ConversationMessage } from "../src/models/index.mjs";

dotenv.config();

const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:4004";
const internalApiKey = process.env.INTERNAL_API_KEY || process.env.JWT_SECRET || "";
const mongoUri = process.env.MONGODB_URI || "";
const mongoDbName = process.env.MONGODB_DB_NAME || "ai_mentor_app";

let workerDbConnectPromise = null;
const recentStoredMessages = new Set();

export async function ensureWorkerDbConnected() {
  if (mongoose.connection.readyState === 1) return;
  if (workerDbConnectPromise) return workerDbConnectPromise;
  if (!mongoUri) throw new Error("MONGODB_URI is missing.");
  workerDbConnectPromise = mongoose.connect(mongoUri, { dbName: mongoDbName }).finally(() => {
    workerDbConnectPromise = null;
  });
  return workerDbConnectPromise;
}

export function rankSubjects(marks) {
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

export async function fetchCandidateProfileInternally(userId) {
  if (!userId || !internalApiKey) {
    console.error(`[DEBUG] fetchCandidateProfileInternally missing userId or internalApiKey. userId: ${userId}`);
    return null;
  }
  try {
    const response = await fetch(`${apiBaseUrl}/internal/candidates/${userId}/profile`, {
      headers: {
        "x-internal-key": internalApiKey,
      },
    });
    if (!response.ok) {
      console.error(`[DEBUG] fetchCandidateProfileInternally non-ok status: ${response.status} ${response.statusText}`);
      return null;
    }
    const payload = await response.json().catch(() => ({}));
    return payload?.profile || null;
  } catch (err) {
    console.error(`[DEBUG] fetchCandidateProfileInternally error:`, err);
    return null;
  }
}

export async function fetchStudyContextInternally(userId) {
  if (!userId || !internalApiKey) {
    console.error(`[DEBUG] fetchStudyContextInternally missing userId or internalApiKey. userId: ${userId}`);
    return null;
  }
  try {
    const response = await fetch(`${apiBaseUrl}/internal/candidates/${userId}/study-context`, {
      headers: {
        "x-internal-key": internalApiKey,
      },
    });
    if (!response.ok) {
      console.error(`[DEBUG] fetchStudyContextInternally non-ok status: ${response.status} ${response.statusText}`);
      return null;
    }
    const payload = await response.json().catch(() => ({}));
    return payload?.studyContext || null;
  } catch (err) {
    console.error(`[DEBUG] fetchStudyContextInternally error:`, err);
    return null;
  }
}

export function buildAdaptiveMentorInstructions(profile, studyContext = null) {
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

export function extractUserIdFromRoomName(roomName) {
  const match = String(roomName || "").match(/^mentor-(.+)$/);
  return match?.[1] || "";
}

export async function markTrainingCompletionInternally(roomName, isLastQuestion) {
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

export async function detectEndIntentInternally(text) {
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

export async function completeTopicInternally(userId) {
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

export async function hasConversationHistory(userId) {
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

export async function fetchConversationHistoryInternally(userId) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return [];
  await ensureWorkerDbConnected();
  const messages = await ConversationMessage.find({ userId: safeUserId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  return messages.reverse();
}

export async function storeConversationMessageInternally({ userId, roomName, role, text, speechId = "", interrupted = false }) {
  const safeText = String(text || "").trim();
  if (!userId || !safeText) return;

  const dedupKey = `${userId}:${role}:${safeText}`;
  if (recentStoredMessages.has(dedupKey)) return;
  recentStoredMessages.add(dedupKey);
  setTimeout(() => recentStoredMessages.delete(dedupKey), 10000);

  console.log(`[DEBUG] Attempting to store message for userId: ${userId}, text: ${safeText}`);
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
    console.log(`[DEBUG] Successfully stored message to DB`);
  } catch (error) {
    console.error("Failed to store message", error);
  }
}
