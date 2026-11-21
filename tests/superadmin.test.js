const test = require("node:test");
const assert = require("node:assert/strict");

const {
  safeEqualSecret,
  isSuperAdminRole,
  sanitizeAdmin,
  parsePagination,
  ADMIN_ROLES,
  ADMIN_STATUSES,
} = require("../utils/superadmin");

test("role and status constants use the canonical values", () => {
  assert.deepEqual(ADMIN_ROLES, ["admin", "superadmin"]);
  assert.deepEqual(ADMIN_STATUSES, ["active", "inactive", "blocked"]);
  assert.equal(ADMIN_ROLES.includes("user"), false);
});

test("safeEqualSecret accepts only an exact non-empty match", () => {
  assert.equal(safeEqualSecret("correct-key", "correct-key"), true);
  assert.equal(safeEqualSecret("correct-key", "wrong-key"), false);
  assert.equal(safeEqualSecret("correct-key", "correct-key "), false);
  assert.equal(safeEqualSecret("", ""), false);
  assert.equal(safeEqualSecret(undefined, "correct-key"), false);
  assert.equal(safeEqualSecret("correct-key", null), false);
  assert.equal(safeEqualSecret(123, "123"), false);
});

test("isSuperAdminRole accepts aliases but rejects regular admins", () => {
  assert.equal(isSuperAdminRole("superadmin"), true);
  assert.equal(isSuperAdminRole("SUPER_ADMIN"), true);
  assert.equal(isSuperAdminRole(" super_admin "), true);
  assert.equal(isSuperAdminRole("admin"), false);
  assert.equal(isSuperAdminRole(""), false);
  assert.equal(isSuperAdminRole(undefined), false);
  assert.equal(isSuperAdminRole({ role: "superadmin" }), false);
});

test("sanitizeAdmin removes credentials and keeps only public fields", () => {
  const admin = sanitizeAdmin({
    _id: "665f1a2b",
    username: "boss",
    email: "boss@example.com",
    role: "superadmin",
    status: "active",
    isActive: true,
    password: "$2a$10$ hashed",
    passwordHash: "$2a$10$ hashed",
    tokenVersion: 4,
    __v: 0,
  });

  assert.ok(admin);
  assert.equal(admin.password, undefined);
  assert.equal("passwordHash" in admin, false);
  assert.equal("tokenVersion" in admin, false);
  assert.equal("__v" in admin, false);
  assert.equal(admin._id, "665f1a2b");
  assert.equal(admin.username, "boss");
  assert.equal(admin.email, "boss@example.com");
  assert.equal(admin.role, "superadmin");
  assert.equal(admin.status, "active");
  assert.equal(admin.isActive, true);

  assert.equal(sanitizeAdmin(null), null);
  assert.equal(sanitizeAdmin(undefined), null);

  const fromMongooseLikeDoc = sanitizeAdmin({
    toObject: () => ({
      _id: { toString: () => "665f1a2c" },
      role: "admin",
      status: "blocked",
      password: "secret",
    }),
  });
  assert.equal(fromMongooseLikeDoc._id, "665f1a2c");
  assert.equal(fromMongooseLikeDoc.password, undefined);
});

test("parsePagination applies defaults, clamps limits, and computes skip", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 10, skip: 0 });
  assert.deepEqual(parsePagination({ page: "2", limit: "25" }), {
    page: 2,
    limit: 25,
    skip: 25,
  });
  assert.equal(parsePagination({ page: 0, limit: 0 }).page, 1);
  assert.equal(parsePagination({ page: -3, limit: -5 }).limit, 10);
  assert.equal(parsePagination({ page: "abc", limit: "xyz" }).page, 1);
  assert.equal(parsePagination({ limit: 1000 }).limit, 100);
  assert.equal(parsePagination({ page: 3, limit: 50 }).skip, 100);
});
