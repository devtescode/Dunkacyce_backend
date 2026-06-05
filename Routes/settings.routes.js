const express = require("express");
const router = express.Router();

const {
  toggleRushHour,
  getRushHour,
} = require("../Controllers/settings.controller");

// GET real value
// router.get("/rush-hour", (req, res) => {
//   res.status(200).json({
//     success: true,
//     rushHour: true,
//     message: "settings route is working"
//   });
  
// });

router.get("/rush-hour", getRushHour);

// TOGGLE
router.patch("/rush-hour", toggleRushHour);

module.exports = router;