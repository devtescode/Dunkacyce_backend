const mongoose = require("mongoose");

const foodSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, enum: ["Foods", "Protein"], required: true },
    description: { type: String },
    imageUrl: { type: String, required: true },
    status: { type: String, enum: ["Available", "Not available", "Preparing"], default: "Available" },
    isSwallow: { type: Boolean, default: false },
    dailyLimit: { type: Number, default: 10 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Food", foodSchema);