import express from "express";
import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getAssignmentSubmissions,
  getAssignments,
  getAssignmentById,
  submitAssignment,
  updateSubmissionVisibility,
} from "../controllers/assignmentController.mjs";

export function registerAssignmentRoutes(app, { verifyHttpAuth, verifyTeacherAuth }) {
  const router = express.Router();

  // ==========================
  // TEACHER ONLY ROUTES
  // ==========================
  router.post("/", verifyTeacherAuth, createAssignment);
  router.put("/:id", verifyTeacherAuth, updateAssignment);
  router.delete("/:id", verifyTeacherAuth, deleteAssignment);
  router.get("/:id/submissions", verifyTeacherAuth, getAssignmentSubmissions);

  // ==========================
  // SHARED ROUTES
  // ==========================
  router.get("/", verifyHttpAuth, getAssignments);
  router.get("/:id", verifyHttpAuth, getAssignmentById);

  // ==========================
  // STUDENT ROUTES
  // ==========================
  router.post("/:id/submissions", verifyHttpAuth, submitAssignment);
  router.patch("/:id/submissions/:submissionId/visibility", verifyHttpAuth, updateSubmissionVisibility);

  app.use("/api/assignments", router);
}
