const express = require("express");
const upload = require("../middleware/upload");
const { getFoods, addFood, updateFood, deleteFood } = require("../Controllers/food.controllers");
const router = express.Router();

router.get("/", getFoods);
router.post("/", upload.single("image"), addFood);
router.put("/:id", upload.single("image"), updateFood);
router.delete("/:id", deleteFood);

module.exports = router;