import { createAvatarService } from "../services/avatarService.mjs";

export function createAvatarController(deps) {
  const service = createAvatarService(deps);
  const sendError = (res, error, fallback) =>
    res.status(Number(error?.status) || 500).json({ message: error?.message || fallback });

  const createSession = async (req, res) => {
    try {
      return res.json(await service.createSession(req.user));
    } catch (error) {
      return sendError(res, error, "Failed to start BEY session.");
    }
  };

  const endSession = async (req, res) => {
    try {
      return res.json(await service.endSession(req.user));
    } catch (error) {
      return sendError(res, error, "Failed to end conversation.");
    }
  };

  const listRoomParticipants = async (req, res) => {
    try {
      return res.json(await service.listRoomParticipants(req.params.roomName));
    } catch (error) {
      return sendError(res, error, "Failed to list participants.");
    }
  };

  return {
    createSession,
    endSession,
    listRoomParticipants,
  };
}
