import { Task, TaskFlow, User, StudyProgress, AssessmentResult, StudyMaterial } from "../models/index.mjs";

/**
 * Updates the status of a task for a specific student (TaskFlow).
 * 
 * @param {string} taskId - The ID of the task to update.
 * @param {string} studentId - The ID of the student.
 * @param {string} status - The new status (not_started, in_progress, completed).
 * @returns {Promise<Object>} The updated TaskFlow object.
 */
export const updateTaskStatus = async (taskId, studentId, status) => {
  const taskFlow = await TaskFlow.findOneAndUpdate(
    { taskId, studentId },
    { status },
    { new: true, upsert: true, runValidators: true }
  );

  return taskFlow;
};

/**
 * Initializes tasks and taskflows from a StudyPlan.
 * Creates one global task per topic and one personal TaskFlow per student.
 * 
 * @param {Object} studyPlan - The StudyPlan object.
 */
export const initializeTasksFromStudyPlan = async (studyPlan) => {
  const topics = [];
  studyPlan.weeks.forEach(week => {
    week.topics.forEach(topicName => {
      topics.push({
        studyPlanId: studyPlan._id,
        topic: topicName,
        weekNumber: week.weekNumber
      });
    });
  });

  if (topics.length === 0) return;

  // 1. Initialize global Tasks
  const taskBulkOps = topics.map(item => ({
    updateOne: {
      filter: { studyPlanId: item.studyPlanId, topic: item.topic },
      update: { $setOnInsert: item },
      upsert: true
    }
  }));

  if (taskBulkOps.length > 0) {
    await Task.bulkWrite(taskBulkOps);
  }

  // 2. Fetch the newly created/existing tasks to get their IDs
  const tasks = await Task.find({ studyPlanId: studyPlan._id });
  const students = await User.find({ onboardingCompleted: true });

  if (tasks.length === 0 || students.length === 0) return;

  // 3. Initialize personal TaskFlows for all students
  const flowBulkOps = [];
  for (const student of students) {
    for (const task of tasks) {
      flowBulkOps.push({
        updateOne: {
          filter: { taskId: task._id, studentId: student._id },
          update: { $setOnInsert: { taskId: task._id, studentId: student._id, status: "not_started" } },
          upsert: true
        }
      });
    }
  }

  if (flowBulkOps.length > 0) {
    await TaskFlow.bulkWrite(flowBulkOps);
  }
};

/**
 * Initializes TaskFlow records for a new student based on all existing global tasks.
 * 
 * @param {string} studentId - The ID of the new student.
 */
export const initializeTaskFlowForNewUser = async (studentId) => {
  const tasks = await Task.find();
  if (tasks.length === 0) return;

  const flowBulkOps = tasks.map(task => ({
    updateOne: {
      filter: { taskId: task._id, studentId },
      update: { $setOnInsert: { taskId: task._id, studentId, status: "not_started" } },
      upsert: true
    }
  }));

  if (flowBulkOps.length > 0) {
    await TaskFlow.bulkWrite(flowBulkOps);
  }
};

/**
 * Generates practice questions for a topic, focusing on student's weak areas.
 * 
 * @param {string} taskId - The ID of the task (topic).
 * @param {string} studentId - The ID of the student.
 * @param {Object} dependencies - OpenAI dependencies.
 */
export const generatePracticeQuestions = async (taskId, studentId, { openai, openAiModel }) => {
  if (!openai) throw new Error("AI service unavailable.");

  const task = await Task.findById(taskId);
  if (!task) throw new Error("Task not found.");

  // Search across all study materials for the topic, supporting multiple subjects
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
