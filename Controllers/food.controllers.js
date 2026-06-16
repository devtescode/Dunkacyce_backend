const Food = require("../Models/models/food.model");
const cloudinary = require("../config/cloudinary");

/* ================= GET FOODS ================= */
module.exports.getFoods = async (req, res) => {
  try {
    const foods = await Food.find().sort({ createdAt: -1 });
    return res.json({ foods });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= ADD FOOD ================= */
module.exports.addFood = async (req, res) => {
  try {
    const {
      name,
      price,
      category,
      description,
      imageUrl: bodyImageUrl,
      status,
      isSwallow,
    } = req.body;

    if (!name || !price || !category || (!req.file && !bodyImageUrl)) {
      return res.status(400).json({
        message: "Name, price, category and image are required",
      });
    }

    let imageUrl = bodyImageUrl;

    if (req.file) {
      const fileString = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
        "base64"
      )}`;

      const uploadResult = await cloudinary.uploader.upload(fileString, {
        folder: "foods",
      });

      imageUrl = uploadResult.secure_url;
    }

    const food = await Food.create({
      name,
      price,
      category,
      description,
      imageUrl,
      status,
      isSwallow:
        category === "Foods"
          ? isSwallow === "true" || isSwallow === true
          : false,
      dailyLimit: category === "Foods" ? 10 : 3,
    });

    /* ================= REAL-TIME EMIT ================= */
    const io = req.app.get("io");
    io.emit("food_added", food);
    console.log("EMITTING FOOD ADDED");

    return res.status(201).json({
      message: "Food added",
      food,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= UPDATE FOOD ================= */
module.exports.updateFood = async (req, res) => {
  try {
    const existingFood = await Food.findById(req.params.id);
    if (!existingFood)
      return res.status(404).json({ message: "Food not found" });

    const updates = { ...req.body };

    if (req.file) {
      const fileString = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
        "base64"
      )}`;

      const uploadResult = await cloudinary.uploader.upload(fileString, {
        folder: "foods",
      });

      updates.imageUrl = uploadResult.secure_url;
    }

    const category = updates.category || existingFood.category;

    if (category === "Foods") {
      updates.isSwallow =
        req.body.isSwallow !== undefined
          ? req.body.isSwallow === "true" || req.body.isSwallow === true
          : existingFood.isSwallow;

      updates.dailyLimit = 10;
    } else {
      updates.isSwallow = false;
      updates.dailyLimit = 3;
    }

    updates.imageUrl = updates.imageUrl || existingFood.imageUrl;

    const food = await Food.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    });

    /* ================= REAL-TIME EMIT ================= */
    const io = req.app.get("io");
    io.emit("food_updated", food);
    console.log("EMITTING FOOD UPDATE");

    return res.json({
      message: "Food updated",
      food,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= DELETE FOOD ================= */
module.exports.deleteFood = async (req, res) => {
  try {
    const food = await Food.findByIdAndDelete(req.params.id);

    if (!food)
      return res.status(404).json({ message: "Food not found" });

    /* ================= REAL-TIME EMIT ================= */
    const io = req.app.get("io");
    io.emit("food_deleted", req.params.id);
    console.log("Emitting food delect")

    return res.json({ message: "Food deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};