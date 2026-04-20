import { buildAttendanceInsights } from "./attendanceInsights.mjs";

function createHttpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

export function createAttendanceService(deps) {
  const { CameraAttendance, CandidateInvitation, internalApiKey } = deps;

  const cameraAttendance = async (user, payload) => {
    const {
      status = "checking",
      note = "",
      cameraOn = false,
      avatarReady = false,
      personDetected = false,
      roomName = null,
      clientTs = null,
    } = payload || {};

    const allowedStatuses = new Set(["present", "away", "checking", "error"]);
    const safeStatus = allowedStatuses.has(status) ? status : "checking";
    const safeNote = typeof note === "string" ? note.slice(0, 240) : "";
    const safeRoomName = typeof roomName === "string" ? roomName : null;
    const safeClientTs = clientTs ? new Date(clientTs) : null;
    const email = String(user?.email || "")
      .trim()
      .toLowerCase();
    if (!email) throw createHttpError(400, "User email missing in token.");

    await CameraAttendance.deleteMany({ email, userId: { $ne: user?.sub } });
    await CameraAttendance.updateOne(
      { email },
      {
        $set: {
          userId: user?.sub,
          email,
          roomName: safeRoomName,
          status: safeStatus,
          note: safeNote,
          cameraOn: Boolean(cameraOn),
          avatarReady: Boolean(avatarReady),
          personDetected: Boolean(personDetected),
          clientTs: safeClientTs,
        },
        $push: {
          samples: {
            $each: [
              {
                at: safeClientTs || new Date(),
                status: safeStatus,
                note: safeNote,
                cameraOn: Boolean(cameraOn),
                avatarReady: Boolean(avatarReady),
                personDetected: Boolean(personDetected),
              },
            ],
            $slice: -500,
          },
        },
      },
      { upsert: true },
    );
    return { ok: true };
  };

  const latestCameraAttendance = async (query) => {
    const parsedLimit = Number(query?.limit || 50);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

    const records = await CameraAttendance.find({}).sort({ updatedAt: -1 }).limit(limit).lean();
    const inviteRecords = await CandidateInvitation.find({}, { email: 1, candidateName: 1 }).lean();
    const nameByEmail = new Map(
      inviteRecords
        .filter((row) => row?.email)
        .map((row) => [String(row.email).toLowerCase(), String(row.candidateName || "").trim()]),
    );

    const enrichedRecords = records.map((record) => ({
      ...record,
      candidateName: nameByEmail.get(String(record.email || "").toLowerCase()) || "",
      insights: buildAttendanceInsights(record),
    }));

    return { count: enrichedRecords.length, records: enrichedRecords };
  };

  const markCompletion = async (user) => {
    const email = String(user?.email || "")
      .trim()
      .toLowerCase();
    if (!email) throw createHttpError(400, "User email missing in token.");

    await CandidateInvitation.updateOne(
      { email },
      {
        $set: {
          email,
          trainingCompleted: true,
          completedAt: new Date(),
          lastInvitedAt: new Date(),
        },
        $setOnInsert: {
          invitedBy: "system:auto",
          firstInvitedAt: new Date(),
          inviteCount: 1,
        },
      },
      { upsert: true },
    );
    return { ok: true, message: "Training marked as completed." };
  };

  const internalMarkCompletion = async (key, payload) => {
    if (!internalApiKey || String(key || "") !== internalApiKey) {
      throw createHttpError(401, "Unauthorized internal request.");
    }

    const userId = String(payload?.userId || "").trim();
    const isLastQuestion = Boolean(payload?.isLastQuestion);
    if (!userId) throw createHttpError(400, "userId is required.");
    if (!isLastQuestion) return { ok: true, markedCompleted: false };

    const attendance = await CameraAttendance.findOne({ userId }).lean();
    const email = String(attendance?.email || "")
      .trim()
      .toLowerCase();
    if (!email) throw createHttpError(404, "No email found for user.", { markedCompleted: false });

    await CandidateInvitation.updateOne(
      { email },
      {
        $set: {
          email,
          trainingCompleted: true,
          completedAt: new Date(),
          lastInvitedAt: new Date(),
        },
        $setOnInsert: {
          invitedBy: "system:auto",
          firstInvitedAt: new Date(),
          inviteCount: 1,
        },
      },
      { upsert: true },
    );
    return { ok: true, markedCompleted: true, email };
  };

  return {
    cameraAttendance,
    latestCameraAttendance,
    markCompletion,
    internalMarkCompletion,
  };
}
