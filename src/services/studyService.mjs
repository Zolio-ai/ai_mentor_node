import { StudyPlan, StudyMaterial, StudyProgress, User, AssessmentResult } from "../models/index.mjs";

const DEFAULT_TOPIC_DURATION_SECONDS = 8 * 60;

const sanitizeAvgDuration = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TOPIC_DURATION_SECONDS;
  return Math.max(60, Math.round(parsed));
};

const computeExpectedCompletionAt = (startedAt, avgSeconds) => {
  const started = startedAt instanceof Date ? startedAt : new Date(startedAt || Date.now());
  return new Date(started.getTime() + sanitizeAvgDuration(avgSeconds) * 1000);
};

const mapWeeksToChapters = (weeks = []) =>
  (Array.isArray(weeks) ? weeks : []).map((week, index) => ({
    _id: week?._id,
    chapterNumber: Number(week?.weekNumber || index + 1),
    chapterTitle: String(week?.title || `Week ${index + 1}`).trim(),
    topics: (Array.isArray(week?.topics) ? week.topics : [])
      .map((topic, topicIndex) => ({
        _id: `${week?._id || `week-${index + 1}`}-topic-${topicIndex}`,
        title: String(topic || "").trim(),
        content: "",
        media: [],
      }))
      .filter((topic) => topic.title.length > 0),
  }));

const getProgressChapters = (progress) => {
  if (progress?.studyMaterialId?.chapters) {
    return {
      chapters: progress.studyMaterialId.chapters,
      sourceType: "material",
    };
  }
  const chapters = mapWeeksToChapters(progress?.studyPlanId?.weeks || []);
  return { chapters, sourceType: "plan" };
};

const applyLegacyMaterialShapeFromPlan = (progress) => {
  if (!progress || progress.studyMaterialId || !progress.studyPlanId) return progress;
  const pseudoMaterial = {
    _id: progress.studyPlanId._id,
    subject: progress.studyPlanId.planName || "General Plan",
    chapters: mapWeeksToChapters(progress.studyPlanId.weeks || []),
    rawContent: progress.studyPlanId.rawContent || "",
  };
  progress.studyMaterialId = pseudoMaterial;
  return progress;
};

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
  let progress = await StudyProgress.findOne({ userId })
    .populate("studyMaterialId")
    .populate("studyPlanId");
  if (!progress) {
    // Prefer StudyPlan matching user's stream/track name.
    const user = await User.findById(userId);
    const stream = user?.stream || "General";
    let plan = await StudyPlan.findOne({ planName: new RegExp(stream, "i") });
    if (!plan) plan = await StudyPlan.findOne({});

    // Backward compatibility fallback.
    let material = null;
    if (!plan) {
      material = await StudyMaterial.findOne({ subject: new RegExp(stream, "i") });
      if (!material) material = await StudyMaterial.findOne({});
    }

    const assignedPlanId = plan?._id || null;
    const assignedMaterialId = material?._id || null;
    if (assignedPlanId || assignedMaterialId) {
      const now = new Date();
      progress = await StudyProgress.create({
        userId,
        studyPlanId: assignedPlanId,
        studyMaterialId: assignedMaterialId,
        topicStartedAt: now,
        avgTopicDurationSeconds: DEFAULT_TOPIC_DURATION_SECONDS,
        expectedTopicCompletionAt: computeExpectedCompletionAt(now, DEFAULT_TOPIC_DURATION_SECONDS),
      });
      progress = await progress.populate("studyMaterialId").populate("studyPlanId");
    }
  } else {
    let shouldSave = false;
    if (!progress.studyPlanId) {
      const user = await User.findById(userId);
      const stream = user?.stream || "General";
      let plan = await StudyPlan.findOne({ planName: new RegExp(stream, "i") });
      if (!plan) plan = await StudyPlan.findOne({});
      if (plan) {
        progress.studyPlanId = plan._id;
        shouldSave = true;
      }
    }
    if (!progress.topicStartedAt) {
      progress.topicStartedAt = new Date();
      shouldSave = true;
    }
    if (!progress.avgTopicDurationSeconds || progress.avgTopicDurationSeconds <= 0) {
      progress.avgTopicDurationSeconds = DEFAULT_TOPIC_DURATION_SECONDS;
      shouldSave = true;
    }
    if (!progress.expectedTopicCompletionAt) {
      progress.expectedTopicCompletionAt = computeExpectedCompletionAt(
        progress.topicStartedAt,
        progress.avgTopicDurationSeconds,
      );
      shouldSave = true;
    }
    if (shouldSave) await progress.save();
    if (progress.studyPlanId && !progress.populated("studyPlanId")) {
      await progress.populate("studyPlanId");
    }
  }
  return applyLegacyMaterialShapeFromPlan(progress);
};

