const Food = require("../Models/models/food.model");

module.exports.getFoods = async (req, res) => {
  try {
    const foods = await Food.find().sort({ createdAt: -1 });
    return res.json({ foods });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports.addFood = async (req, res) => {
  try {
    const { name, price, category, description, imageUrl, status, isSwallow, dailyLimit } = req.body;

    if (!name || !price || !category || !imageUrl) {
      return res.status(400).json({ message: "Name, price, category and image URL are required" });
    }

    const food = await Food.create({
      name, price, category, description, imageUrl, status,
      isSwallow: category === "Foods" ? isSwallow : false,
      dailyLimit: category === "Foods" ? 10 : 3,
    });

    return res.status(201).json({ message: "Food added", food });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports.updateFood = async (req, res) => {
  try {
    const food = await Food.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!food) return res.status(404).json({ message: "Food not found" });
    return res.json({ message: "Food updated", food });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports.deleteFood = async (req, res) => {
  try {
    const food = await Food.findByIdAndDelete(req.params.id);
    if (!food) return res.status(404).json({ message: "Food not found" });
    return res.json({ message: "Food deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};