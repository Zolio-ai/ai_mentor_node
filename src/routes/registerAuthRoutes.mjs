import { createAuthController } from "../controllers/authController.mjs";

export function registerAuthRoutes(app, deps) {
  const { verifyHttpAuth, verifyAdminAuth } = deps;
  const controller = createAuthController(deps);

  app.post("/auth/register", controller.register);
  app.post("/auth/login", controller.login);
  app.get("/auth/profile", verifyHttpAuth, controller.profile);
  app.post("/data/onboarding", verifyHttpAuth, controller.onboarding);
  app.get("/data/profile", verifyHttpAuth, controller.profileData);
  app.get("/internal/candidates/:userId/profile", controller.internalCandidateProfile);
  app.post("/admin/login", controller.adminLogin);
  app.post("/admin/invitations", verifyAdminAuth, controller.createInvitation);
  app.get("/admin/candidates/invited", verifyAdminAuth, controller.invitedCandidates);
  app.post("/ai/respond", controller.aiRespond);
  app.post("/ai/end-intent", verifyHttpAuth, controller.aiEndIntent);
  app.post("/internal/training/end-intent", controller.internalTrainingEndIntent);
}
