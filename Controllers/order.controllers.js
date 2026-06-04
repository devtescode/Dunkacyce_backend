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
    try {
        const {
            userId,
            items,
            hostel,
            room,
            total,
            paymentMethod,
        } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Cart is empty",
            });
        }

        // 🔥 GENERATE SAFE UNIQUE REFERENCE (USED FOR PAYSTACK + ORDER LINKING)
        const reference = crypto.randomBytes(6).toString("hex");

        // 🔥 FIX ITEMS STRUCTURE (IMPORTANT PART)
        const formattedItems = items.map(item => ({
            foodId: item.foodId,
            name: item.name,
            price: item.price,
            qty: item.quantity || item.qty, // 🔥 FIX YOUR ERROR HERE
            soupType: item.soupType || null,

            // ⚠️ optional (only if cart already has image)
            image: item.image || null,
        }));

        const order = await Order.create({
            userId,
            items: formattedItems,
            hostel,
            room,
            total,
            paymentMethod,
            reference,
            paymentStatus: "Pending",
            status: "Pending",
            deliveryFee: 100,
            amountPaid: 0,
            paymentChannel: null,
        });

        return res.status(201).json({
            success: true,
            order,
            reference,
        });

    } catch (err) {
        console.error("ORDER CREATE ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};