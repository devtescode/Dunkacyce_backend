const Order = require("../Models/models/order.model");
const crypto = require("crypto");

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

module.exports.create = async (req, res) => {
    // router.post("/create", async (req, res) => {
    try {
        const {
            userId,
            items,
            hostel,
            room,
            total,
            paymentMethod,
        } = req.body;

        // 🔥 GENERATE SAFE UNIQUE REFERENCE
        const reference = crypto.randomBytes(6).toString("hex");

        const order = await Order.create({
            userId,
            items,
            hostel,
            room,
            total,
            paymentMethod,
            reference,
            paymentStatus: "Pending",
            status: "Pending",
        });

        return res.status(201).json({
            success: true,
            order,
            reference,
        });
    } catch (err) {
        console.error("ORDER CREATE ERROR:", err); // 🔥 IMPORTANT
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
    // });
}
