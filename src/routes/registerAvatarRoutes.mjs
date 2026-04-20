import { createAvatarController } from "../controllers/avatarController.mjs";

export function registerAvatarRoutes(app, deps) {
  const { verifyHttpAuth } = deps;
  const controller = createAvatarController(deps);

  app.post("/avatar/bey/session", verifyHttpAuth, controller.createSession);
  app.post("/avatar/bey/end", verifyHttpAuth, controller.endSession);
  app.get("/avatar/bey/room/:roomName/participants", verifyHttpAuth, controller.listRoomParticipants);
}
