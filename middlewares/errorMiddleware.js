const logger = require('../utils/logger');

// Error message handler
const errorHandler = (err, req, res, next) => {
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    
    logger.error({
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    }, 'Unhandled error occurred');

    res.status(statusCode).json({
        success: false,
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};

// Async handler to catch errors and pass to errorHandler
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };
