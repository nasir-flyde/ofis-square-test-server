// socket.js
import { Server } from "socket.io";

let io = null;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*", // Allow all origins for now; restrict in prod
    },
  });

  io.on("connection", (socket) => {
    console.log("Socket io connected:", socket.id);

    socket.on("register", ({ userId }) => {
      console.log(`✅ Registering user ${userId}`);
      socket.join(userId);
    });

    socket.on("disconnect", () => {
      console.log("❌ User disconnected:", socket.id);
    });
  });

  console.log("🟢 Socket.IO is ready and listening");
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};
