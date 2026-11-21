const crypto = require("crypto");

const ADMIN_ROLES = ["admin", "superadmin"];
const ADMIN_STATUSES = ["active", "inactive", "blocked"];

// Constant-time secret comparison using equal-length SHA-256 digests.
const safeEqualSecret = (provided, expected) => {
  if (
    typeof provided !== "string" ||
    typeof expected !== "string" ||
    provided.length === 0 ||
    expected.length === 0
  ) {
    return false;
  }

  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();

  return crypto.timingSafeEqual(providedHash, expectedHash);
};

const isSuperAdminRole = (role) => {
  if (typeof role !== "string") return false;

  const normalized = role.trim().toLowerCase();

  return normalized === "superadmin" || normalized === "super_admin";
};

const stringifyId = (value) => {
  if (value === null || value === undefined) return value;

  return String(value);
};

const ADMIN_PUBLIC_FIELDS = [
  "_id",
  "username",
  "email",
  "role",
  "status",
  "isActive",
  "createdAt",
  "updatedAt",
  "blockedAt",
  "blockedBy",
  "blockedReason",
  "deactivatedAt",
  "deactivatedBy",
  "statusUpdatedAt",
  "statusUpdatedBy",
];

const ADMIN_ID_FIELDS = ["_id", "blockedBy", "deactivatedBy", "statusUpdatedBy"];

// Whitelist-only projection: password/hash can never leak through this helper.
const sanitizeAdmin = (doc) => {
  if (!doc) return null;

  const source = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const result = {};

  ADMIN_PUBLIC_FIELDS.forEach((field) => {
    if (source[field] === undefined) return;

    result[field] = ADMIN_ID_FIELDS.includes(field)
      ? stringifyId(source[field])
      : source[field];
  });

  return result;
};

const parsePagination = (query = {}) => {
  const parsedPage = Number.parseInt(query.page, 10);
  const parsedLimit = Number.parseInt(query.limit, 10);

  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit >= 1
      ? Math.min(parsedLimit, 100)
      : 10;

  return { page, limit, skip: (page - 1) * limit };
};

module.exports = {
  ADMIN_ROLES,
  ADMIN_STATUSES,
  safeEqualSecret,
  isSuperAdminRole,
  sanitizeAdmin,
  parsePagination,
};
