const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const PaymentDB = require("../Models/webhookModel"); 
const Order = require("../Models/models/order.model"); // ✅ IMPORTANT FIX
const User = require("../Models/user.models");

require("dotenv").config();

const PAYSTACK_SECRET = process.env.API_SECRET;

/**
 * Ensure raw body is always Buffer
 */
function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body instanceof Object) return Buffer.from(JSON.stringify(req.body));
  return Buffer.from("");
}

router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];

    const rawBody = getRawBody(req);

    if (!signature || !rawBody.length) {
      return res.status(400).json({ error: "Missing signature or body" });
    }

    // ✅ VERIFY PAYSTACK SIGNATURE
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

    // =========================
    // 💳 PAYMENT SUCCESS EVENT
    // =========================
    if (event.event === "charge.success") {
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

      if (!amount || !email || !reference) {
        console.log("❌ Missing required payment data");
        return res.status(400).send("Invalid payload");
      }

      // =========================
      // 💾 SAVE PAYMENT RECORD
      // =========================
      const existingPayment = await PaymentDB.findOne({ reference });

      if (!existingPayment) {
        await PaymentDB.create({
          event: event.event,
          customerEmail: email.toLowerCase().trim(),
          amount: amountInNGN,
          currency,
          reference,
          status,
          paidAt: paidAt ? new Date(paidAt) : new Date(),
          authorizationCode:
            authorization.authorization_code || "",
          paymentMethod: "Paystack",
          channel,
        });

        console.log("✅ Payment saved");
      } else {
        console.log("⚠️ Duplicate payment ignored");
      }

      // =========================
      // 🧾 UPDATE ORDER (IMPORTANT)
      // =========================
      const order = await Order.findOne({ reference });

      if (order) {
        order.paymentStatus = "Paid";
        order.paidAt = new Date();
        order.total = amountInNGN;

        await order.save();

        console.log("✅ Order marked as PAID");
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
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("🔥 Webhook error:", error);
    return res.status(500).send("Server error");
  }
});

module.exports = router;