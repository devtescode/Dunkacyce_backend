const Admin = require("../Models/admin.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../Models/user.models");
const Order = require("../Models/models/order.model");
const Food = require("../Models/models/food.model");

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

    const paidFilter = { paymentStatus: "Paid" };
    const toDeliveryFilter = {
      paymentStatus: "Paid",
      status: { $ne: "Delivered" },
    };

    const [
      totalStudents,
      totalOrders,
      paidOrdersThisWeek,
      paidStudentIds,
      studentsToDeliveryIds,
      lowStockSwallows,
    ] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments(),
      Order.find({
        paymentStatus: "Paid",
        createdAt: { $gte: startOfWeek, $lte: endOfWeek },
      }),
      // Distinct students/users with at least one paid order (all-time)
      Order.distinct("userId", paidFilter),
      // Distinct students/users with at least one paid, not-yet-delivered order
      Order.distinct("userId", toDeliveryFilter),
      Food.find({ isSwallow: true, swallowQuantity: { $lt: 10 } })
        .select(
          "_id name swallowQuantity availableSoups status imageUrl category isSwallow"
        )
        .sort({ swallowQuantity: 1, name: 1 })
        .lean(),
    ]);

    // -----------------------
    // WEEKLY REVENUE
    // (ONLY PAID ORDERS)
    // -----------------------
    const weeklyRevenue = paidOrdersThisWeek.reduce(
      (sum, order) => sum + (order.total || 0),
      0
    );

    const paidStudents = Array.isArray(paidStudentIds)
      ? paidStudentIds.length
      : 0;
    const studentsToDelivery = Array.isArray(studentsToDeliveryIds)
      ? studentsToDeliveryIds.length
      : 0;
    const lowStockSwallowCount = Array.isArray(lowStockSwallows)
      ? lowStockSwallows.length
      : 0;

    res.json({
      totalStudents,
      totalOrders,
      weeklyRevenue,
      paidStudents,
      studentsToDelivery,
      lowStockSwallowCount,
      lowStockSwallows: Array.isArray(lowStockSwallows) ? lowStockSwallows : [],
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================
// GET ALL USERS (ADMIN)
// =========================
module.exports.getAllUsers = async (req, res) => {
  try {
    let users = await User.find()
      .select("email fullName phone balance gender profilePicture createdAt updatedAt")
      .lean()
      .sort({ createdAt: -1 });

    const paidOrderStats = await Order.aggregate([
      { $match: { paymentStatus: "Paid" } },
      {
        $group: {
          _id: "$userId",
          orderCount: { $sum: 1 },
          totalPaid: { $sum: "$total" },
        },
      },
    ]);

    const statsByUserId = new Map(
      paidOrderStats.map((stat) => [String(stat._id), stat])
    );

    users = users.map((user) => {
      const stats = statsByUserId.get(String(user._id));

      return {
        ...user,
        orderCount: stats ? stats.orderCount : 0,
        totalPaid: stats ? stats.totalPaid : 0,
      };
    });

    res.json({ users });
  } catch (err) {
    console.error("Get all users error:", err);
    res.status(500).json({ message: "Server error" });
  }
};