/**
 * AI Mentor interview-prep content.
 * Delivered conversationally: one section per turn with check-ins, not as a single monologue.
 */
export const AI_MENTOR_SECTIONS = [
  {
    title: "Welcome and session goals",
    body: `Hello and welcome to your AI Mentor session. I am here to help you prepare for interviews, improve confidence, and clear your doubts quickly. We will work step by step so you can explain your background clearly and answer questions with structure and confidence.`,
  },
  {
    title: "Target role alignment",
    body: `First, we align your preparation with your target role. We focus on job description keywords, required skills, and expected interview rounds. This helps you prioritize what to revise now and what can be skipped.`,
  },
  {
    title: "Resume storytelling",
    body: `Your resume should be a clear story, not just a list. For each major point, be ready to explain what you built, why you built it, what challenges you faced, and what measurable impact you achieved.`,
  },
  {
    title: "Project deep-dive method",
    body: `For project discussions, use a simple structure: context, your role, architecture choices, trade-offs, and outcomes. Interviewers value clarity, ownership, and reasoning more than memorized buzzwords.`,
  },
  {
    title: "Technical round strategy",
    body: `In technical rounds, think aloud. Clarify assumptions, break problems into smaller steps, discuss complexity, and validate with sample inputs. A clear approach is often more important than a perfect first answer.`,
  },
  {
    title: "Behavioral interview strategy",
    body: `For behavioral questions, use STAR: Situation, Task, Action, and Result. Keep examples specific and honest. Show collaboration, ownership, conflict handling, and learning from mistakes.`,
  },
  {
    title: "Communication and confidence",
    body: `Speak in short, complete points. If you do not know an answer, say it directly, share what you do know, and explain how you would find the rest. Calm and honest communication builds trust.`,
  },
  {
    title: "Final prep checklist",
    body: `Before interviews, revise core concepts, one strong project story, one challenge story, and one failure-to-learning story. Prepare smart questions for interviewers about team scope, success metrics, and growth expectations.`,
  },
  {
    title: "Doubts and personalized Q&A",
    body: `Now let us focus on your doubts. Ask anything about interview prep, resume, projects, technical concepts, communication, or confidence. I will answer with practical and concise guidance tailored to your profile.`,
  },
];

/** Full reference text (all sections joined). */
export const AI_MENTOR_SCRIPT = AI_MENTOR_SECTIONS.map((section) => section.body).join("\n\n");
