const Order = require("../Models/models/order.model");
const crypto = require("crypto");

// GET USER PAID ORDERS
const mongoose = require("mongoose");

module.exports.getAllOrders = async (req, res) => {
  try {
    console.log("USER ID:", req.params.id);

    const userId = new mongoose.Types.ObjectId(req.params.id);

    const orders = await Order.find({
      userId: userId,
      paymentStatus: "Paid",
    }).sort({ createdAt: -1 });

    console.log("ORDERS FOUND:", orders.length);

    return res.status(200).json({ orders });

  } catch (err) {
    console.error("ORDER FETCH ERROR:", err);
    return res.status(500).json({ message: err.message });
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


exports.getUserReceipts = async (req, res) => {
  try {
    const userId = req.params.id;

    console.log("USER ID:", userId);

    // IMPORTANT: ensure ObjectId match
    const orders = await Order.find({
      userId: new mongoose.Types.ObjectId(userId),
      paymentStatus: "Paid",
    })
      .sort({ createdAt: -1 })
      .lean();

    console.log("ORDERS FOUND:", orders.length);

    return res.status(200).json({
      success: true,
      orders: orders.map((o) => ({
        _id: o._id,
        total: o.total,
        hostel: o.hostel,
        room: o.room,
        items: o.items,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        reference: o.reference,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        userId: o.userId,
      })),
    });
  } catch (err) {
    console.error("RECEIPT ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const { status } = req.body || {};
    const allowedStatuses = ["Pending", "Preparing", "Ready", "Delivered"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${allowedStatuses.join(", ")}`,
      });
    }

    // 🔍 LOAD EXISTING ORDER FIRST (need previousStatus + userId)
    const existingOrder = await Order.findById(id).lean();

    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const previousStatus = existingOrder.status;

    // 🧱 BUILD $set — NEVER OVERWRITE EXISTING EVIDENCE TIMESTAMPS
    const $set = { status };
    if (status === "Ready" && !existingOrder.readyAt) {
      $set.readyAt = new Date();
    }
    if (status === "Delivered" && !existingOrder.deliveredAt) {
      $set.deliveredAt = new Date();
    }

    const updated = await Order.findByIdAndUpdate(
      id,
      { $set },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 🔔 REAL-TIME ORDER STATUS BROADCAST (only after DB write succeeds)
    const io = req.app.get("io");
    if (io) {
      const uid = updated.userId?._id ?? updated.userId;
      const payload = {
        orderId: String(updated._id),
        userId: String(uid),
        status: updated.status,
        previousStatus,
        readyAt: updated.readyAt || null,
        deliveredAt: updated.deliveredAt || null,
        etaMinutes: Number(updated.etaMinutes) || 8,
        reference: updated.reference,
        hostel: updated.hostel,
        room: updated.room,
        total: updated.total,
        items: updated.items,
        createdAt: updated.createdAt,
      };

      io.to(`user:${uid}`).emit("order_status_updated", payload);
      io.to("admins").emit("order_status_updated", payload);

      if (status === "Ready") {
        io.to(`user:${uid}`).emit("order_ready", payload);
        io.to("admins").emit("order_ready", payload);
      }

      if (status === "Delivered") {
        io.to(`user:${uid}`).emit("order_delivered", payload);
        io.to("admins").emit("order_delivered", payload);
      }
    }

    return res.status(200).json({
      success: true,
      order: updated,
    });
  } catch (err) {
    console.error("UPDATE ORDER STATUS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};