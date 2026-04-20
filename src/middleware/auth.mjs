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
      if (payload?.role && payload.role !== "candidate") {
        return res.status(403).json({ message: "Candidate access only." });
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

  return { verifyHttpAuth, verifyAdminAuth };
}
