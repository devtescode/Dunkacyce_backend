const express = require("express");

const {
  signup,
  login,
  changePasswordPage,
} = require("../Controllers/user.controllers");

const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.put("/change-password", verifyToken, changePasswordPage);

module.exports = router;