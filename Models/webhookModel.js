const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    event: { type: String, required: true },

    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    amount: { type: Number, required: true },

    currency: { type: String, default: "NGN" },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    status: { type: String, required: true },

    paidAt: { type: Date, default: Date.now },

    authorizationCode: { type: String, default: "" },

    paymentMethod: { type: String, default: "Paystack" },

    channel: { type: String, default: "unknown" },

    transactionDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ✅ IMPORTANT FIX: export model directly (NO object wrapper)
module.exports = mongoose.model("PaymentDB", paymentSchema);