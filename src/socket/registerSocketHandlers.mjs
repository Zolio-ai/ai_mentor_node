import jwt from "jsonwebtoken";

function splitIntoSpeakableChunks(buffer) {
  const parts = buffer.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return parts.map((part) => part.trim()).filter(Boolean);
}

async function transcribeAudioWithDeepgram(base64Audio, mimeType, deepgramSttModel, deepgramApiKey) {
  const response = await fetch(
    `https://api.deepgram.com/v1/listen?model=${deepgramSttModel}&smart_format=true&punctuate=true&interim_results=false`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type": mimeType || "application/octet-stream",
      },
      body: Buffer.from(base64Audio, "base64"),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deepgram STT failed: ${text}`);
  }

  const payload = await response.json();
  return payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
}

async function synthesizeTtsWithDeepgram(text, deepgramTtsModel, deepgramApiKey) {
  const response = await fetch(
    `https://api.deepgram.com/v1/speak?model=${deepgramTtsModel}&encoding=mp3`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Deepgram TTS failed: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

export function registerSocketHandlers(io, deps) {
  const { jwtSecret, openai, openAiModel, deepgramApiKey, deepgramSttModel, deepgramTtsModel } =
    deps;

  io.use((socket, next) => {
    const authToken = socket.handshake.auth?.token;
    if (!authToken) {
      return next(new Error("Missing auth token"));
    }
    try {
      const payload = jwt.verify(authToken, jwtSecret);
      socket.user = payload;
      return next();
    } catch {
      return next(new Error("Invalid auth token"));
    }
  });

  io.on("connection", (socket) => {
    let currentAiMessageId = null;
    let currentAiRunId = null;
    let aiAbortController = null;
    let wasInterrupted = false;
    let ttsQueue = [];
    let isTtsPlaying = false;
    const conversationHistory = [
      {
        role: "system",
        content:
          "You are a concise, friendly POS assistant for a store cashier. Keep responses short and practical.",
      },
    ];

    const stopActiveReply = (reason = "interrupted") => {
      wasInterrupted = true;
      if (aiAbortController) {
        aiAbortController.abort();
        aiAbortController = null;
      }
      ttsQueue = [];
      isTtsPlaying = false;
      if (currentAiMessageId) {
        socket.emit("ai_interrupted", { messageId: currentAiMessageId, reason });
        currentAiMessageId = null;
        currentAiRunId = null;
      }
    };

    const flushTtsQueue = async () => {
      if (isTtsPlaying || ttsQueue.length === 0 || wasInterrupted) {
        return;
      }

      isTtsPlaying = true;
      while (ttsQueue.length > 0 && !wasInterrupted) {
        const chunk = ttsQueue.shift();
        try {
          const audioBase64 = await synthesizeTtsWithDeepgram(
            chunk,
            deepgramTtsModel,
            deepgramApiKey,
          );
          socket.emit("ai_audio", {
            mimeType: "audio/mpeg",
            audioBase64,
            text: chunk,
          });
        } catch (error) {
          socket.emit("conversation_error", { message: error.message });
        }
      }
      isTtsPlaying = false;
    };

    const runAiConversation = async (userText) => {
      stopActiveReply("new_user_message");
      wasInterrupted = false;
      aiAbortController = new AbortController();
      currentAiMessageId = `ai-${Date.now()}`;
      currentAiRunId = `run-${Date.now()}`;
      socket.emit("ai_started", { messageId: currentAiMessageId, runId: currentAiRunId });
      conversationHistory.push({ role: "user", content: userText });

      let aiBuffer = "";
      let fullResponse = "";

      try {
        const stream = await openai.chat.completions.create(
          {
            model: openAiModel,
            stream: true,
            temperature: 0.3,
            messages: conversationHistory,
          },
          { signal: aiAbortController.signal },
        );

        for await (const event of stream) {
          if (wasInterrupted) {
            break;
          }
          const chunk = event.choices?.[0]?.delta?.content || "";
          if (!chunk) continue;

          fullResponse += chunk;
          aiBuffer += chunk;
          socket.emit("ai_chunk", { messageId: currentAiMessageId, chunk });

          const speakableChunks = splitIntoSpeakableChunks(aiBuffer);
          if (speakableChunks.length > 1) {
            const readyChunks = speakableChunks.slice(0, -1);
            aiBuffer = speakableChunks[speakableChunks.length - 1];
            ttsQueue.push(...readyChunks);
            flushTtsQueue();
          }
        }

        if (!wasInterrupted && aiBuffer.trim()) {
          ttsQueue.push(aiBuffer.trim());
          aiBuffer = "";
          await flushTtsQueue();
        }

        if (!wasInterrupted) {
          conversationHistory.push({ role: "assistant", content: fullResponse });
          socket.emit("ai_finished", { messageId: currentAiMessageId });
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          socket.emit("conversation_error", { message: error.message || "AI stream failed." });
        }
      } finally {
        aiAbortController = null;
        currentAiMessageId = null;
        currentAiRunId = null;
      }
    };

    socket.emit("session_ready", {
      user: {
        id: socket.user.sub,
        name: socket.user.name,
        email: socket.user.email,
      },
      status: "connected",
    });

    socket.on("interrupt", () => {
      stopActiveReply("user_interrupt");
    });

    socket.on("user_message", async ({ text }) => {
      if (!text || typeof text !== "string") {
        socket.emit("conversation_error", { message: "Text is required." });
        return;
      }
      await runAiConversation(text.trim());
    });

    socket.on("stt_audio", async ({ audioBase64, mimeType }) => {
      if (!audioBase64) {
        socket.emit("conversation_error", { message: "Audio payload is required." });
        return;
      }

      try {
        socket.emit("stt_status", { status: "processing" });
        const transcript = await transcribeAudioWithDeepgram(
          audioBase64,
          mimeType,
          deepgramSttModel,
          deepgramApiKey,
        );
        if (!transcript) {
          socket.emit("stt_status", { status: "empty" });
          return;
        }

        socket.emit("stt_final", { transcript });
        await runAiConversation(transcript);
      } catch (error) {
        socket.emit("conversation_error", { message: error.message || "STT failed." });
      }
    });

    socket.on("disconnect", () => {
      stopActiveReply("disconnect");
    });
  });
}
