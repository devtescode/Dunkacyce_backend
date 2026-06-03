const express = require("express");
const { getFoods, addFood, updateFood, deleteFood } = require("../Controllers/food.controllers");
const router = express.Router();

router.get("/", getFoods);
router.post("/", addFood);
router.put("/:id", updateFood);
router.delete("/:id", deleteFood);

module.exports = router;