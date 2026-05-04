import { Task, TaskFlow, User, AssessmentResult, StudyMaterial } from "../models/index.mjs";

const DEFAULT_TOPIC_DURATION_SECONDS = 8 * 60;

export const updateTaskStatus = async (taskId, studentId, status) => {
  const taskFlow = await TaskFlow.findOneAndUpdate(
    { taskId, studentId },
    { status },
    { new: true, upsert: true, runValidators: true }
  );

  return taskFlow;
};

export const getOrCreateTaskFlows = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");
  
  const stream = user.stream || "General";
  
  let tasks = await Task.find({ stream: new RegExp(stream, "i") }).sort({ order: 1 });
  if (tasks.length === 0) {
    tasks = await Task.find({ stream: new RegExp("General", "i") }).sort({ order: 1 });
  }
  
  if (tasks.length === 0) return [];
  
  let existingFlows = await TaskFlow.find({ studentId: userId }).populate("taskId");
  
  if (existingFlows.length === 0) {
    const flowBulkOps = tasks.map((task, index) => {
      const isFirst = index === 0;
      const now = new Date();
      return {
        insertOne: {
          document: {
            taskId: task._id,
            studentId: userId,
            status: isFirst ? "in_progress" : "not_started",
            startedAt: isFirst ? now : null,
            expectedCompletionAt: isFirst ? new Date(now.getTime() + DEFAULT_TOPIC_DURATION_SECONDS * 1000) : null
          }
        }
      };
    });
    
    if (flowBulkOps.length > 0) {
      await TaskFlow.bulkWrite(flowBulkOps);
    }
    existingFlows = await TaskFlow.find({ studentId: userId }).populate("taskId");
  }
  
  return existingFlows.sort((a, b) => (a.taskId?.order || 0) - (b.taskId?.order || 0));
};

export const completeCurrentTask = async (userId) => {
  const flows = await getOrCreateTaskFlows(userId);
  const currentIndex = flows.findIndex(f => f.status === "in_progress");
  const now = new Date();
  
  if (currentIndex === -1) {
    const firstNotStarted = flows.findIndex(f => f.status === "not_started");
    if (firstNotStarted !== -1) {
       flows[firstNotStarted].status = "in_progress";
       flows[firstNotStarted].startedAt = now;
       flows[firstNotStarted].expectedCompletionAt = new Date(now.getTime() + DEFAULT_TOPIC_DURATION_SECONDS * 1000);
       await flows[firstNotStarted].save();
    }
    return flows;
  }
  
  const currentFlow = flows[currentIndex];
  currentFlow.status = "completed";
  currentFlow.completedAt = now;
  if (currentFlow.startedAt) {
    currentFlow.durationSeconds = Math.max(0, Math.round((now.getTime() - new Date(currentFlow.startedAt).getTime()) / 1000));
  }
  await currentFlow.save();
  
  if (currentIndex + 1 < flows.length) {
    const nextFlow = flows[currentIndex + 1];
    nextFlow.status = "in_progress";
    nextFlow.startedAt = now;
    nextFlow.expectedCompletionAt = new Date(now.getTime() + DEFAULT_TOPIC_DURATION_SECONDS * 1000);
    await nextFlow.save();
  }
  
  return await getOrCreateTaskFlows(userId);
};

export const initializeTasksFromStudyPlan = async (studyPlan) => {
  if (!studyPlan || !Array.isArray(studyPlan.weeks)) return;

  const stream = studyPlan.planName || "General";
  
  const lastTask = await Task.findOne().sort({ order: -1 });
  let currentOrder = lastTask ? lastTask.order + 1 : 1;

  for (const week of studyPlan.weeks) {
    const chapterTitle = String(week.title || `Week ${week.weekNumber || 1}`).trim();
    if (!Array.isArray(week.topics)) continue;
    
    for (const topicStr of week.topics) {
      const topic = String(topicStr || "").trim();
      if (!topic) continue;
      
      const exists = await Task.findOne({ stream, topic, chapterTitle });
      if (!exists) {
        await Task.create({
          stream,
          topic,
          chapterTitle,
          order: currentOrder++
        });
      }
    }
  }
};

