const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
require("dotenv").config();
const cors = require("cors");

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

// models
const Admin = require("./Models/admin.model");

// routes
const userRoutes = require("./Routes/user.routes");
const adminRoutes = require("./Routes/user.adminRoutes");
const foodRoutes = require("./Routes/food.routes");
const cartRoutes = require("./Routes/cart.routes");
const settingRoutes = require("./Routes/settings.routes");
const superadminRoutes = require("./Routes/superadmin.routes");
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

io.use(async (socket, next) => {
  try {
    const authToken = socket.handshake.auth?.token;
    const header = socket.handshake.headers?.authorization;
    let token = authToken;

    if (!token && typeof header === "string" && header.startsWith("Bearer ")) {
      token = header.split(" ")[1];
    }

    if (!token) {
      return next();
    }

    // Try admin auth first. A valid signature alone is not enough: the admin
    // must still exist, be active, and the token version must still match.
    try {
      const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
      const tokenRole = decoded?.role;

      if (tokenRole === "admin" || tokenRole === "superadmin") {
        const adminDoc = await Admin.findById(decoded.id).select(
          "role status isActive tokenVersion"
        );

        const dbRole = adminDoc?.role;
        const isAdminRole = dbRole === "admin" || dbRole === "superadmin";
        const isActive =
          adminDoc?.status === "active" && adminDoc?.isActive !== false;
        const versionMatches =
          (decoded.version ?? 0) === (adminDoc?.tokenVersion ?? 0);

        if (isAdminRole && isActive && versionMatches) {
          socket.data.user = decoded;
          socket.data.role = dbRole;
          socket.join("admins");
          return next();
        }
      }
      // Invalid/stale/blocked admin session; fall through to user token below.
    } catch (_) {
      // Not a valid admin token; try user token below.
    }

    // Optional user auth: join user room, but never block connection.
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.user = decoded;
      socket.data.role = decoded.role || "user";
      if (decoded?.id) {
        socket.join(`user:${decoded.id}`);
      }
      return next();
    } catch (_) {
      // Invalid/unknown token; allow connection for existing realtime clients.
    }

    return next();
  } catch (err) {
    console.error("Socket auth middleware error:", err.message);
    return next();
  }
});

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
app.use("/api/superadmin", superadminRoutes);

/* ================= HOME ================= */
app.get("/", (req, res) => {
  res.status(200).json({ message: "Welcome to Dunnkayce Backend" });
});

/* ================= DB ================= */
mongoose
  .connect(URI)
  .then(() => {
    console.log("✅ Database connected");
    require("./Models/admin.model")
      .ensureAdminSchemaReady()
      .catch((err) => console.error("Admin schema init error:", err.message));
  })
  .catch((err) => console.error("❌ DB error:", err));

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  const isMulterError =
    err?.name === "MulterError" ||
    (typeof err?.code === "string" && err.code.startsWith("LIMIT_"));

  if (isMulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ message: "Image too large. Maximum size is 5MB" });
    }

    return res
      .status(400)
      .json({ message: err.message || "Invalid upload" });
  }

  if (
    typeof err?.message === "string" &&
    err.message.includes("Invalid file type")
  ) {
    return res.status(400).json({ message: err.message });
  }

  console.error(err);
  return res
    .status(500)
    .json({ message: err.message || "Internal Server Error" });
});

/* ================= START SERVER ================= */
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});