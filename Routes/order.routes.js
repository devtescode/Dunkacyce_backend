const express = require("express");
const {
  getAllOrders,
  getMyOrders,
  createOrder,
  updateOrderStatus,
  updatePaymentStatus,
} = require("../Controllers/order.controllers");
const router = express.Router();

router.get("/", getAllOrders);
router.get("/user/:userId", getMyOrders);
router.post("/", createOrder);
router.put("/:id/status", updateOrderStatus);
router.put("/:id/payment", updatePaymentStatus);

module.exports = router;