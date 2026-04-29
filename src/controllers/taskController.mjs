import { updateTaskStatus, generatePracticeQuestions } from "../services/taskService.mjs";

/**
 * Controller for task-related operations.
 */
export const createTaskController = ({ openai, openAiModel } = {}) => {
  const updateStatus = async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const studentId = req.user.id;

      if (!["not_started", "in_progress", "completed"].includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
      }

      const updatedFlow = await updateTaskStatus(id, studentId, status);
      res.json(updatedFlow);
    } catch (error) {
      console.error("Error updating task status flow:", error);
      res.status(500).json({ error: error.message });
    }
  };

  const getPracticeQuestions = async (req, res) => {
    try {
      const { id } = req.params;
      const studentId = req.user.id;
      
      const questions = await generatePracticeQuestions(id, studentId, { openai, openAiModel });
      res.json(questions);
    } catch (error) {
      console.error("Error generating practice questions:", error);
      res.status(500).json({ error: error.message });
    }
  };

  return {
    updateStatus,
    getPracticeQuestions,
  };
};