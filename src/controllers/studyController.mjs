import {
  getAllStudyPlans,
  getAllStudyMaterials,
  getStudyMaterialById,
} from "../services/studyService.mjs";

import {
  getOrCreateTaskFlows,
  completeCurrentTask,
  generateChapterAssessment,
  saveChapterAssessment,
  fetchAssessmentStatuses,
  getChapterAssessmentMistakes,
} from "../services/taskService.mjs";

/**
 * Controller for handling study-related requests.
 */
export const createStudyController = ({ openai, openAiModel } = {}) => {
  const getStudyPlans = async (req, res) => {
    try {
      // Deprecated, returning empty or could fetch tasks
      res.status(200).json({ success: true, data: [] });
    } catch (error) {
      console.error("Error fetching study plans:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const getStudyMaterials = async (req, res) => {
    try {
      const materials = await getAllStudyMaterials();
      res.status(200).json({ success: true, data: materials });
    } catch (error) {
      console.error("Error fetching study materials:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const downloadStudyMaterial = async (req, res) => {
    try {
      const { id } = req.params;
      const material = await getStudyMaterialById(id);

      if (!material || !material.fileData) {
        return res.status(404).json({ success: false, message: "Study material or PDF file not found" });
      }

      res.setHeader("Content-Type", material.fileType || "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${material.fileName}"`);
      res.send(material.fileData);
    } catch (error) {
      console.error("Error downloading study material:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const getProgress = async (req, res) => {
    try {
      const userId = req.user.sub || req.params?.userId;
      if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
      const flows = await getOrCreateTaskFlows(userId);
      res.status(200).json({ success: true, data: flows });
    } catch (error) {
      console.error("Error fetching task flows:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const completeTopic = async (req, res) => {
    try {
      const userId = req.user.sub;
      const flows = await completeCurrentTask(userId);
      res.status(200).json({ success: true, data: flows });
    } catch (error) {
      console.error("Error completing task:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const internalGetStudyContext = async (req, res) => {
    try {
      const { userId } = req.params;
      const flows = await getOrCreateTaskFlows(userId);
      if (!flows || flows.length === 0) {
        return res.status(200).json({ ok: true, studyContext: null });
      }

      const activeFlow = flows.find(f => f.status === "in_progress") || flows[0];
      const task = activeFlow.taskId;
      
      const isCompleted = flows.every(f => f.status === "completed");
      const completedCount = flows.filter(f => f.status === "completed").length;
      
      res.status(200).json({
        ok: true,
        studyContext: {
          planId: task._id,
          subject: task.stream || "General",
          currentChapter: {
            title: task.chapterTitle || "Chapter",
            number: task.order || 1,
          },
          currentTopic: {
            title: String(task.topic || "").trim(),
          },
          totalChapters: flows.length,
          progressPercent: flows.length > 0 ? Math.round((completedCount / flows.length) * 100) : 0,
          isCompleted: isCompleted,
        },
      });
    } catch (error) {
      console.error("Internal error fetching study context:", error);
      res.status(500).json({ ok: false, message: error.message });
    }
  };

  const internalCompleteTopic = async (req, res) => {
    try {
      const { userId } = req.body;
      const flows = await completeCurrentTask(userId);
      res.status(200).json({ ok: true, data: flows });
    } catch (error) {
      console.error("Internal error completing task:", error);
      res.status(500).json({ ok: false, message: error.message });
    }
  };

  const getChapterAssessment = async (req, res) => {
    try {
      const userId = req.user.sub;
      const { chapterIndex } = req.params;
      const assessment = await generateChapterAssessment(userId, Number(chapterIndex), { openai, openAiModel });
      res.status(200).json({ success: true, ...assessment });
    } catch (error) {
      console.error("Error generating assessment:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const submitChapterAssessment = async (req, res) => {
    try {
      const userId = req.user.sub;
      const { chapterIndex } = req.params;
      const { answers } = req.body;
      const result = await saveChapterAssessment(userId, Number(chapterIndex), answers);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error("Error submitting assessment:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const getAssessmentStatuses = async (req, res) => {
    try {
      const userId = req.user.sub;
      const statuses = await fetchAssessmentStatuses(userId);
      res.status(200).json({ success: true, data: statuses });
    } catch (error) {
      console.error("Error fetching assessment statuses:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const getChapterMistakes = async (req, res) => {
    try {
      const userId = req.user.sub;
      const { chapterIndex } = req.params;
      const details = await getChapterAssessmentMistakes(userId, Number(chapterIndex));
      if (!details) {
        return res.status(404).json({ success: false, message: "No assessment found for this chapter yet." });
      }
      res.status(200).json({ success: true, data: details });
    } catch (error) {
      console.error("Error fetching chapter mistakes:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  return {
    getStudyPlans,
    getStudyMaterials,
    downloadStudyMaterial,
    getProgress,
    completeTopic,
    internalGetStudyContext,
    internalCompleteTopic,
    getChapterAssessment,
    submitChapterAssessment,
    getAssessmentStatuses,
    getChapterMistakes,
  };
};
