import { AccessToken } from "livekit-server-sdk";

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function createLivekitToken({ identity, name, roomName, livekitApiKey, livekitApiSecret }) {
  const token = new AccessToken(livekitApiKey, livekitApiSecret, { identity, name });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });
  return token.toJwt();
}

export function createAvatarService(deps) {
  const {
    roomServiceClient,
    agentDispatchClient,
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    livekitAgentName,
    avatarIdentity,
  } = deps;

  const createSession = async (user) => {
    if (!roomServiceClient || !agentDispatchClient) {
      throw createHttpError(500, "LiveKit is not configured.");
    }

    const roomName = `mentor-${user.sub}`;
    const userIdentity = `user-${user.sub}`;
    try {
      await roomServiceClient.createRoom({
        name: roomName,
        emptyTimeout: 60 * 10,
        maxParticipants: 6,
      });
    } catch (error) {
      if (!String(error.message || "").includes("already exists")) throw error;
    }

    const existingDispatches = await agentDispatchClient.listDispatch(roomName);
    const sameAgentDispatches = existingDispatches.filter((dispatch) => dispatch.agentName === livekitAgentName);
    for (const dispatch of sameAgentDispatches) {
      try {
        await agentDispatchClient.deleteDispatch(dispatch.id, roomName);
      } catch {
        // ignore stale delete failures
      }
    }

    const staleParticipants = await roomServiceClient.listParticipants(roomName).catch(() => []);
    for (const participant of staleParticipants) {
      const identity = participant.identity;
      const shouldRemove =
        identity === userIdentity ||
        identity === avatarIdentity ||
        identity?.startsWith("agent-") ||
        identity?.includes("bey");
      if (!shouldRemove) continue;
      try {
        await roomServiceClient.removeParticipant(roomName, identity);
      } catch {
        // ignore remove failures
      }
    }

    const participantToken = await createLivekitToken({
      identity: userIdentity,
      name: user.name || "AI Mentor User",
      roomName,
      livekitApiKey,
      livekitApiSecret,
    });

    const dispatch = await agentDispatchClient.createDispatch(roomName, livekitAgentName);
    return {
      roomName,
      livekitUrl,
      participantToken,
      dispatchAgent: livekitAgentName,
      dispatchId: dispatch.id,
    };
  };

  const endSession = async (user) => {
    if (!roomServiceClient || !agentDispatchClient) {
      throw createHttpError(500, "LiveKit is not configured.");
    }

    const roomName = `mentor-${user.sub}`;
    const userIdentity = `user-${user.sub}`;
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
      const shouldRemove = identity === userIdentity || identity === avatarIdentity || identity?.startsWith("agent-");
      if (!shouldRemove) continue;
      try {
        await roomServiceClient.removeParticipant(roomName, identity);
      } catch {
        // ignore remove failures
      }
    }
    return { ok: true, roomName };
  };

  const listRoomParticipants = async (roomName) => {
    if (!roomServiceClient) throw createHttpError(500, "LiveKit is not configured.");
    const participants = await roomServiceClient.listParticipants(roomName);
    return {
      roomName,
      count: participants.length,
      participants: participants.map((p) => ({
        identity: p.identity,
        name: p.name,
        state: p.state,
      })),
    };
  };

  return { createSession, endSession, listRoomParticipants };
}
