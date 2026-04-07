const jwt = require('jsonwebtoken');
const Student = require('../models/student');

exports.protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ 
                success: false, 
                message: "Authorization header missing or malformed",
                code: "AUTH_HEADER_ERROR"
            });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ success: false, message: "Token not provided" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verify it's a student route access
        if (decoded.userType !== "student") {
            return res.status(403).json({ 
                success: false, 
                message: "Access denied: Students only route",
                code: "ACCESS_DENIED"
            });
        }

        // Fetch student and attach to request
        const student = await Student.findById(decoded.id).select("-password");
        if (!student) {
            return res.status(401).json({ success: false, message: "Student account not found" });
        }

        req.user = student;
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token expired",
                code: "TOKEN_EXPIRED",
            });
        }
        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
                code: "INVALID_TOKEN",
            });
        }
        res.status(500).json({
            success: false,
            message: "Internal server error during authentication",
            code: "AUTH_ERROR",
        });
    }
};
