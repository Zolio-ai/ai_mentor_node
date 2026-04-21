import { getAllStudyPlans, getAllStudyMaterials, getStudyMaterialById } from "../services/studyService.mjs";

/**
 * Controller for handling study-related requests.
 */
export const createStudyController = () => {
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

  return { getStudyPlans, getStudyMaterials, downloadStudyMaterial };
};
