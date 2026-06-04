const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Userschema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    balance: { type: Number, default: 0 },

    gender: {
      type: String,
      enum: ["Male", "Female"],
      required: true,
    },
  },
  { timestamps: true }
);

// ✅ FIXED PASSWORD HASHING (NO next)
Userschema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Hide password in responses
Userschema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model("User", Userschema);