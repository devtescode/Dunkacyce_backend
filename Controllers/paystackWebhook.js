const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const PaymentDB = require("../Models/webhookModel");
const User = require("../Models/user.models");

require("dotenv").config();

const PAYSTACK_SECRET = process.env.API_SECRET;

/**
 * IMPORTANT:
 * DO NOT use req.rawBody (it does NOT exist in Express)
 * express.raw() already puts Buffer in req.body
 */

// Capture RAW body ONLY for this route
router.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "10mb" }),
  async (req, res) => {
    try {
        console.log("Webhook received with headers:", req.headers);
        console.log("Raw body length:", req.body.length);
        console.log("hitttttttttt")
      const signature = req.headers["x-paystack-signature"];
      const rawBody = req.body; // ✅ THIS IS THE FIX

      if (!signature || !rawBody) {
        console.error("Missing signature or body");
        return res.status(400).send("Bad request");
      }

      // Ensure Buffer format
      const bodyBuffer = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(JSON.stringify(rawBody));

      // Verify Paystack signature
      const hash = crypto
        .createHmac("sha512", PAYSTACK_SECRET)
        .update(bodyBuffer)
        .digest("hex");
        console.log("Computed hash:", PAYSTACK_SECRET);

      if (hash !== signature) {
        console.error("Invalid Paystack signature");
        return res.status(403).send("Invalid signature");
      }

      // Parse event
      const event = JSON.parse(bodyBuffer.toString());

      console.log("Webhook event received:", event.event);

      // =========================
      // HANDLE PAYMENT SUCCESS
      // =========================
      if (event.event === "charge.success") {
        const data = event.data;

        const amount = data.amount; // kobo
        const currency = data.currency;
        const reference = data.reference;
        const status = data.status;
        const channel = data.channel;
        const paidAt = data.paid_at;

        const authorizationCode =
          data.authorization?.authorization_code || "N/A";

        const metadata = data.metadata || {};

        const customerEmail = (
          metadata.customerEmail ||
          data.customer?.email ||
          metadata.email ||
          ""
        )
          .toLowerCase()
          .trim();

        if (!amount || !customerEmail) {
          console.error("Missing amount or email:", {
            amount,
            customerEmail,
          });
          return res.status(400).send("Missing required data");
        }

        const amountInNaira = amount / 100;

        // =========================
        // SAVE PAYMENT (SAFE)
        // =========================
        try {
          await PaymentDB.create({
            event: event.event,
            customerEmail,
            amount: amountInNaira,
            currency: currency || "NGN",
            reference: reference || "NO_REF",
            status: status || "unknown",
            paidAt: paidAt ? new Date(paidAt) : new Date(),
            authorizationCode,
            paymentMethod: "Paystack",
            channel: channel || "unknown",
          });

          console.log("Payment saved successfully");
        } catch (err) {
          if (err.code === 11000) {
            console.warn("Duplicate payment ignored:", reference);
          } else {
            console.error("Payment save error:", err.message);
          }
        }

        // =========================
        // UPDATE USER BALANCE (SAFE)
        // =========================
        const user = await User.findOne({
          email: customerEmail,
        });

        if (!user) {
          console.warn("User not found:", customerEmail);
          return res.sendStatus(200);
        }

        await User.updateOne(
          { email: customerEmail },
          { $inc: { balance: amountInNaira } }
        );

        console.log("User balance updated:", customerEmail);
      }

      return res.sendStatus(200);
    } catch (error) {
      console.error("Webhook error:", error);
      return res.status(500).send("Internal server error");
    }
  }
);

module.exports = router;