export const generatePracticeQuestions = async (taskId, studentId, { openai, openAiModel }) => {
  if (!openai) throw new Error("AI service unavailable.");

  const task = await Task.findById(taskId);
  if (!task) throw new Error("Task not found.");

  let topicContent = "";
  const materialWithTopic = await StudyMaterial.findOne({
    "chapters.topics.title": task.topic
  });
  
  if (materialWithTopic && Array.isArray(materialWithTopic.chapters)) {
    for (const chapter of materialWithTopic.chapters) {
      if (Array.isArray(chapter.topics)) {
        const foundTopic = chapter.topics.find((t) => t.title === task.topic);
        if (foundTopic) {
          topicContent = foundTopic.content;
          break;
        }
      }
    }
  }

  const recentResults = await AssessmentResult.find({ userId: studentId })
    .sort({ createdAt: -1 })
    .limit(5);

  const mistakes = [];
  recentResults.forEach((res) => {
    if (Array.isArray(res.answers)) {
      res.answers.forEach((ans) => {
        if (ans.isCorrect === false && ans.question) {
          mistakes.push(ans.question);
        }
      });
    }
  });

  const uniqueMistakes = [...new Set(mistakes)];

  const systemPrompt = `Create 5 MCQ practice questions based on the topic. Return strict JSON format: {"questions":[{"id":"q1","question":"...","options":["...","...","...","..."],"correctAnswer":"..."}]}`;

  const userPrompt = `Topic: ${task.topic}
${topicContent ? `\nTopic Material Content:\n${topicContent}\n` : ""}
The student recently struggled with the following concepts or questions:
${uniqueMistakes.length > 0 ? uniqueMistakes.map((m) => "- " + m).join("\n") : "None specific."}

Please generate practice questions that test the topic material, with a strong emphasis on addressing the concepts the student struggled with.`;

  const completion = await openai.chat.completions.create({
    model: openAiModel || "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
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

  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return {
    topic: task.topic,
    questions,
  };
};

export const getChapterByIndex = async (userId, chapterIndex) => {
  const user = await User.findById(userId);
  const stream = user?.stream || "General";
  let tasks = await Task.find({ stream }).sort({ order: 1 });
  
  if (!tasks || tasks.length === 0) {
    tasks = await Task.find({ stream: "General" }).sort({ order: 1 });
  }
  
  const chaptersMap = new Map();
  for (const t of tasks) {
    const title = String(t.chapterTitle || "").trim();
    if (!chaptersMap.has(title)) {
      chaptersMap.set(title, { chapterTitle: title, topics: [] });
    }
    chaptersMap.get(title).topics.push(String(t.topic || "").trim());
  }
  
  const chapters = Array.from(chaptersMap.values());
  return chapters[chapterIndex];
};

export const generateChapterAssessment = async (userId, chapterIndex, { openai, openAiModel }) => {
  const chapter = await getChapterByIndex(userId, chapterIndex);
  if (!chapter) throw new Error(`Chapter at index ${chapterIndex} not found.`);

  const context = chapter.topics.join("\n");

  if (!openai) throw new Error("AI service unavailable.");

  const completion = await openai.chat.completions.create({
    model: openAiModel || "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `Create 10 MCQ questions based on the following study chapter topics. Return strict JSON: {"title":"...","questions":[{"id":"q1","question":"...","options":["...","...","...","..."],"correctAnswer":"..."}]}`,
      },
      {
        role: "user",
        content: `Chapter Title: ${chapter.chapterTitle}\n\nTopics to cover:\n${context}`,
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

  const questions = parsed?.questions || [];
  return {
    title: String(parsed?.title || `Assessment: ${chapter.chapterTitle}`),
    questions,
  };
};

export const saveChapterAssessment = async (userId, chapterIndex, userAnswers) => {
  let score = 0;
  const processedAnswers = [];
  
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
  };
  const existing = await AssessmentResult.findOne(query);
  if (existing) {
    existing.score = score;
    existing.answers = processedAnswers;
    existing.attempts = (existing.attempts || 1) + 1;
    await existing.save();
    return existing;
  }

  const newResult = await AssessmentResult.create({
    userId,
    chapterIndex,
    score,
    totalQuestions: processedAnswers.length || 10,
    answers: processedAnswers,
    attempts: 1
  });

  return newResult;
};

export const fetchAssessmentStatuses = async (userId) => {
  const results = await AssessmentResult.find({ userId }).lean();
  return results.map((r) => ({
    chapterIndex: r.chapterIndex,
    score: r.score || 0,
    totalQuestions: r.totalQuestions || 10,
    attempts: r.attempts || 1,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
  }));
};

export const getChapterAssessmentMistakes = async (userId, chapterIndex) => {
  const latestResult = await AssessmentResult.findOne({ userId, chapterIndex }).sort({ updatedAt: -1 }).lean();
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
  };
};
