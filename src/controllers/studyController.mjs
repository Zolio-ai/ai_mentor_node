import {
  getAllStudyPlans,
  getAllStudyMaterials,
  getStudyMaterialById,
  getOrCreateStudyProgress,
  completeCurrentTopic,
  generateChapterAssessment,
  saveChapterAssessment,
  getAssessmentStatuses as fetchAssessmentStatuses,
} from "../services/studyService.mjs";

/**
 * Controller for handling study-related requests.
 */
export const createStudyController = ({ openai, openAiModel } = {}) => {
  const getStudyPlans = async (req, res) => {
    try {
      const plans = await getAllStudyPlans();
      res.status(200).json({ success: true, data: plans });
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
      const progress = await getOrCreateStudyProgress(userId);
      res.status(200).json({ success: true, data: progress });
    } catch (error) {
      console.error("Error fetching study progress:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const completeTopic = async (req, res) => {
    try {
      const userId = req.user.sub;
      const progress = await completeCurrentTopic(userId);
      res.status(200).json({ success: true, data: progress });
    } catch (error) {
      console.error("Error completing topic:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const internalGetStudyContext = async (req, res) => {
    try {
      const { userId } = req.params;
      const progress = await getOrCreateStudyProgress(userId);
      if (!progress || !progress.studyMaterialId) {
        return res.status(200).json({ ok: true, studyContext: null });
      }

      const material = progress.studyMaterialId;
      const chapter = material.chapters[progress.currentChapterIndex];
      const topic = chapter?.topics[progress.currentTopicIndex];

      res.status(200).json({
        ok: true,
        studyContext: {
          materialId: material._id,
          subject: material.subject,
          currentChapter: {
            title: chapter?.chapterTitle,
            number: chapter?.chapterNumber,
          },
          currentTopic: topic,
          totalChapters: material.chapters.length,
          progressPercent: Math.round(((progress.currentChapterIndex + 1) / material.chapters.length) * 100),
          isCompleted: progress.isCompleted,
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
      const progress = await completeCurrentTopic(userId);
      res.status(200).json({ ok: true, data: progress });
    } catch (error) {
      console.error("Internal error completing topic:", error);
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
  };
};
