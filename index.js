require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const logger = require('./utils/logger');
const { errorHandler } = require('./middlewares/errorMiddleware');

// Check for required environment variables
if (!process.env.JWT_SECRET) {
    logger.error('FATAL ERROR: JWT_SECRET is not defined.');
    process.exit(1);
}

const http = require('http');
const { Server } = require('socket.io');

// Initialize app and connect to Database
const connectDB = require('./config/db');
connectDB();

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    logger.info(`New client connected: ${socket.id}`);
    
    // Join a user-specific room if provided in auth
    const userId = socket.handshake.auth?.userId;
    if (userId) {
        const roomId = `room-${userId}`;
        socket.join(roomId);
        logger.info(`Socket ${socket.id} joined room: ${roomId}`);
    }

    // Handle chat messages and relay them back to the room
    socket.on('chat:message', (data) => {
        logger.debug({ socketId: socket.id, data }, 'Received chat:message');
        
        const relayMsg = {
            id: `msg-${Date.now()}`,
            from: userId || 'anonymous',
            text: data.text,
            timestamp: new Date().toISOString()
        };

        // Broadcast to everyone in the room (including the sender for synchronization if UI needs it)
        // Note: ChatPanel.jsx emits and then locally adds it if using LiveKit, 
        // but here we ensure the socket bridge is active.
        if (data.roomId) {
            io.to(data.roomId).emit('chat:message', relayMsg);
        } else if (userId) {
            io.to(`room-${userId}`).emit('chat:message', relayMsg);
        }
    });

    socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
    });
});


// Middleware
app.use(express.json()); // Allows parsing of JSON data in req.body
app.use(cors());
app.use(pinoHttp({ logger }));

// Import Routes
const authRoutes = require('./routes/authRoutes');
const dataRoutes = require('./routes/dataRoutes');
const assessmentRoutes = require('./routes/assessmentRoutes');


// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/assessment', assessmentRoutes);


// Error Middleware
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
    logger.info(`AI Mentor Server is running on port ${PORT}`);
});

