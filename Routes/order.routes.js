const express = require("express");
const {
  getAllOrders,
  create,
  getUserReceipts,
  updateOrderStatus,
  // getMyOrders,
  // createOrder,
  // updatePaymentStatus,
} = require("../Controllers/order.controllers");
const { verifyAdmin } = require("../middleware/adminAuth");
const router = express.Router();

router.get("/user/:id", getAllOrders);
router.post("/create", create);
router.get("/user/:id/receipts", getUserReceipts);
// router.get("/user/:userId", getMyOrders);
// router.post("/", createOrder);
router.put("/:id/status", verifyAdmin, updateOrderStatus);
// router.put("/:id/payment", updatePaymentStatus);

module.exports = router;