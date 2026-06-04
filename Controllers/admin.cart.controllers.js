const Cart = require("../Models/models/cart.model");
const Order = require("../Models/models/order.model");



module.exports.getAllCarts = async (req, res) => {
  try {
    // Fetch all cart items and populate user info
    const cartItems = await Cart.find()
      .populate("userId", "fullName email")
      .sort({ createdAt: -1 });

    // Group items by userId
    const grouped = {};

    for (const item of cartItems) {
      const uid = item.userId?._id?.toString() ?? "unknown";

      if (!grouped[uid]) {
        grouped[uid] = {
          userId: uid,
          studentName: item.userId?.fullName ?? "Unknown Student",
          studentEmail: item.userId?.email ?? "",
          items: [],
          total: 0,
          createdAt: item.createdAt,
        };
      }

      grouped[uid].items.push({
        _id: item._id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        soup: item.soup ?? null,
        imageUrl: item.imageUrl,
        category: item.category,
      });

      grouped[uid].total += item.price * item.quantity;

      // Use the most recent item's timestamp as the cart's timestamp
      if (new Date(item.createdAt) > new Date(grouped[uid].createdAt)) {
        grouped[uid].createdAt = item.createdAt;
      }
    }

    const carts = Object.values(grouped).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    return res.json({
      success: true,
      carts,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /orders (ADMIN - only successful paid orders)
module.exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate("userId", "fullName email phone") // 🔥 GET USER INFO
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};