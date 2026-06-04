const express = require("express");
const router = express.Router();
const Order = require("../Models/models/order.model");

// GET USER ORDERS
module.exports.getAllOrders = async (req, res) => {

  try {
    const orders = await Order.find({ userId: req.params.id }).sort({
      createdAt: -1,
    });

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }

}
