const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  foodId: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  qty: { type: Number, required: true },
  soupType: { type: String, default: null },

  // 🆕 OPTIONAL: for image display in UI
  image: { type: String, default: null },
});

const orderSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, ref: "User", },
    //  userId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User", // 🔥 IMPORTANT
    //   required: true,
    // },

    items: [orderItemSchema],

    hostel: { type: String, required: true },
    room: { type: String, required: true },

    paymentMethod: {
      type: String,
      enum: ["Paystack", "Moniepoint"],
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Rejected"],
      default: "Pending",
    },

    status: {
      type: String,
      enum: ["Pending", "Preparing", "Ready", "Delivered"],
      default: "Pending",
    },

    deliveryFee: { type: Number, default: 100 },

    total: { type: Number, required: true },

    // 🔥 THIS IS NOW THE MAIN LINK TO PAYSTACK
    reference: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },

    // 🆕 IMPORTANT FOR UI (what user actually paid)
    amountPaid: {
      type: Number,
      default: 0,
    },

    paidAt: { type: Date },

    // 🆕 READINESS / DELIVERY TRACKING
    readyAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    etaMinutes: { type: Number, default: 8, min: 1 },

    // 🆕 DURABLE DELIVERY EVIDENCE (server-computed on Delivered)
    etaDeadlineAt: { type: Date, default: null },
    deliveredBeforeDeadline: { type: Boolean, default: null },
    lateByMs: { type: Number, default: null },
    etaMinutesUsed: { type: Number, default: null },
    readyAtUsed: { type: Date, default: null },
    deliveredBy: { type: String, default: null },

    // 🆕 OPTIONAL TRACKING
    paymentChannel: {
      type: String,
      default: null,
    },

    stockDecremented: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);