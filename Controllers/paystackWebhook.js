const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const router = express.Router();

const PaymentDB = require("../Models/webhookModel");
const Order = require("../Models/models/order.model");
const User = require("../Models/user.models");
const Cart = require("../Models/models/cart.model"); // ✅ IMPORTANT ADD
const Food = require("../Models/models/food.model");

require("dotenv").config();

const PAYSTACK_SECRET = process.env.API_SECRET;

/**
 * Convert request body safely into Buffer
 */
function getRawBody(req) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body);
    if (req.body && typeof req.body === "object") {
        return Buffer.from(JSON.stringify(req.body));
    }
    return Buffer.from("");
}

router.post("/webhook", async (req, res) => {
    try {
        const signature = req.headers["x-paystack-signature"];
        const rawBody = getRawBody(req);

        if (!signature || !rawBody.length) {
            return res.status(400).send("Missing signature or body");
        }

        // 🔐 VERIFY PAYSTACK SIGNATURE
        const hash = crypto
            .createHmac("sha512", PAYSTACK_SECRET)
            .update(rawBody)
            .digest("hex");

        if (hash !== signature) {
            console.error("❌ Invalid Paystack signature");
            return res.status(403).send("Invalid signature");
        }

        const event = JSON.parse(rawBody.toString("utf8"));

        console.log("📩 Paystack event:", event.event);

        // ONLY SUCCESS PAYMENT
        if (event.event !== "charge.success") {
            return res.status(200).send("Ignored event");
        }

        const data = event.data || {};

        const amount = data.amount;
        const reference = data.reference;
        const currency = data.currency || "NGN";
        const status = data.status;
        const paidAt = data.paid_at;
        const channel = data.channel;

        const authorization = data.authorization || {};

        const email =
            data.customer?.email ||
            data.metadata?.customerEmail ||
            data.metadata?.email;

        const amountInNGN = amount / 100;

        if (!amount || !reference || !email) {
            console.log("❌ Missing required fields");
            return res.status(400).send("Invalid payload");
        }

        // =========================
        // 🧠 PREVENT DOUBLE PROCESSING
                // =========================
        // PREVENT DOUBLE PROCESSING
        // =========================
        const alreadyProcessed = await PaymentDB.findOne({ reference });

        if (alreadyProcessed) {
            console.log("Payment already processed:", reference);
            return res.status(200).send("OK");
        }

        // =========================
        // SAVE PAYMENT (claim dedup early; catch race duplicates)
        // =========================
        try {
            await PaymentDB.create({
                event: "charge.success",
                customerEmail: email.toLowerCase().trim(),
                amount: amountInNGN,
                currency,
                reference,
                status,
                paidAt: paidAt ? new Date(paidAt) : new Date(),
                authorizationCode: authorization.authorization_code || "",
                paymentMethod: "Paystack",
                channel,
            });
        } catch (createError) {
            if (createError?.code === 11000 || createError?.code === 'E11000') {
                console.log("Duplicate payment webhook (race), skipping:", reference);
                return res.status(200).send("OK");
            }
            throw createError;
        }

        console.log("Payment saved:", reference);

        try {

            let shouldCreditBalance = true;

            // =========================
            // 🧾 UPDATE ORDER
            // =========================
            const order = await Order.findOne({ reference });

            if (order) {
                if (order.paymentStatus === "Paid" || order.stockDecremented) {
                    // Extra safety guard: avoid double-processing side effects.
                    shouldCreditBalance = false;
                    console.log("⚠️ Order already paid/stock decremented, skipping confirmation side effects:", reference);
                } else {
                    // =========================
                    // 📦 DECREMENT SWALLOW STOCK (IDEMPOTENT GUARD VIA stockDecremented)
                    // =========================
                    const swallowQtyByFoodId = new Map();
                    for (const item of (order.items || [])) {
                        const foodId = item?.foodId != null ? String(item.foodId) : null;
                        const qty = Number(item?.qty ?? item?.quantity ?? 0);
                        if (!foodId || !Number.isFinite(qty) || qty <= 0) continue;
                        swallowQtyByFoodId.set(foodId, (swallowQtyByFoodId.get(foodId) || 0) + qty);
                    }

                    const decrementedStocks = [];
                    try {
                        for (const [foodId, qty] of swallowQtyByFoodId.entries()) {
                            if (!mongoose.Types.ObjectId.isValid(foodId)) {
                                console.warn("⚠️ Invalid swallow foodId in order, skipping stock decrement:", foodId, reference);
                                continue;
                            }

                            const decremented = await Food.findOneAndUpdate(
                                { _id: foodId, isSwallow: true, category: "Foods", swallowQuantity: { $gte: qty } },
                                { $inc: { swallowQuantity: -qty } },
                                { new: true }
                            );

                            if (decremented) {
                                decrementedStocks.push({ foodId, qty });
                            } else {
                                // Insufficient stock or not a swallow food; clamp swallow stock to 0 safely.
                                await Food.updateOne(
                                    { _id: foodId, isSwallow: true, category: "Foods" },
                                    { $set: { swallowQuantity: 0 } }
                                );
                            }
                        }
                    } catch (stockError) {
                        // Best-effort reversal so PaymentDB claim rollback can safely retry.
                        for (const entry of decrementedStocks.reverse()) {
                            try {
                                await Food.updateOne(
                                    { _id: entry.foodId, isSwallow: true, category: "Foods" },
                                    { $inc: { swallowQuantity: entry.qty } }
                                );
                            } catch (revertError) {
                                console.error("⚠️ Failed to revert swallow stock decrement:", entry.foodId, reference, revertError);
                            }
                        }
                        throw stockError;
                    }

                    order.paymentStatus = "Paid";
                    order.amountPaid = amountInNGN;
                    order.paymentChannel = channel;
                    order.paidAt = new Date(paidAt || Date.now());
                    order.status = "Preparing";
                    order.stockDecremented = true;

                    await order.save();

                    console.log("✅ Order updated to PAID");

                    // =========================
                    // 🛒 CLEAR CART AFTER PAYMENT
                    // =========================
                    await Cart.deleteMany({
                        userId: order.userId,
                    });

                    console.log("🛒 Cart cleared after payment");

                    // =========================
                    // 🔔 REAL-TIME ADMIN ALERT
                    // =========================
                    const io = req.app.get("io");
                    if (io) {
                        let student = null;
                        try {
                            const populatedOrder = await Order.findById(order._id).populate("userId", "fullName email phone");
                            const u = populatedOrder?.userId;
                            if (u && typeof u === "object") {
                                student = {
                                    _id: u._id,
                                    fullName: u.fullName || null,
                                    email: u.email || null,
                                    phone: u.phone || null,
                                };
                            }
                        } catch (populateErr) {
                            console.warn("⚠️ Could not populate student for payment alert:", populateErr.message);
                        }

                        if (!student) {
                            try {
                                const u = await User.findById(order.userId).select("fullName email phone");
                                if (u) {
                                    student = {
                                        _id: u._id,
                                        fullName: u.fullName || null,
                                        email: u.email || null,
                                        phone: u.phone || null,
                                    };
                                }
                            } catch (userErr) {
                                console.warn("⚠️ Could not load student for payment alert:", userErr.message);
                            }
                        }

                        const payload = {
                            orderId: order._id,
                            reference: order.reference,
                            amountPaid: order.amountPaid,
                            total: order.total,
                            paidAt: order.paidAt,
                            paymentChannel: order.paymentChannel,
                            paymentStatus: order.paymentStatus,
                            status: order.status,
                            fulfillmentStatus: order.status,
                            hostel: order.hostel,
                            room: order.room,
                            userId: order.userId,
                            student,
                            items: order.items,
                            itemCount: Array.isArray(order.items) ? order.items.length : 0,
                            createdAt: order.createdAt,
                        };

                        io.to("admins").emit("payment_confirmed", payload);
                        console.log("🔔 Admin payment alert emitted:", order.reference);

                        // 🔔 REAL-TIME ORDER STATUS UPDATE (student room)
                        const statusPayload = {
                            orderId: String(order._id),
                            userId: String(order.userId),
                            status: "Preparing",
                            previousStatus: "Pending",
                            readyAt: null,
                            deliveredAt: null,
                            etaMinutes: Number(order.etaMinutes) || 8,
                            reference: order.reference,
                            hostel: order.hostel,
                            room: order.room,
                            total: order.total,
                            items: order.items,
                            createdAt: order.createdAt,
                        };

                        io.to(`user:${String(order.userId)}`).emit("order_status_updated", statusPayload);
                    }
                }
            } else {
                console.log("⚠️ Order not found for reference:", reference);
            }

            // =========================
            // 👤 UPDATE USER BALANCE
            // =========================
            if (shouldCreditBalance) {
                const user = await User.findOne({
                    email: email.toLowerCase().trim(),
                });

                if (user) {
                    user.balance = (user.balance || 0) + amountInNGN;
                    await user.save();

                    console.log("👤 User balance updated:", user.email);
                } else {
                    console.warn("⚠️ User not found:", email);
                }
            } else {
                console.log("⚠️ Skipping balance credit for already processed order:", reference);
            }

            return res.status(200).send("OK");
        } catch (processingError) {
            console.error("Webhook post-payment processing failed, rolling back payment claim:", reference, processingError);
            try {
                await PaymentDB.deleteOne({ reference });
                console.log("Rolled back payment claim for retry:", reference);
            } catch (rollbackError) {
                console.error("Failed to rollback payment claim:", reference, rollbackError);
            }
            throw processingError;
        }

    } catch (error) {
        console.error("🔥 Webhook error:", error);
        return res.status(500).send("Server error");
    }
});

module.exports = router;