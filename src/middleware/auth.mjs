import jwt from "jsonwebtoken";

export function createAuthMiddleware(jwtSecret) {
  const verifyHttpAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: "Missing bearer token." });
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      if (payload?.role && !["candidate", "student", "teacher"].includes(payload.role)) {
        return res.status(403).json({ message: "Access denied. Valid role required." });
      }
      req.user = payload;
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid auth token." });
    }
  };

  const verifyAdminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: "Missing bearer token." });
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      if (payload?.role !== "admin") {
        return res.status(403).json({ message: "Admin access only." });
      }
      req.admin = payload;
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid admin token." });
    }
  };

  const verifyTeacherAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: "Missing teacher token." });
    }
    try {
      const payload = jwt.verify(token, jwtSecret); // We allow admin to do teacher actions too, just in case
      if (payload?.role !== "teacher" && payload?.role !== "admin") {
        return res.status(403).json({ message: "Teacher access only."});
      }
      req.teacher = payload;
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid teacher token." });
    }
  };

  return { verifyHttpAuth, verifyAdminAuth, verifyTeacherAuth };
}
