const jwt = require("jsonwebtoken")
const env = require("dotenv")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const User = require("../Models/user.models");
env.config()




module.exports.userwelcome = async (req, res) => {
    res.status(200).json({ message: "Welcome to Dunnkayce" })
}




module.exports.signup = async (req, res) => {
    console.log(req.body);

    try {
        const { fullName, email, password, phone, gender } = req.body;

        // ✅ 1. Validate fields (matches frontend)
        if (!fullName || !email || !password || !phone || !gender) {
            return res.status(400).json({
                message: "Please fill all fields including gender",
            });
        }

        // ✅ 2. Validate gender (must match schema enum)
        const allowedGenders = ["Male", "Female"];
        if (!allowedGenders.includes(gender)) {
            return res.status(400).json({
                message: "Please select a valid gender",
            });
        }

        // ✅ 3. Check if email already exists
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(400).json({
                message: "Email already in use",
            });
        }

        // ✅ 4. Create user (password will be auto-hashed by model)
        const user = await User.create({
            fullName,
            email,
            password, // plain password → model handles hashing
            phone,
            gender,
        });

        // ✅ 5. Success response (no password returned because of toJSON)
        return res.status(201).json({
            message: "Account created successfully 🎉",
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
                gender: user.gender,
            },
        });
        console.log("Account created successfully", user    )
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: "Server error",
        });
    }
};




module.exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ✅ 1. Validate fields
    if (!email || !password) {
      return res.status(400).json({
        message: "Please fill all fields",
      });
    }

    // ✅ 2. Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // ✅ 3. Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // ✅ 4. Create JWT
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: "user", // you can upgrade later
      },
      process.env.JWT_SECRET,
      { expiresIn: "1hr" }
    );

    // ✅ 5. Response
    return res.json({
      message: "Login successful 🎉",
      token,
      user,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Server error",
    });
  }
};