import { AccessToken } from "livekit-server-sdk";

async function createLivekitToken({ identity, name, roomName, livekitApiKey, livekitApiSecret }) {
  const token = new AccessToken(livekitApiKey, livekitApiSecret, {
    identity,
    name,
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return token.toJwt();
}

export function registerAvatarRoutes(app, deps) {
  const {
    verifyHttpAuth,
    roomServiceClient,
    agentDispatchClient,
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    livekitAgentName,
    avatarIdentity,
  } = deps;

  app.post("/avatar/bey/session", verifyHttpAuth, async (req, res) => {
    try {
      if (!roomServiceClient || !agentDispatchClient) {
        return res.status(500).json({ message: "LiveKit is not configured." });
      }

      const roomName = `mentor-${req.user.sub}`;
      try {
        await roomServiceClient.createRoom({
          name: roomName,
          emptyTimeout: 60 * 10,
          maxParticipants: 6,
        });
      } catch (error) {
        if (!String(error.message || "").includes("already exists")) {
          throw error;
        }
      }

      const participantToken = await createLivekitToken({
        identity: `user-${req.user.sub}`,
        name: req.user.name || "AI Mentor User",
        roomName,
        livekitApiKey,
        livekitApiSecret,
      });

      const existingDispatches = await agentDispatchClient.listDispatch(roomName);
      const sameAgentDispatches = existingDispatches.filter(
        (dispatch) => dispatch.agentName === livekitAgentName,
      );
      for (const dispatch of sameAgentDispatches) {
        try {
          await agentDispatchClient.deleteDispatch(dispatch.id, roomName);
        } catch {
          // ignore stale delete failures
        }
      }

      const dispatch = await agentDispatchClient.createDispatch(roomName, livekitAgentName);
      return res.json({
        roomName,
        livekitUrl,
        participantToken,
        dispatchAgent: livekitAgentName,
        dispatchId: dispatch.id,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to start BEY session." });
    }
  });

  app.post("/avatar/bey/end", verifyHttpAuth, async (req, res) => {
    try {
      if (!roomServiceClient || !agentDispatchClient) {
        return res.status(500).json({ message: "LiveKit is not configured." });
      }

      const roomName = `mentor-${req.user.sub}`;
      const userIdentity = `user-${req.user.sub}`;

      const existingDispatches = await agentDispatchClient.listDispatch(roomName);
      for (const dispatch of existingDispatches) {
        if (dispatch.agentName !== livekitAgentName) continue;
        try {
          await agentDispatchClient.deleteDispatch(dispatch.id, roomName);
        } catch {
          // ignore delete failures
        }
      }

      const participants = await roomServiceClient.listParticipants(roomName).catch(() => []);
      for (const participant of participants) {
        const identity = participant.identity;
        const shouldRemove =
          identity === userIdentity || identity === avatarIdentity || identity?.startsWith("agent-");
        if (!shouldRemove) continue;
        try {
          await roomServiceClient.removeParticipant(roomName, identity);
        } catch {
          // ignore remove failures
        }
      }

      return res.json({ ok: true, roomName });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to end conversation." });
    }
  });

  app.get("/avatar/bey/room/:roomName/participants", verifyHttpAuth, async (req, res) => {
    try {
      if (!roomServiceClient) {
        return res.status(500).json({ message: "LiveKit is not configured." });
      }
      const participants = await roomServiceClient.listParticipants(req.params.roomName);
      return res.json({
        roomName: req.params.roomName,
        count: participants.length,
        participants: participants.map((p) => ({
          identity: p.identity,
          name: p.name,
          state: p.state,
        })),
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to list participants." });
    }
  });
}
