const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

class SocketService {
  constructor() {
    this.onlineUsers = new Map(); // userId -> count of open sockets
  }

  init(server) {
    this.io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    // JWT Authentication Middleware for Socket Connection
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(" ")[1];
      if (!token) return next(new Error("Authentication error: No token provided"));

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "test_secret_key");
        socket.user = { ...decoded, id: decoded.userId || decoded.id };
        next();
      } catch (err) {
        return next(new Error("Authentication error: Invalid token"));
      }
    });

    this.io.on("connection", (socket) => {
      console.log(`⚡ WebSocket Connected: ${socket.id} (User: ${socket.user.id})`);

      // Join User-Specific Private Channel
      socket.join(`user:${socket.user.id}`);

      // Presence: mark this user online (first tab/device wins) and let
      // anyone with them in a conversation know.
      const wasOffline = !this.onlineUsers.get(socket.user.id);
      this.onlineUsers.set(socket.user.id, (this.onlineUsers.get(socket.user.id) || 0) + 1);
      if (wasOffline) {
        this.io.emit("presence", { userId: socket.user.id, online: true });
      }

      // Join Dispute Room
      socket.on("join_dispute_room", (disputeId) => {
        socket.join(`dispute:${disputeId}`);
      });

      // Join Live Order / Courier Tracking Room
      socket.on("join_order_tracking", (orderId) => {
        socket.join(`order:${orderId}`);
      });

      // Realtime Courier Location Stream
      socket.on("update_courier_location", ({ orderId, latitude, longitude }) => {
        this.io.to(`order:${orderId}`).emit("courier_location_updated", {
          orderId,
          coords: { latitude, longitude },
          timestamp: new Date(),
        });
      });

      // Chat: relay a "typing" signal to the other participant(s) of a
      // conversation. The client already knows who the other participants
      // are (from the conversation's participant list), so this is a plain
      // relay, no DB lookup needed.
      socket.on("typing", ({ conversationId, participantIds, isTyping }) => {
        (participantIds || [])
          .filter((id) => id !== socket.user.id)
          .forEach((id) => {
            this.io.to(`user:${id}`).emit("typing", {
              conversationId,
              userId: socket.user.id,
              isTyping: Boolean(isTyping),
            });
          });
      });

      socket.on("disconnect", () => {
        console.log(`🔌 WebSocket Disconnected: ${socket.id}`);
        const remaining = (this.onlineUsers.get(socket.user.id) || 1) - 1;
        if (remaining <= 0) {
          this.onlineUsers.delete(socket.user.id);
          this.io.emit("presence", { userId: socket.user.id, online: false });
        } else {
          this.onlineUsers.set(socket.user.id, remaining);
        }
      });
    });
  }

  isOnline(userId) {
    return this.onlineUsers.has(userId);
  }

  // Helper to emit events to specific rooms from controllers/services
  emitToRoom(room, event, data) {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }
}

module.exports = new SocketService();