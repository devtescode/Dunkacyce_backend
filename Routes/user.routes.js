const express = require("express");

const {
  signup,
  login,
  changePasswordPage,
  getProfile,
  updateProfile,
} = require("../Controllers/user.controllers");

const { verifyToken } = require("../middleware/auth");
const upload = require("../middleware/upload");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.put("/change-password", verifyToken, changePasswordPage);
router.get("/profile", verifyToken, getProfile);
router.put("/profile", verifyToken, upload.single("profilePicture"), updateProfile);

module.exports = router;