import { createAttendanceService } from "../services/attendanceService.mjs";

export function createAttendanceController(deps) {
  const service = createAttendanceService(deps);
  const sendError = (res, error, fallback) => {
    const body = { message: error?.message || fallback };
    if (error && typeof error === "object" && "markedCompleted" in error) {
      body.markedCompleted = error.markedCompleted;
    }
    return res.status(Number(error?.status) || 500).json(body);
  };

  const cameraAttendance = async (req, res) => {
    try {
      return res.json(await service.cameraAttendance(req.user, req.body));
    } catch (error) {
      return sendError(res, error, "Failed to persist camera attendance.");
    }
  };

  const latestCameraAttendance = async (req, res) => {
    try {
      return res.json(await service.latestCameraAttendance(req.query));
    } catch (error) {
      return sendError(res, error, "Failed to load camera attendance.");
    }
  };

  const markCompletion = async (req, res) => {
    try {
      return res.json(await service.markCompletion(req.user));
    } catch (error) {
      return sendError(res, error, "Failed to mark completion.");
    }
  };

  const internalMarkCompletion = async (req, res) => {
    try {
      return res.json(await service.internalMarkCompletion(req.headers["x-internal-key"], req.body));
    } catch (error) {
      return sendError(res, error, "Failed to mark completion internally.");
    }
  };

  return {
    cameraAttendance,
    latestCameraAttendance,
    markCompletion,
    internalMarkCompletion,
  };
}
