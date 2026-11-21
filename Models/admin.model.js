const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    password: { type: String, required: true },

    // 👑 role drives super admin privileges; never trust it from the client
    role: {
      type: String,
      enum: ["admin", "superadmin"],
      default: "admin",
    },

    // 🟢 account status used by auth and admin management
    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },
    isActive: { type: Boolean, default: true },

    // 🔑 bumped on status changes so old tokens can be revoked
    tokenVersion: { type: Number, default: 0 },

    // 🚫 block details
    blockedAt: { type: Date, default: null },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    blockedReason: { type: String, default: "" },

    // ⏸️ deactivation details
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    // 🕒 last status change audit trail
    statusUpdatedAt: { type: Date, default: null },
    statusUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

// 🔐 hash password before saving
adminSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// 🚫 remove password from response
adminSchema.methods.toJSON = function () {
  const admin = this.toObject();
  delete admin.password;
  return admin;
};

// 🛡️ enforce exactly one superadmin atomically at the database level
adminSchema.index(
  { role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: "superadmin" },
    name: "uniq_single_superadmin",
  }
);

// 🧭 migrate legacy admins then build indexes; safe on every start/activation
adminSchema.statics.ensureAdminSchemaReady = async function () {
  const Admin = this;

  // 🧩 fill only missing fields so existing values are never overwritten
  await Admin.updateMany({ role: { $exists: false } }, { $set: { role: "admin" } });
  await Admin.updateMany(
    { status: { $exists: false } },
    { $set: { status: "active" } }
  );
  await Admin.updateMany(
    { isActive: { $exists: false }, status: { $ne: "active" } },
    { $set: { isActive: false } }
  );
  await Admin.updateMany(
    { isActive: { $exists: false }, status: "active" },
    { $set: { isActive: true } }
  );
  await Admin.updateMany(
    { tokenVersion: { $exists: false } },
    { $set: { tokenVersion: 0 } }
  );

  // 🏗️ wait for indexes, including the single-superadmin partial index
  await Admin.init();
};

module.exports = mongoose.model("Admin", adminSchema);
