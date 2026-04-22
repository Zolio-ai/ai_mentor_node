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

const SESSION_DEDUPE_TTL_MS = 8000;
const recentSessions = new Map();
const inFlightSessions = new Map();

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

  const buildSessionForRoom = async (user, roomName, userIdentity) => {
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
    const sameAgentDispatches = existingDispatches.filter(
      (dispatch) => dispatch.agentName === livekitAgentName,
    );

    // Reuse any existing dispatch — its presence means an agent job is already
    // in flight. Creating another stampedes Bey and exhausts concurrency.
    if (sameAgentDispatches.length > 0) {
      const participants = await roomServiceClient.listParticipants(roomName).catch(() => []);
      const staleUser = participants.find((p) => p.identity === userIdentity);
      if (staleUser) {
        await roomServiceClient.removeParticipant(roomName, userIdentity).catch(() => {});
      }
      const participantToken = await createLivekitToken({
        identity: userIdentity,
        name: user.name || "AI Mentor User",
        roomName,
        livekitApiKey,
        livekitApiSecret,
      });
      return {
        roomName,
        livekitUrl,
        participantToken,
        dispatchAgent: livekitAgentName,
        dispatchId: sameAgentDispatches[0].id,
        reused: true,
      };
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

  const createSession = async (user) => {
    if (!roomServiceClient || !agentDispatchClient) {
      throw createHttpError(500, "LiveKit is not configured.");
    }

    const roomName = `mentor-${user.sub}`;
    const userIdentity = `user-${user.sub}`;

    const cached = recentSessions.get(roomName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.response;
    }

    const inFlight = inFlightSessions.get(roomName);
    if (inFlight) return inFlight;

    const work = (async () => {
      try {
        const response = await buildSessionForRoom(user, roomName, userIdentity);
        recentSessions.set(roomName, {
          expiresAt: Date.now() + SESSION_DEDUPE_TTL_MS,
          response,
        });
        return response;
      } finally {
        inFlightSessions.delete(roomName);
      }
    })();

    inFlightSessions.set(roomName, work);
    return work;
  };

  const endSession = async (user) => {
    if (!roomServiceClient || !agentDispatchClient) {
      throw createHttpError(500, "LiveKit is not configured.");
    }

    const roomName = `mentor-${user.sub}`;
    const userIdentity = `user-${user.sub}`;
    recentSessions.delete(roomName);
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
