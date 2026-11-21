const express = require("express")
const { adminExists, registerAdmin, loginAdmin, dashboardstats, getAllUsers } = require("../Controllers/admin.controllers")
const { getAllCarts, getAllOrders } = require("../Controllers/admin.cart.controllers");
const { verifyAdmin, verifySuperAdmin } = require("../middleware/adminAuth");
const {
  listAdmins,
  createAdmin,
  setAdminStatus,
  blockAdmin,
  unblockAdmin,
  deleteAdmin,
} = require("../Controllers/superadmin.controllers");

const router = express.Router()


// router.get("/exists", adminController.adminExists);
// router.post("/register", adminController.registerAdmin);
// router.post("/login", adminController.loginAdmin);
router.get("/exists", adminExists)
router.post("/register", registerAdmin)
router.post("/login", loginAdmin)
router.get("/dashboard-stats", verifyAdmin, dashboardstats);
router.get("/users", verifyAdmin, getAllUsers);

router.get("/carts", verifyAdmin, getAllCarts);
router.get("/getorders", verifyAdmin, getAllOrders);

// Compatibility aliases for the canonical /api/superadmin/admins endpoints
router.get("/admins", verifySuperAdmin, listAdmins);
router.post("/admins", verifySuperAdmin, createAdmin);
router.patch("/admins/:id", verifySuperAdmin, setAdminStatus);
router.patch("/admins/:id/block", verifySuperAdmin, blockAdmin);
router.patch("/admins/:id/unblock", verifySuperAdmin, unblockAdmin);
router.delete("/admins/:id", verifySuperAdmin, deleteAdmin);


module.exports = router
