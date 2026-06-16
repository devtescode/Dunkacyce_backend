const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
require("dotenv").config();
const cors = require("cors");

const { Server } = require("socket.io");

// routes
const userRoutes = require("./Routes/user.routes");
const adminRoutes = require("./Routes/user.adminRoutes");
const foodRoutes = require("./Routes/food.routes");
const cartRoutes = require("./Routes/cart.routes");
const settingRoutes = require("./Routes/settings.routes");
const paystackroute = require("./Controllers/paystackWebhook");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const URI = process.env.URI;

/* ================= SOCKET.IO SETUP ================= */
// const io = new Server(server, {
//   cors: {
//     origin: "http://localhost:5173", // 👈 IMPORTANT
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "DELETE"],
//   },
// });

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://dunnkayce-navy.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  path: "/socket.io",
  transports: ["websocket", "polling"],
});


// make io available everywhere (controllers)
app.set("io", io);

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

/* ================= MIDDLEWARE ================= */
// app.use(cors());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://dunnkayce-navy.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(express.json({ limit: "200mb" }));

/* ================= ROUTES ================= */
app.use("/food", foodRoutes);
app.use("/cart", cartRoutes);
app.use("/orders", require("./Routes/order.routes"));
app.use("/settings", settingRoutes);

app.use("/admin", adminRoutes);
app.use("/dunnkayce", userRoutes);

/* ================= PAYSTACK WEBHOOK ================= */
app.use(
  "/api/paystack",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    next();
  },
  paystackroute
);

/* ================= HOME ================= */
app.get("/", (req, res) => {
  res.status(200).json({ message: "Welcome to Dunnkayce Backend" });
});

/* ================= DB CONNECTION ================= */
mongoose
  .connect(URI)
  .then(() => {
    console.log("✅ Database connected successfully Dunnkayce Backend");
  })
  .catch((err) => {
    console.error("❌ Database connection error:", err);
  });

/* ================= GLOBAL ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(500).json({ message: "Internal Server Error" });
});

/* ================= START SERVER ================= */
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});