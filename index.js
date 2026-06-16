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

/* ================= SOCKET.IO ================= */
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://dunnkayce-navy.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
  path: "/socket.io",
  transports: ["websocket", "polling"],
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

/* ================= CORS (SINGLE SOURCE OF TRUTH) ================= */
const allowedOrigins = [
  "http://localhost:5173",
  "https://dunnkayce-navy.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow server-to-server / webhook

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ✅ IMPORTANT: preflight handling */
app.options(/.*/, cors());

/* ================= BODY PARSER ================= */
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

/* ================= DB ================= */
mongoose
  .connect(URI)
  .then(() => console.log("✅ Database connected"))
  .catch((err) => console.error("❌ DB error:", err));

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ message: "Internal Server Error" });
});

/* ================= START SERVER ================= */
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});