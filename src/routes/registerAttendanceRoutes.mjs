import { createAttendanceController } from "../controllers/attendanceController.mjs";

export function registerAttendanceRoutes(app, deps) {
  const { verifyHttpAuth, verifyAdminAuth } = deps;
  const controller = createAttendanceController(deps);

  app.post("/attendance/camera", verifyHttpAuth, controller.cameraAttendance);
  app.get("/attendance/camera/latest", verifyAdminAuth, controller.latestCameraAttendance);
  app.post("/attendance/completion", verifyHttpAuth, controller.markCompletion);
  app.post("/internal/training/completion", controller.internalMarkCompletion);
}
