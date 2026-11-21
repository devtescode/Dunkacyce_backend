const express = require("express");
const { verifyAdmin, verifySuperAdmin } = require("../middleware/adminAuth");
const {
  activateSuperAdmin,
  getSuperAdminStatus,
  getSuperAdminMe,
  listAdmins,
  createAdmin,
  setAdminStatus,
  blockAdmin,
  unblockAdmin,
  deleteAdmin,
} = require("../Controllers/superadmin.controllers");

const router = express.Router();

// Public
router.get("/status", getSuperAdminStatus);

// Admin (any active admin)
router.post("/activate", verifyAdmin, activateSuperAdmin);
router.get("/me", verifyAdmin, getSuperAdminMe);

// Super Admin only
router.get("/admins", verifySuperAdmin, listAdmins);
router.post("/admins", verifySuperAdmin, createAdmin);
router.patch("/admins/:id/status", verifySuperAdmin, setAdminStatus);
router.patch("/admins/:id/block", verifySuperAdmin, blockAdmin);
router.patch("/admins/:id/unblock", verifySuperAdmin, unblockAdmin);
router.delete("/admins/:id", verifySuperAdmin, deleteAdmin);

module.exports = router;