/**
 * Updates study progress.
 */
export const updateStudyProgress = async (userId, chapterIndex, topicIndex) => {
  const progress = await StudyProgress.findOne({ userId });
  if (!progress) return null;

  progress.currentChapterIndex = chapterIndex;
  progress.currentTopicIndex = topicIndex;
  progress.topicStartedAt = new Date();
  progress.avgTopicDurationSeconds = sanitizeAvgDuration(progress.avgTopicDurationSeconds);
  progress.expectedTopicCompletionAt = computeExpectedCompletionAt(
    progress.topicStartedAt,
    progress.avgTopicDurationSeconds,
  );
  progress.lastAccessedAt = new Date();
  
  // Logic for completion could be added here
  
  await progress.save();
  return progress;
};

/**
 * Marks a topic as completed and moves to the next one.
 */
export const completeCurrentTopic = async (userId) => {
  let progress = await StudyProgress.findOne({ userId })
    .populate("studyMaterialId")
    .populate("studyPlanId");
  if (!progress) return null;

  const { chapters } = getProgressChapters(progress);
  const currentChapter = chapters[progress.currentChapterIndex];
  if (!currentChapter) return progress;

  const topics = currentChapter.topics || [];
  const now = new Date();
  const startedAt = progress.topicStartedAt ? new Date(progress.topicStartedAt) : now;
  const durationSeconds = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));
  const currentChapterIndex = progress.currentChapterIndex;
  const currentTopicIndex = progress.currentTopicIndex;

  if (Array.isArray(progress.completedTopics)) {
    progress.completedTopics.push({
      chapterIndex: currentChapterIndex,
      topicIndex: currentTopicIndex,
      durationSeconds,
      completedAt: now,
    });
  } else {
    progress.completedTopics = [
      {
        chapterIndex: currentChapterIndex,
        topicIndex: currentTopicIndex,
        durationSeconds,
        completedAt: now,
      },
    ];
  }

  const durations = progress.completedTopics
    .map((item) => Number(item?.durationSeconds || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  progress.avgTopicDurationSeconds =
    durations.length > 0
      ? Math.max(60, Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length))
      : sanitizeAvgDuration(progress.avgTopicDurationSeconds);
  
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

  progress.topicStartedAt = now;
  progress.expectedTopicCompletionAt = progress.isCompleted
    ? null
    : computeExpectedCompletionAt(now, progress.avgTopicDurationSeconds);
  progress.lastAccessedAt = now;
  await progress.save();
  return applyLegacyMaterialShapeFromPlan(progress);
};

/**
 * Normalizes assessment questions generated by AI.
 */
const normalizeAssessmentQuestions = (raw, limit = 10) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      const options = Array.isArray(item?.options)
        ? item.options.map((opt) => String(opt || "").trim()).filter(Boolean)
        : [];
      const question = String(item?.question || "").trim();
      if (!question || options.length < 2) return null;
      const correctAnswer = String(item?.correctAnswer || "").trim();
      return {
        id: String(item?.id || `q${idx + 1}`),
        question,
        options: options.slice(0, 4),
        correctAnswer: correctAnswer || options[0],
      };
    })
    .filter(Boolean)
    .slice(0, limit);
};

/**
 * Generates an assessment for a specific chapter index.
 */
