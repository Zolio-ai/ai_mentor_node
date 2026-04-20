import { createAuthService } from "../services/authService.mjs";

export function createAuthController(deps) {
  const service = createAuthService(deps);
  const sendError = (res, error, fallback) =>
    res.status(Number(error?.status) || 500).json({ ...(error?.payload || {}), message: error?.message || fallback });

  const register = async (req, res) => {
    try {
      const data = await service.register(req.body);
      return res.status(201).json({
        success: true,
        message: "Registration successful.",
        data,
      });
    } catch (error) {
      return sendError(res, error, "Failed to register user.");
    }
  };

  const login = async (req, res) => {
    try {
      return res.json({ success: true, data: await service.login(req.body) });
    } catch (error) {
      return sendError(res, error, "Login failed.");
    }
  };

  const profile = async (req, res) => {
    try {
      return res.json({ success: true, data: await service.profile(req.user.sub) });
    } catch (error) {
      return sendError(res, error, "Failed to fetch profile.");
    }
  };

  const onboarding = async (req, res) => {
    try {
      const data = await service.onboarding(req.user.sub, req.body);
      return res.json({
        success: true,
        message: "Onboarding saved.",
        data,
      });
    } catch (error) {
      return sendError(res, error, "Failed to save onboarding.");
    }
  };

  const profileData = async (req, res) => {
    try {
      return res.json({ success: true, data: await service.profile(req.user.sub) });
    } catch (error) {
      return sendError(res, error, "Failed to fetch profile data.");
    }
  };

  const internalCandidateProfile = async (req, res) => {
    try {
      return res.json({
        ok: true,
        profile: await service.internalCandidateProfile(req.headers["x-internal-key"], req.params?.userId),
      });
    } catch (error) {
      return sendError(res, error, "Failed to fetch internal profile.");
    }
  };

  const adminLogin = async (req, res) => {
    try {
      return res.json(await service.adminLogin(req.body));
    } catch (error) {
      return sendError(res, error, "Invalid admin credentials.");
    }
  };

  const createInvitation = async (req, res) => {
    try {
      return res.json(await service.createInvitation(req.body, req.user?.email || "admin"));
    } catch (error) {
      return sendError(res, error, "Failed to send invitation email.");
    }
  };

  const invitedCandidates = async (req, res) => {
    try {
      return res.json(await service.invitedCandidates());
    } catch (error) {
      return sendError(res, error, "Failed to load invited candidates.");
    }
  };

  const aiRespond = (req, res) => {
    try {
      return res.json(service.aiRespond(req.body));
    } catch (error) {
      return sendError(res, error, "message is required.");
    }
  };

  const aiEndIntent = async (req, res) => {
    try {
      return res.json(await service.aiEndIntent(req.body));
    } catch (error) {
      return sendError(res, error, "Failed to classify end intent.");
    }
  };

  const internalTrainingEndIntent = async (req, res) => {
    try {
      return res.json(await service.internalTrainingEndIntent(req.headers["x-internal-key"], req.body));
    } catch (error) {
      return sendError(res, error, "Failed to evaluate end intent.");
    }
  };

  return {
    register,
    login,
    profile,
    onboarding,
    profileData,
    internalCandidateProfile,
    adminLogin,
    createInvitation,
    invitedCandidates,
    aiRespond,
    aiEndIntent,
    internalTrainingEndIntent,
  };
}
