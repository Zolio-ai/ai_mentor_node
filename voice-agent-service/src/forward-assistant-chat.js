/**
 * Pushes completed assistant turns to LiveKit `lk.chat` so web clients using
 * `useChat` / `useSessionMessages` always receive the latest finalized agent text.
 *
 * We intentionally wait for speech handle completion.
 * In interruption-heavy sessions, valid assistant turns are often flagged as
 * interrupted by the SDK, so we do not drop interrupted items here.
 */
import { voice } from "@livekit/agents";

/**
 * @param {import("@livekit/agents").voice.AgentSession} session
 * @param {{ localParticipant?: { sendText?: (text: string, options?: { topic?: string, attributes?: Record<string, string> }) => Promise<unknown> } }} room
 * @param {Object} signals - Shared state for attaching signals to next message
 */
export function forwardAssistantChatToRoom(session, room, signals = {}) {
  const { SpeechCreated } = voice.AgentSessionEventTypes;
  const forwardedItemIds = new Set();

  const sendAssistantText = async (text, speechCreatedAt, speechId) => {
    const lp = room.localParticipant;
    if (!lp?.sendText) {
      return;
    }

    try {
      const attributes = {
        assistant_speech_created_at: String(speechCreatedAt ?? Date.now()),
        assistant_speech_id: String(speechId ?? ""),
      };

      if (
        Array.isArray(signals.pendingAssessmentTopics) &&
        signals.pendingAssessmentTopics.length > 0
      ) {
        attributes.assessment_trigger = JSON.stringify(
          signals.pendingAssessmentTopics,
        );
      }

      await lp.sendText(text, {
        topic: "lk.chat",
        attributes,
      });
      // Clear signal after sending
      signals.pendingAssessmentTopics = null;
    } catch (error) {
      console.error("forwardAssistantChatToRoom: sendText failed", error);
    }
  };

  session.on(SpeechCreated, (ev) => {
    const sh = ev?.speechHandle;
    if (!sh) return;
    const speechCreatedAt = ev?.createdAt ?? Date.now();
    const speechId = sh.id;

    sh.addDoneCallback(() => {
      for (const item of sh.chatItems || []) {
        if (!item || item.type !== "message" || item.role !== "assistant") {
          continue;
        }
        if (forwardedItemIds.has(item.id)) {
          continue;
        }
        let text =
          typeof item.textContent === "string" ? item.textContent.trim() : "";
          
        // CLEANUP: Remove any tool call tags that leaked into the transcript (e.g. {{trigger_assessment}})
        text = text.replace(/\{\{.*?\}\}/g, "").trim();

        if (!text) {
          continue;
        }
        forwardedItemIds.add(item.id);
        void sendAssistantText(text, speechCreatedAt, speechId);
      }
    });
  });
}
