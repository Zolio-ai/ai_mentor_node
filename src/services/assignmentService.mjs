import { Assignment, AssignmentSubmission } from "../models/index.mjs";

export const assignmentService = {
  // Teacher: Create Assignment
  createAssignment: async ({ title, description, dueDate, studyPlanId, weekNumber }) => {
    if (!title || !description || !studyPlanId || weekNumber == null) {
      throw new Error("Missing required fields");
    }
    return await Assignment.create({ title, description, dueDate, studyPlanId, weekNumber });
  },

  // Teacher: Update Assignment
  updateAssignment: async (id, updateData) => {
    const assignment = await Assignment.findByIdAndUpdate(id, updateData, { new: true });
    if (!assignment) throw new Error("Assignment not found");
    return assignment;
  },

  // Teacher: Delete Assignment
  deleteAssignment: async (id) => {
    const submissionCount = await AssignmentSubmission.countDocuments({ assignmentId: id });
    if (submissionCount > 0) {
      throw new Error("Cannot delete assignment with active student submissions.");
    }
    const assignment = await Assignment.findByIdAndDelete(id);
    if (!assignment) throw new Error("Assignment not found");
    return assignment;
  },

  // Teacher: Get Submissions
  getAssignmentSubmissions: async (id) => {
    return await AssignmentSubmission.find({ assignmentId: id }).populate("studentId", "name email");
  },

  // Shared: Get Assignments
  getAssignments: async ({ studyPlanId, weekNumber }) => {
    const filter = {};
    if (studyPlanId) filter.studyPlanId = studyPlanId;
    if (weekNumber) filter.weekNumber = Number(weekNumber);
    return await Assignment.find(filter).sort({ createdAt: -1 });
  },

  // Shared: Get single Assignment
  getAssignmentById: async (id) => {
    const assignment = await Assignment.findById(id);
    if (!assignment) throw new Error("Assignment not found");
    return assignment;
  },

  // Student: Submit Assignment
  submitAssignment: async (assignmentId, studentId, content) => {
    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) throw new Error("Assignment not found");

    let submission = await AssignmentSubmission.findOne({ assignmentId, studentId });

    if (submission) {
      if (submission.status === "submitted" || submission.status === "graded") {
        throw new Error("Assignment already submitted. You cannot edit it or submit again.");
      }
      submission.content = content !== undefined ? content : submission.content;
      await submission.save();
    } else {
      submission = await AssignmentSubmission.create({
        assignmentId,
        studentId,
        content,
        status: "pending",
        teacherVisibility: false,
        grade: 0
      });
    }
    return submission;
  },

  // Student: Update Visibility
  updateSubmissionVisibility: async (assignmentId, submissionId, studentId) => {
    const submission = await AssignmentSubmission.findOne({ _id: submissionId, assignmentId, studentId });
    if (!submission) throw new Error("Submission not found");

    if (submission.status === "submitted" || submission.status === "graded") {
      throw new Error("This submission is already finalized.");
    }

    submission.status = "submitted";
    submission.teacherVisibility = true;
    await submission.save();
    return submission;
  }
};
