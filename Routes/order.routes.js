const express = require("express");
const {
  getAllOrders,
  create,
  getUserReceipts,
  // getMyOrders,
  // createOrder,
  // updateOrderStatus,
  // updatePaymentStatus,
} = require("../Controllers/order.controllers");
const router = express.Router();

router.get("/user/:id", getAllOrders);
router.post("/create", create);
router.get("/user/:id/receipts", getUserReceipts);
// router.get("/user/:userId", getMyOrders);
// router.post("/", createOrder);
// router.put("/:id/status", updateOrderStatus);
// router.put("/:id/payment", updatePaymentStatus);

module.exports = router;