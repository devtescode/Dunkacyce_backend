const mongoose = require("mongoose");

const Admin = require("../Models/admin.model");
const {
  ADMIN_STATUSES,
  safeEqualSecret,
  sanitizeAdmin,
  parsePagination,
} = require("../utils/superadmin");

// =========================
// SHARED HELPERS
// =========================
const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isDuplicateKeyError = (err) =>
  !!err && (err.code === 11000 || err.code === 11001);

const isSuperAdminDoc = (admin) =>
  !!admin && (admin.role === "superadmin" || admin.role === "super_admin");

const isSelf = (req, id) => String(req.admin && req.admin.id) === String(id);

const actorId = (req) =>
  req.adminDoc && req.adminDoc._id ? req.adminDoc._id : req.admin && req.admin.id;

const statusMeta = (req) => ({
  statusUpdatedAt: new Date(),
  statusUpdatedBy: actorId(req),
});

// "inactive" also covers legacy docs whose isActive flag was never set.
const inactiveCondition = {
  $or: [{ status: "inactive" }, { isActive: false, status: { $ne: "blocked" } }],
};

const getTargetAdmin = async (
  req,
  res,
  selfMessage = "You cannot change your own account"
) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid admin id" });
    return null;
  }

  const target = await Admin.findById(id).lean();

  if (!target) {
    res.status(404).json({ message: "Admin not found" });
    return null;
  }

  if (isSelf(req, id)) {
    res.status(400).json({ message: selfMessage });
    return null;
  }

  if (isSuperAdminDoc(target)) {
    res.status(403).json({ message: "The Super Admin account cannot be modified" });
    return null;
  }

  return target;
};

