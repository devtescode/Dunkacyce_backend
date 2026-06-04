const Order = require("../Models/models/order.model");

// GET USER PAID ORDERS
module.exports.getAllOrders = async (req, res) => {
  try {
    console.log("USER ID:", req.params.id);

    const orders = await Order.find({
      userId: req.params.id,
      paymentStatus: "Paid",
    }).sort({ createdAt: -1 });

    res.status(200).json({ orders });
  } catch (err) {
    console.error("ORDER FETCH ERROR:", err); // 🔥 IMPORTANT
    res.status(500).json({ message: err.message });
  }
};