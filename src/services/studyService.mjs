import { StudyPlan, StudyMaterial } from "../models/index.mjs";

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
