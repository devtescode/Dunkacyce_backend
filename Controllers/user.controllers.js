const jwt = require("jsonwebtoken")
const env = require("dotenv")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const cloudinary = require("../config/cloudinary");
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
                profilePicture: user.profilePicture || "",
            },
        });
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



module.exports.changePasswordPage = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isMatch = await bcrypt.compare(
      oldPassword,
      user.password
    );

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // 🚨 NEW RULE: new password must not equal old password
    const isSamePassword = await bcrypt.compare(
      newPassword,
      user.password
    );

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password cannot be the same as current password",
      });
    }

    // set new password (model will hash it)
    user.password = newPassword;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { fullName, email, phone, gender } = req.body;

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        return res.status(400).json({ message: "Email already in use" });
      }
      user.email = email;
    }

    if (fullName !== undefined) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;

    if (gender !== undefined) {
      const allowedGenders = ["Male", "Female"];
      if (!allowedGenders.includes(gender)) {
        return res.status(400).json({
          message: "Please select a valid gender (Male or Female)",
        });
      }
      user.gender = gender;
    }

    if (req.file) {
      const fileString = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
        "base64"
      )}`;

      const uploadResult = await cloudinary.uploader.upload(fileString, {
        folder: "profiles",
      });

      user.profilePicture = uploadResult.secure_url;
    }

    await user.save();

    const updatedUser = user.toJSON();

    return res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};