// =========================
// PUBLIC STATUS
// =========================
module.exports.getSuperAdminStatus = async (req, res) => {
  try {
    const superAdminCount = await Admin.countDocuments({ role: "superadmin" });
    const activated = superAdminCount > 0;

    return res.status(200).json({
      exists: activated,
      hasSuperAdmin: activated,
      activated,
    });
  } catch (err) {
    console.error("Get super admin status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// CURRENT ADMIN CONTEXT
// =========================
module.exports.getSuperAdminMe = async (req, res) => {
  try {
    const role = req.admin && req.admin.role;

    return res.status(200).json({
      id: req.admin && req.admin.id,
      email: req.admin && req.admin.email,
      username: req.admin && req.admin.username,
      role,
      status: req.admin && req.admin.status,
      canManageAdmins: role === "superadmin",
    });
  } catch (err) {
    console.error("Get super admin me error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// ACTIVATE THE SUPER ADMIN
// =========================
module.exports.activateSuperAdmin = async (req, res) => {
  try {
    const activationKey = process.env.SUPER_ADMIN_ACTIVATION_KEY;

    if (!activationKey) {
      return res.status(503).json({
        message: "Super Admin activation is not configured",
      });
    }

    if (!req.body || !req.body.activationKey) {
      return res.status(400).json({ message: "Activation key is required" });
    }

    // Index creation / legacy migration happens once at server startup in
    // index.js. Re-running it here made activation fail (500) whenever the
    // index build was slow or the DB was briefly unreachable.

    if (!safeEqualSecret(req.body.activationKey, activationKey)) {
      return res.status(403).json({
        message: "Invalid activation key",
        code: "INVALID_ACTIVATION_KEY",
      });
    }

    const existingSuperAdmin = await Admin.countDocuments({ role: "superadmin" });

    if (existingSuperAdmin > 0) {
      return res.status(409).json({
        message: "A Super Admin has already been activated",
      });
    }

    const meta = statusMeta(req);
    const doc = await Admin.findOneAndUpdate(
      { _id: req.admin.id, role: "admin" },
      {
        $set: {
          role: "superadmin",
          status: "active",
          isActive: true,
          blockedAt: null,
          blockedBy: null,
          blockedReason: "",
          deactivatedAt: null,
          deactivatedBy: null,
          statusUpdatedAt: meta.statusUpdatedAt,
          statusUpdatedBy: meta.statusUpdatedBy,
        },
      },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(409).json({
        message: "A Super Admin has already been activated",
      });
    }

    // Deliberately do NOT bump tokenVersion here: the activating admin must keep
    // using their existing session. Session revocation applies when an account
    // is blocked, deactivated or deleted — not when it is promoted.
    return res.status(200).json({
      message: "Super Admin activated",
      admin: sanitizeAdmin(doc),
      tokenVersion: doc.tokenVersion,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        message: "A Super Admin has already been activated",
      });
    }

    console.error("Activate super admin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// LIST ADMINS
// =========================
module.exports.listAdmins = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim().toLowerCase()
        : "";

    const andConditions = [];

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      andConditions.push({ $or: [{ username: regex }, { email: regex }] });
    }

    if (status === "inactive") {
      andConditions.push(inactiveCondition);
    } else if (ADMIN_STATUSES.includes(status)) {
      andConditions.push({ status });
    }

    const filter = andConditions.length ? { $and: andConditions } : {};

    const [docs, total, active, inactive, blocked] = await Promise.all([
      Admin.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Admin.countDocuments({}),
      Admin.countDocuments({ status: "active" }),
      Admin.countDocuments(inactiveCondition),
      Admin.countDocuments({ status: "blocked" }),
    ]);

    return res.status(200).json({
      admins: docs.map(sanitizeAdmin),
      stats: { total, active, inactive, blocked },
      pagination: {
        page,
        limit,
        total,
        pages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    });
  } catch (err) {
    console.error("List admins error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// CREATE ADMIN
// =========================
module.exports.createAdmin = async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ message: "Invalid email address" });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const normalizedEmail = String(email).trim();
    const existing = await Admin.findOne({
      email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: "i" },
    });

    if (existing) {
      return res.status(409).json({
        message: "An admin with this email already exists",
      });
    }

    // Role and status are intentionally forced here; client input is ignored.
    const admin = await Admin.create({
      username: String(username).trim(),
      email: normalizedEmail,
      password,
      role: "admin",
      status: "active",
      isActive: true,
      tokenVersion: 0,
    });

    return res.status(201).json({
      message: "Admin account created",
      admin: sanitizeAdmin(admin),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        message: "An admin with this email already exists",
      });
    }

    console.error("Create admin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// SET ADMIN STATUS
// =========================
module.exports.setAdminStatus = async (req, res) => {
  try {
    const target = await getTargetAdmin(
      req,
      res,
      "You cannot change your own account status"
    );
    if (!target) return undefined;

    const body = req.body || {};
    let targetStatus;

    if (typeof body.status === "string") {
      const normalized = body.status.trim().toLowerCase();

      if (normalized === "active" || normalized === "inactive") {
        targetStatus = normalized;
      }
    }

    if (!targetStatus && typeof body.isActive === "boolean") {
      targetStatus = body.isActive ? "active" : "inactive";
    }

    if (!targetStatus) {
      return res.status(400).json({
        message: "A valid status or isActive value is required",
      });
    }

    const meta = statusMeta(req);
    const deactivated = targetStatus === "inactive";
    const doc = await Admin.findByIdAndUpdate(
      target._id,
      {
        $set: {
          status: targetStatus,
          isActive: !deactivated,
          deactivatedAt: deactivated ? meta.statusUpdatedAt : null,
          deactivatedBy: deactivated ? meta.statusUpdatedBy : null,
          statusUpdatedAt: meta.statusUpdatedAt,
          statusUpdatedBy: meta.statusUpdatedBy,
        },
        $inc: { tokenVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      message: "Admin status updated",
      admin: sanitizeAdmin(doc),
    });
  } catch (err) {
    console.error("Set admin status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// BLOCK ADMIN
// =========================
module.exports.blockAdmin = async (req, res) => {
  try {
    const target = await getTargetAdmin(req, res);
    if (!target) return undefined;

    const meta = statusMeta(req);
    const reason =
      req.body && req.body.reason ? String(req.body.reason).slice(0, 300) : "";

    const doc = await Admin.findByIdAndUpdate(
      target._id,
      {
        $set: {
          status: "blocked",
          isActive: false,
          blockedAt: meta.statusUpdatedAt,
          blockedBy: meta.statusUpdatedBy,
          blockedReason: reason,
          deactivatedAt: null,
          deactivatedBy: null,
          statusUpdatedAt: meta.statusUpdatedAt,
          statusUpdatedBy: meta.statusUpdatedBy,
        },
        $inc: { tokenVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      message: "Admin blocked",
      admin: sanitizeAdmin(doc),
    });
  } catch (err) {
    console.error("Block admin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// UNBLOCK ADMIN
// =========================
module.exports.unblockAdmin = async (req, res) => {
  try {
    const target = await getTargetAdmin(req, res);
    if (!target) return undefined;

    const meta = statusMeta(req);
    const doc = await Admin.findByIdAndUpdate(
      target._id,
      {
        $set: {
          status: "active",
          isActive: true,
          blockedAt: null,
          blockedBy: null,
          blockedReason: "",
          deactivatedAt: null,
          deactivatedBy: null,
          statusUpdatedAt: meta.statusUpdatedAt,
          statusUpdatedBy: meta.statusUpdatedBy,
        },
        $inc: { tokenVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      message: "Admin unblocked",
      admin: sanitizeAdmin(doc),
    });
  } catch (err) {
    console.error("Unblock admin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// =========================
// DELETE ADMIN
// =========================
module.exports.deleteAdmin = async (req, res) => {
  try {
    const target = await getTargetAdmin(req, res);
    if (!target) return undefined;

    await Admin.findByIdAndDelete(target._id);

    return res.status(200).json({ message: "Admin account deleted" });
  } catch (err) {
    console.error("Delete admin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
