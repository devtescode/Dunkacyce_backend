const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  foodId: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  qty: { type: Number, required: true },
  soupType: { type: String, default: null },
});

const orderSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },

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

    // 🔥 ADD THIS (CRITICAL FOR PAYSTACK)
    reference: { type: String, unique: true, required: true },
    

    paidAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);