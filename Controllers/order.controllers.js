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
        // Durable delivery evidence kept for the user's records.
        etaDeadlineAt: o.etaDeadlineAt ?? null,
        deliveredBeforeDeadline: o.deliveredBeforeDeadline ?? null,
        lateByMs: o.lateByMs ?? null,
        etaMinutesUsed: o.etaMinutesUsed ?? null,
        readyAtUsed: o.readyAtUsed ?? null,
        deliveredBy: o.deliveredBy ?? null,
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

    // 🔒 DELIVERED IS TERMINAL — a handoff is final and must never be reverted.
    // A repeated "Delivered" request is a harmless no-op; any other transition
    // from Delivered is rejected before any write or broadcast happens.
    if (previousStatus === "Delivered") {
      if (status === "Delivered") {
        return res.status(200).json({
          success: true,
          order: existingOrder,
          message: "This order has already been delivered.",
        });
      }
      return res.status(409).json({
        success: false,
        message: "This order has already been delivered and its status cannot be changed.",
      });
    }

    // 🧱 ATOMIC UPDATE — never overwrite an existing evidence timestamp.
    // $ifNull makes the "stamp only when missing" check part of the write itself,
    // so two concurrent admins cannot both claim the same ready/delivered time.
    const now = new Date();
    const $set = { status };

    if (status === "Ready") {
      $set.readyAt = { $ifNull: ["$readyAt", now] };
    }
    if (status === "Delivered") {
      $set.deliveredAt = { $ifNull: ["$deliveredAt", now] };

      // Durable delivery evidence is computed server-side from the stored
      // readyAt so a client cannot claim on-time delivery it did not earn.
      const eta = Number(existingOrder.etaMinutes) || 8;
      const storedReadyAt = existingOrder.readyAt
        ? new Date(existingOrder.readyAt)
        : null;
      const deliveredBy = req.admin?.id ? String(req.admin.id) : null;

      if (storedReadyAt && !Number.isNaN(storedReadyAt.getTime())) {
        const deadlineMs = storedReadyAt.getTime() + eta * 60000;
        const nowMs = now.getTime();
        $set.etaDeadlineAt = new Date(deadlineMs);
        $set.deliveredBeforeDeadline = nowMs <= deadlineMs;
        $set.lateByMs = Math.max(0, nowMs - deadlineMs);
        $set.etaMinutesUsed = eta;
        $set.readyAtUsed = storedReadyAt;
        $set.deliveredBy = deliveredBy;
      } else {
        // No trustworthy readyAt: never invent a deadline or a lateness value.
        $set.etaDeadlineAt = null;
        $set.deliveredBeforeDeadline = null;
        $set.lateByMs = 0;
        $set.etaMinutesUsed = null;
        $set.readyAtUsed = null;
        $set.deliveredBy = null;
      }
    }

    // Single $set stage — delivered orders never reach this point, so no
    // evidence is ever cleared once a handoff has been recorded.
    const pipeline = [{ $set }];

    let updated;
    try {
      // Mongoose only accepts an aggregation pipeline when `updatePipeline` is
      // explicitly enabled; otherwise it treats the array as a legacy update
      // document and throws "Cannot pass an array to query updates".
      updated = await Order.findByIdAndUpdate(id, pipeline, {
        new: true,
        updatePipeline: true,
      });
    } catch (writeError) {
      console.error("ORDER STATUS WRITE ERROR:", writeError);
      return res.status(500).json({
        success: false,
        message: "We couldn't update the order status right now. Please try again.",
      });
    }

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 🔔 REAL-TIME ORDER STATUS BROADCAST — never fail a committed update.
    try {
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
          updatedAt: updated.updatedAt || null,
          paymentStatus: updated.paymentStatus || null,
          // Durable delivery evidence travels with every status broadcast.
          etaDeadlineAt: updated.etaDeadlineAt || null,
          deliveredBeforeDeadline:
            typeof updated.deliveredBeforeDeadline === "boolean"
              ? updated.deliveredBeforeDeadline
              : null,
          lateByMs: Number.isFinite(updated.lateByMs) ? updated.lateByMs : 0,
          etaMinutesUsed: Number.isFinite(updated.etaMinutesUsed)
            ? updated.etaMinutesUsed
            : null,
          readyAtUsed: updated.readyAtUsed || null,
          deliveredBy: updated.deliveredBy || null,
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
    } catch (emitError) {
      console.error("ORDER STATUS SOCKET EMIT ERROR:", emitError.message);
    }

    return res.status(200).json({
      success: true,
      order: updated,
    });
  } catch (err) {
    console.error("UPDATE ORDER STATUS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating the order status. Please try again.",
    });
  }
};