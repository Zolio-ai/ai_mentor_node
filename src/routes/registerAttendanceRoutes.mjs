import { buildAttendanceInsights } from "../services/attendanceInsights.mjs";

export function registerAttendanceRoutes(app, deps) {
  const { CameraAttendance, CandidateInvitation, verifyHttpAuth, verifyAdminAuth, internalApiKey } = deps;

  app.post("/attendance/camera", verifyHttpAuth, async (req, res) => {
    try {
      const {
        status = "checking",
        note = "",
        cameraOn = false,
        avatarReady = false,
        personDetected = false,
        roomName = null,
        clientTs = null,
      } = req.body || {};

      const allowedStatuses = new Set(["present", "away", "checking", "error"]);
      const safeStatus = allowedStatuses.has(status) ? status : "checking";
      const safeNote = typeof note === "string" ? note.slice(0, 240) : "";
      const safeRoomName = typeof roomName === "string" ? roomName : null;
      const safeClientTs = clientTs ? new Date(clientTs) : null;
      const email = String(req.user?.email || "")
        .trim()
        .toLowerCase();
      if (!email) {
        return res.status(400).json({ message: "User email missing in token." });
      }

      // Enforce single cameraAttendance doc per email.
      await CameraAttendance.deleteMany({
        email,
        userId: { $ne: req.user.sub },
      });

      await CameraAttendance.updateOne(
        { email },
        {
          $set: {
            userId: req.user.sub,
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

      return res.json({ ok: true });
    } catch (error) {
      return res
        .status(500)
        .json({ message: error.message || "Failed to persist camera attendance." });
    }
  });

  app.get("/attendance/camera/latest", verifyAdminAuth, async (req, res) => {
    try {
      const parsedLimit = Number(req.query.limit || 50);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 200)
        : 50;

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

      return res.json({
        count: enrichedRecords.length,
        records: enrichedRecords,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to load camera attendance." });
    }
  });

  app.post("/attendance/completion", verifyHttpAuth, async (req, res) => {
    try {
      const email = String(req.user?.email || "")
        .trim()
        .toLowerCase();
      if (!email) {
        return res.status(400).json({ message: "User email missing in token." });
      }

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

      return res.json({ ok: true, message: "Training marked as completed." });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to mark completion." });
    }
  });

  app.post("/internal/training/completion", async (req, res) => {
    try {
      const key = String(req.headers["x-internal-key"] || "");
      if (!internalApiKey || key !== internalApiKey) {
        return res.status(401).json({ message: "Unauthorized internal request." });
      }

      const userId = String(req.body?.userId || "").trim();
      const isLastQuestion = Boolean(req.body?.isLastQuestion);
      if (!userId) {
        return res.status(400).json({ message: "userId is required." });
      }
      if (!isLastQuestion) {
        return res.json({ ok: true, markedCompleted: false });
      }

      const attendance = await CameraAttendance.findOne({ userId }).lean();
      const email = String(attendance?.email || "")
        .trim()
        .toLowerCase();
      if (!email) {
        return res.status(404).json({ message: "No email found for user.", markedCompleted: false });
      }

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

      return res.json({ ok: true, markedCompleted: true, email });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to mark completion internally." });
    }
  });
}
