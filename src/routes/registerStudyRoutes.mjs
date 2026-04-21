import { createStudyController } from "../controllers/studyController.mjs";

/**
 * Registers study-related routes to the express application.
 */
export const registerStudyRoutes = (app, { verifyHttpAuth }) => {
  const controller = createStudyController();

  // Fetch all study plans
  app.get("/study-plans", verifyHttpAuth, controller.getStudyPlans);

  // Fetch all study materials
  app.get("/study-materials", verifyHttpAuth, controller.getStudyMaterials);

  // Download study material PDF
  app.get("/study-materials/:id/download", verifyHttpAuth, controller.downloadStudyMaterial);

  // Study Progress (Candidate)
  app.get("/data/study-progress", verifyHttpAuth, controller.getProgress);
  app.post("/data/study-progress/complete", verifyHttpAuth, controller.completeTopic);

  // Internal routes for worker
  app.get("/internal/candidates/:userId/study-context", controller.internalGetStudyContext);
  app.post("/internal/training/complete-topic", controller.internalCompleteTopic);
};
