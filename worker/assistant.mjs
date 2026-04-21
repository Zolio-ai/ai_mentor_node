import { voice } from "@livekit/agents";

/** @typedef {{ getSpeechId: () => string | null; publishPartial: (data: Record<string, unknown>) => void }} AiTranscriptHooks */

function chunkTextDelta(chunk) {
  if (typeof chunk === "string") return chunk;
  if (chunk && typeof chunk === "object" && chunk.delta && typeof chunk.delta.content === "string") {
    return chunk.delta.content;
  }
  return "";
}

/**
 * Wraps the default LLM stream so AI Mentor can push growing assistant text over the data channel
 * while tokens arrive (the SDK only commits the assistant chat item after audio playout ends).
 */
function wrapLlmStreamForLiveTranscript(innerStream, hooks) {
  const minIntervalMs = 300;
  let accumulated = "";
  let lastPublishAt = 0;
  let pendingTimer = null;
  /** First speech id used for this LLM stream (ref can change if another turn is queued). */
  let lockedSpeechId = null;

  const clearTimer = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const publishNow = (force) => {
    if (!lockedSpeechId) {
      lockedSpeechId = hooks.getSpeechId();
    }
    const speechId = lockedSpeechId;
    if (!speechId || !accumulated) return;
    const now = Date.now();
    if (!force && now - lastPublishAt < minIntervalMs) {
      if (!pendingTimer) {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          publishNow(true);
        }, minIntervalMs - (now - lastPublishAt));
      }
      return;
    }
    lastPublishAt = Date.now();
    hooks.publishPartial({
      type: "assistant_transcript",
      id: speechId,
      text: accumulated,
      partial: true,
      timestamp: Date.now(),
    });
  };

  return new ReadableStream({
    async start(controller) {
      const reader = innerStream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const delta = chunkTextDelta(value);
          if (delta) {
            accumulated += delta;
            publishNow(false);
          }
          controller.enqueue(value);
        }
        clearTimer();
        publishNow(true);
        controller.close();
      } catch (err) {
        clearTimer();
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      clearTimer();
      return innerStream.cancel(reason);
    },
  });
}

const ASSISTANT_INSTRUCTIONS = `You are an AI Mentor guiding candidates through interview preparation in an open-ended, unlimited doubt-clearing conversation.

## Core behavior
- This is **not** a fixed multi-section lesson.
- Do not behave like a scripted trainer with "next part" or "next section" prompts.
- Handle unlimited questions continuously for as long as the candidate wants.
- Personalize guidance to candidate level, weak/strong subjects, and asked goals.

## Response style
- Keep answers practical, concise, and confidence-building.
- Explain in simple steps first, then add depth when requested.
- Use examples, mini-practice prompts, and quick checks when useful.
- Reply in the same language the candidate used in their latest message.
- If the candidate speaks Malayalam, respond in Malayalam.
- If the candidate speaks English, respond in English.
- Do not switch language unless the candidate explicitly asks to switch.
- End most responses with doubt-focused prompts like:
  - "Any other doubt you have?"
  - "Want me to explain this with another example?"
  - "What do you want help with next?"

## Formatting
- **Plain text ONLY.** Do not use any special characters like asterisks (**), hashtags (###), or Markdown symbols for bolding, headers, or lists.
- Write naturally as if speaking. Use simple spaces or newlines for separation if needed, but never use Markdown formatting characters.

## Scope
- Prioritize interview prep, study strategy, problem-solving approach, revision planning, and communication confidence.
- If asked unrelated questions, briefly redirect to candidate preparation goals.

## If unsure
- Admit uncertainty briefly.
- Give safest best-effort direction.
- Suggest what to revise next.`;

export class Assistant extends voice.Agent {
  /** @param {(AiTranscriptHooks & { additionalInstructions?: string }) | null | undefined} aiTranscriptHooks */
  constructor(aiTranscriptHooks) {
    const additionalInstructions = String(aiTranscriptHooks?.additionalInstructions || "").trim();
    const finalInstructions = additionalInstructions
      ? `${ASSISTANT_INSTRUCTIONS}\n\n## Candidate-specific mentoring context\n${additionalInstructions}`
      : ASSISTANT_INSTRUCTIONS;
    super({
      instructions: finalInstructions,
    });
    this._aiTranscriptHooks = aiTranscriptHooks ?? null;
  }

  async llmNode(chatCtx, toolCtx, modelSettings) {
    const inner = await voice.Agent.default.llmNode(this, chatCtx, toolCtx, modelSettings);
    const hooks = this._aiTranscriptHooks;
    if (!inner || !hooks?.publishPartial || !hooks?.getSpeechId) {
      return inner;
    }
    return wrapLlmStreamForLiveTranscript(inner, hooks);
  }
}
