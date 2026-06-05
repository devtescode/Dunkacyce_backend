const Admin = require("../Models/admin.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../Models/user.models");
const Order = require("../Models/models/order.model");

// =========================
// CHECK IF ADMIN EXISTS
// =========================
module.exports.adminExists = async (req, res) => {
  try {
    const admin = await Admin.findOne();

    return res.json({
      exists: !!admin,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};

// =========================
// REGISTER ADMIN
// =========================
module.exports.registerAdmin = async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const existing = await Admin.findOne({ email });

    if (existing) {
      return res.status(400).json({
        message: "Admin already exists",
      });
    }

    const admin = await Admin.create({
      email,
      username,
      password,
    });

    return res.status(201).json({
      message: "Admin created successfully",
      admin,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};

// =========================
// LOGIN ADMIN
// =========================
module.exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        id: admin._id,
        role: "admin",
        email: admin.email,
      },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: "1hr" }
    );

    return res.json({
      message: "Login successful",
      token,
      admin,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};

module.exports.dashboardstats = async (req, res) => {
  try {
    // -----------------------
    // DATE RANGE (this week)
    // -----------------------
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday start
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date();
    endOfWeek.setHours(23, 59, 59, 999);

    // -----------------------
    // TOTAL USERS
    // -----------------------
    const totalStudents = await User.countDocuments();

    // -----------------------
    // TOTAL ORDERS
    // -----------------------
    const totalOrders = await Order.countDocuments();

    // -----------------------
    // WEEKLY REVENUE
    // (ONLY PAID ORDERS)
    // -----------------------
    const paidOrders = await Order.find({
      paymentStatus: "Paid",
      createdAt: { $gte: startOfWeek, $lte: endOfWeek },
    });

    const weeklyRevenue = paidOrders.reduce(
      (sum, order) => sum + (order.total || 0),
      0
    );

    res.json({
      totalStudents,
      totalOrders,
      weeklyRevenue,
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
}