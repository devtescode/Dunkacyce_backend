const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const PaymentDB = require("../Models/webhookModel");
const Order = require("../Models/models/order.model");
const User = require("../Models/user.models");
const Cart = require("../Models/models/cart.model"); // ✅ IMPORTANT ADD

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
        const alreadyProcessed = await PaymentDB.findOne({ reference });

        if (alreadyProcessed) {
            console.log("⚠️ Payment already processed");
            return res.status(200).send("OK");
        }

        // =========================
        // 💾 SAVE PAYMENT
        // =========================
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

        console.log("✅ Payment saved");

        // =========================
        // 🧾 UPDATE ORDER
        // =========================
        const order = await Order.findOne({ reference });

        if (order) {
            order.paymentStatus = "Paid";
            order.amountPaid = amountInNGN;
            order.paymentChannel = channel;
            order.paidAt = new Date(paidAt || Date.now());
            order.status = "Preparing";

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
            }
        } else {
            console.log("⚠️ Order not found for reference:", reference);
        }

        // =========================
        // 👤 UPDATE USER BALANCE
        // =========================
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

        return res.status(200).send("OK");

    } catch (error) {
        console.error("🔥 Webhook error:", error);
        return res.status(500).send("Server error");
    }
});

module.exports = router;