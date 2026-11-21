const express = require("express");
const upload = require("../middleware/upload");
const { verifyAdmin } = require("../middleware/adminAuth");
const { getFoods, addFood, updateFood, deleteFood } = require("../Controllers/food.controllers");
const router = express.Router();

router.get("/", getFoods);
router.post("/", verifyAdmin, upload.single("image"), addFood);
router.put("/:id", verifyAdmin, upload.single("image"), updateFood);
router.delete("/:id", verifyAdmin, deleteFood);

module.exports = router;