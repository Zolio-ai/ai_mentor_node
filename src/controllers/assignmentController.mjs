import { assignmentService } from "../services/assignmentService.mjs";

// Teachers only method

export const createAssignment = async (req, res) => {
  try {
    const assignment = await assignmentService.createAssignment(req.body);
    res.status(201).json({ message: "Assignment created", assignment });
  } catch (error) {
    const status = error.message.includes("Missing") ? 400 : 500;
    res.status(status).json({ message: "Error creating assignment", error: error.message });
  }
};

export const updateAssignment = async (req, res) => {
  try {
    const assignment = await assignmentService.updateAssignment(req.params.id, req.body);
    res.json({ message: "Assignment updated", assignment });
  } catch (error) {
    const status = error.message.includes("not found") ? 404 : 500;
    res.status(status).json({ message: "Error updating assignment", error: error.message });
  }
};

export const deleteAssignment = async (req, res) => {
  try {
    await assignmentService.deleteAssignment(req.params.id);
    res.json({ message: "Assignment deleted" });
  } catch (error) {
    const status = error.message.includes("Cannot delete") ? 400 : (error.message.includes("not found") ? 404 : 500);
    res.status(status).json({ message: "Error deleting assignment", error: error.message });
  }
};

export const getAssignmentSubmissions = async (req, res) => {
  try {
    const submissions = await assignmentService.getAssignmentSubmissions(req.params.id);
    res.json({ submissions });
  } catch (error) {
    res.status(500).json({ message: "Error fetching submissions", error: error.message });
  }
};

// Shared Methods

export const getAssignments = async (req, res) => {
  try {
    const assignments = await assignmentService.getAssignments(req.query);
    res.json({ assignments });
  } catch (error) {
    res.status(500).json({ message: "Error fetching assignments", error: error.message });
  }
};

export const getAssignmentById = async (req, res) => {
  try {
    const assignment = await assignmentService.getAssignmentById(req.params.id);
    res.json({ assignment });
  } catch (error) {
    const status = error.message.includes("not found") ? 404 : 500;
    res.status(status).json({ message: "Error fetching assignment", error: error.message });
  }
};

// Student only method

export const submitAssignment = async (req, res) => {
  try {
    const studentId = req.user.sub || req.user.id;
    const submission = await assignmentService.submitAssignment(req.params.id, studentId, req.body.content);
    res.json({ message: "Submission saved as draft", submission });
  } catch (error) {
    const status = error.message.includes("not found") ? 404 : (error.message.includes("already submitted") ? 403 : 500);
    res.status(status).json({ message: "Error submitting assignment", error: error.message });
  }
};

export const updateSubmissionVisibility = async (req, res) => {
  try {
    const studentId = req.user.sub || req.user.id;
    const submission = await assignmentService.updateSubmissionVisibility(req.params.id, req.params.submissionId, studentId);
    res.json({ message: "Submission finalized successfully!", submission });
  } catch (error) {
    const status = error.message.includes("not found") ? 404 : (error.message.includes("already finalized") ? 403 : 500);
    res.status(status).json({ message: "Error finalizing submission", error: error.message });
  }
};
