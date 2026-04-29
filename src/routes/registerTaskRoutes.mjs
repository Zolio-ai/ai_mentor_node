import { createTaskController } from "../controllers/taskController.mjs";

/**
 * Registers task-related routes to the express application.
 * 
 * @param {Object} app - The Express application instance.
 * @param {Object} dependencies - Object containing middleware and other dependencies.
 */
export const registerTaskRoutes = (app, { verifyHttpAuth, openai, openAiModel }) => {
  const controller = createTaskController({ openai, openAiModel });

  // Update task status
  app.patch("/tasks/:id/status", verifyHttpAuth, controller.updateStatus);

  // Get practice questions for a topic/task
  app.get("/topics/:id/practice-questions", verifyHttpAuth, controller.getPracticeQuestions);
};