export const generateChapterAssessment = async (userId, chapterIndex, { openai, openAiModel }) => {
  const progress = await getOrCreateStudyProgress(userId);
  if (!progress) throw new Error("No study plan assigned.");

  const { chapters } = getProgressChapters(progress);
  const chapter = chapters[chapterIndex];
  if (!chapter) throw new Error(`Chapter at index ${chapterIndex} not found.`);

  // Combine topic content for context
  const context = chapter.topics
    .map((t) => `Topic: ${t.title}\nContent: ${t.content}`)
    .join("\n\n");

  if (!openai) throw new Error("AI service unavailable.");

  const completion = await openai.chat.completions.create({
    model: openAiModel || "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `Create 10 MCQ questions based on the following study chapter content. Return strict JSON: {"title":"...","questions":[{"id":"q1","question":"...","options":["...","...","...","..."],"correctAnswer":"..."}]}`,
      },
      {
        role: "user",
        content: `Chapter Title: ${chapter.chapterTitle}\n\nContent:\n${context}`,
      },
    ],
  });

  const raw = String(completion.choices?.[0]?.message?.content || "").trim();
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }

  const questions = normalizeAssessmentQuestions(parsed?.questions, 10);
  return {
    title: String(parsed?.title || `Assessment: ${chapter.chapterTitle}`),
    questions,
  };
};

/**
 * Saves or updates assessment results.
 */
export const saveChapterAssessment = async (userId, chapterIndex, userAnswers) => {
  const progress = await getOrCreateStudyProgress(userId);
  if (!progress) throw new Error("No study plan assigned.");
  
  // Calculate score
  let score = 0;
  const processedAnswers = [];
  
  // Note: Validation of correct answers should ideally be done against cached questions,
  // but since we generate them on the fly, we rely on the payload for this simplified version.
  // In a production app, questions should be stored before being sent to the client.
  for (const ans of userAnswers) {
    if (ans.isCorrect) score += 1;
    processedAnswers.push({
      questionId: ans.id,
      question: String(ans.question || "").trim(),
      selectedOption: ans.selected,
      correctAnswer: String(ans.correctAnswer || "").trim(),
      isCorrect: ans.isCorrect
    });
  }

  const query = {
    userId,
    chapterIndex,
    ...(progress?.studyPlanId?._id
      ? { studyPlanId: progress.studyPlanId._id }
      : { studyMaterialId: progress?.studyMaterialId?._id }),
  };
  const existing = await AssessmentResult.findOne(query);
  if (existing) {
    existing.score = score;
    existing.answers = processedAnswers;
    existing.attempts += 1;
    await existing.save();
    return existing;
  }

  const newResult = await AssessmentResult.create({
    userId,
    studyMaterialId: progress?.studyMaterialId?._id || null,
    studyPlanId: progress?.studyPlanId?._id || null,
    chapterIndex,
    score,
    totalQuestions: processedAnswers.length || 10,
    answers: processedAnswers,
    attempts: 1
  });

  return newResult;
};

export const getChapterAssessmentMistakes = async (userId, chapterIndex) => {
  const progress = await getOrCreateStudyProgress(userId);
  if (!progress) return null;

  const query = {
    userId,
    chapterIndex,
    ...(progress?.studyPlanId?._id
      ? { studyPlanId: progress.studyPlanId._id }
      : progress?.studyMaterialId?._id
        ? { studyMaterialId: progress.studyMaterialId._id }
        : {}),
  };

  const latestResult = await AssessmentResult.findOne(query).sort({ updatedAt: -1 }).lean();
  if (!latestResult) return null;

  const mistakes = (Array.isArray(latestResult.answers) ? latestResult.answers : [])
    .filter((item) => item?.isCorrect === false)
    .map((item, idx) => ({
      id: String(item?.questionId || `m${idx + 1}`),
      question: String(item?.question || "").trim() || `Question ${idx + 1}`,
      selectedOption: String(item?.selectedOption || "").trim(),
      correctAnswer: String(item?.correctAnswer || "").trim(),
    }));

  return {
    chapterIndex,
    score: Number(latestResult.score || 0),
    totalQuestions: Number(latestResult.totalQuestions || 0),
    mistakes,
    updatedAt: latestResult.updatedAt,
  };
};

/**
 * Retrieves assessment statuses for all chapters of the current material.
 */
export const getAssessmentStatuses = async (userId) => {
  const progress = await getOrCreateStudyProgress(userId);
  if (!progress) return [];

  const query = progress?.studyPlanId?._id
    ? { userId, studyPlanId: progress.studyPlanId._id }
    : progress?.studyMaterialId?._id
      ? { userId, studyMaterialId: progress.studyMaterialId._id }
      : null;
  if (!query) return [];

  const results = await AssessmentResult.find(query).lean();

  return results.map(r => ({
    chapterIndex: r.chapterIndex,
    score: r.score,
    totalQuestions: r.totalQuestions,
    attempts: r.attempts,
    updatedAt: r.updatedAt
  }));
};
