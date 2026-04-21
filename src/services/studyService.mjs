import { StudyPlan, StudyMaterial, StudyProgress, User } from "../models/index.mjs";

/**
 * Fetches all study plans from the database.
 */
export const getAllStudyPlans = async () => {
  return await StudyPlan.find().sort({ createdAt: -1 });
};

/**
 * Fetches all study materials from the database.
 */
export const getAllStudyMaterials = async () => {
  return await StudyMaterial.find().sort({ createdAt: -1 });
};

/**
 * Fetches a single study material by ID.
 */
export const getStudyMaterialById = async (id) => {
  return await StudyMaterial.findById(id);
};

/**
 * Gets or creates study progress for a user.
 */
export const getOrCreateStudyProgress = async (userId) => {
  let progress = await StudyProgress.findOne({ userId }).populate("studyMaterialId");
  if (!progress) {
    // Try to find a matching material by user stream
    const user = await User.findById(userId);
    const stream = user?.stream || "General";
    
    let material = await StudyMaterial.findOne({ subject: new RegExp(stream, "i") });
    if (!material) {
      material = await StudyMaterial.findOne({}); // Fallback to any material
    }

    if (material) {
      progress = await StudyProgress.create({
        userId,
        studyMaterialId: material._id,
      });
      progress = await progress.populate("studyMaterialId");
    }
  }
  return progress;
};

/**
 * Updates study progress.
 */
export const updateStudyProgress = async (userId, chapterIndex, topicIndex) => {
  const progress = await StudyProgress.findOne({ userId });
  if (!progress) return null;

  progress.currentChapterIndex = chapterIndex;
  progress.currentTopicIndex = topicIndex;
  progress.lastAccessedAt = new Date();
  
  // Logic for completion could be added here
  
  await progress.save();
  return progress;
};

/**
 * Marks a topic as completed and moves to the next one.
 */
export const completeCurrentTopic = async (userId) => {
  let progress = await StudyProgress.findOne({ userId }).populate("studyMaterialId");
  if (!progress || !progress.studyMaterialId) return null;

  const chapters = progress.studyMaterialId.chapters || [];
  const currentChapter = chapters[progress.currentChapterIndex];
  if (!currentChapter) return progress;

  const topics = currentChapter.topics || [];
  
  if (progress.currentTopicIndex < topics.length - 1) {
    // Next topic in same chapter
    progress.currentTopicIndex += 1;
  } else if (progress.currentChapterIndex < chapters.length - 1) {
    // Next chapter, first topic
    progress.currentChapterIndex += 1;
    progress.currentTopicIndex = 0;
  } else {
    // All done
    progress.isCompleted = true;
  }

  progress.lastAccessedAt = new Date();
  await progress.save();
  return progress;
};
