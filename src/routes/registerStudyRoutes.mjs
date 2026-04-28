import { createStudyController } from "../controllers/studyController.mjs";

/**
 * Registers study-related routes to the express application.
 */
export const registerStudyRoutes = (app, { verifyHttpAuth, openai, openAiModel }) => {
  const controller = createStudyController({ openai, openAiModel });

  // Fetch all study plans
  app.get("/study-plans", verifyHttpAuth, controller.getStudyPlans);

  // Fetch all study materials
  app.get("/study-materials", verifyHttpAuth, controller.getStudyMaterials);

  // Download study material PDF
  app.get("/study-materials/:id/download", verifyHttpAuth, controller.downloadStudyMaterial);

  // Study Progress (Candidate)
  app.get("/data/study-progress", verifyHttpAuth, controller.getProgress);
  app.post("/data/study-progress/complete", verifyHttpAuth, controller.completeTopic);

  // Assessment Endpoints
  app.get("/data/study/chapters/:chapterIndex/assessment", verifyHttpAuth, controller.getChapterAssessment);
  app.post("/data/study/chapters/:chapterIndex/submit", verifyHttpAuth, controller.submitChapterAssessment);
  app.get("/data/study/chapters/:chapterIndex/mistakes", verifyHttpAuth, controller.getChapterMistakes);
  app.get("/data/study/assessment-statuses", verifyHttpAuth, controller.getAssessmentStatuses);

  // Internal routes for worker
  app.get("/internal/candidates/:userId/study-context", controller.internalGetStudyContext);
  app.post("/internal/training/complete-topic", controller.internalCompleteTopic);
};
