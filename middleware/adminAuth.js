const jwt = require("jsonwebtoken");
const Admin = require("../Models/admin.model");

const ALLOWED_ADMIN_ROLES = ["admin", "superadmin"];

class AdminAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Loads the current admin from the database and applies all account/session checks.
// Role is always read from the database, never from the token.
const loadActiveAdmin = async (decoded) => {
  if (!decoded || !decoded.id) {
    throw new AdminAuthError(401, "Invalid or expired token");
  }

  const doc = await Admin.findById(decoded.id);

  if (!doc) {
    throw new AdminAuthError(401, "Admin account no longer exists");
  }

  if (doc.status === "blocked") {
    throw new AdminAuthError(401, "Admin account is blocked");
  }

  if (doc.isActive === false || doc.status === "inactive") {
    throw new AdminAuthError(401, "Admin account is inactive");
  }

  if ((decoded.version ?? 0) !== (doc.tokenVersion ?? 0)) {
    throw new AdminAuthError(401, "Session revoked, please sign in again");
  }

  if (!ALLOWED_ADMIN_ROLES.includes(doc.role)) {
    throw new AdminAuthError(403, "Admin access required");
  }

  return doc;
};

const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        message: "Invalid or expired token",
      });
    }

    let doc;
    try {
      doc = await loadActiveAdmin(decoded);
    } catch (err) {
      if (err instanceof AdminAuthError) {
        return res.status(err.status).json({ message: err.message });
      }
      return res.status(500).json({
        message: "Server error",
      });
    }

    req.admin = {
      id: String(doc._id),
      _id: doc._id,
      email: doc.email,
      username: doc.username,
      role: doc.role,
      status: doc.status,
      tokenVersion: doc.tokenVersion,
    };
    req.adminDoc = doc;

    return next();
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};

const verifySuperAdmin = (req, res, next) => {
  return verifyAdmin(req, res, (err) => {
    if (err) {
      return next(err);
    }

    if (!req.admin || req.admin.role !== "superadmin") {
      return res.status(403).json({
        message: "Super Admin access required",
        code: "SUPER_ADMIN_REQUIRED",
      });
    }

    return next();
  });
};

module.exports = { verifyAdmin, verifySuperAdmin, loadActiveAdmin };
