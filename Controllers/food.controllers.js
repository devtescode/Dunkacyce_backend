const Food = require("../Models/models/food.model");
const cloudinary = require("../config/cloudinary");

const parseAvailableSoupsInput = (raw) => {
  if (raw === undefined) return { provided: false, value: [] };
  let arr = raw;
  if (typeof arr === "string") {
    const trimmed = arr.trim();
    if (!trimmed) return { provided: true, value: [] };
    try {
      arr = JSON.parse(trimmed);
    } catch {
      arr = [trimmed];
    }
  }

  if (!Array.isArray(arr)) {
    return { provided: true, error: "availableSoups must be an array of strings" };
  }

  const seen = new Set();
  const value = [];
  for (const item of arr) {
    if (typeof item !== "string") {
      return { provided: true, error: "availableSoups must contain only strings" };
    }
    const soup = item.trim();
    if (!soup) continue;
    if (soup.length > 60) {
      return { provided: true, error: "Each soup name must be 60 characters or fewer" };
    }
    const key = soup.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    value.push(soup);
    if (value.length > 20) {
      return { provided: true, error: "availableSoups cannot contain more than 20 items" };
    }
  }

  return { provided: true, value };
};

const parseSwallowQuantityInput = (raw) => {
  if (raw === undefined) return { provided: false, value: 0 };
  if (raw === null || raw === "") return { provided: true, value: 0 };
  const qty = Number(raw);
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
    return {
      provided: true,
      error: "swallowQuantity must be a non-negative integer",
    };
  }
  return { provided: true, value: qty };
};

/* ================= GET FOODS ================= */
module.exports.getFoods = async (req, res) => {
  try {
    const foods = await Food.find().sort({ createdAt: -1 });
    return res.json({ foods });
  } catch (err) {
    console.error("GET FOODS ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
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
      availableSoups,
      swallowQuantity,
    } = req.body;

    const normalizedName = typeof name === "string" ? name.trim() : name;
    const normalizedCategory = typeof category === "string" ? category.trim() : category;
    const normalizedDescription =
      typeof description === "string" ? description.trim() : description;

    if (!normalizedName || price === undefined || price === null || price === "" || !normalizedCategory || (!req.file && !bodyImageUrl)) {
      return res.status(400).json({
        message: "Name, price, category and image are required",
      });
    }

    const normalizedPrice = Number(price);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      return res.status(400).json({ message: "Valid price is required" });
    }

    const allowedStatuses = ["Available", "Not available", "Preparing"];
    let normalizedStatus;
    if (status !== undefined && status !== null && status !== "") {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Status must be one of: Available, Not available, Preparing",
        });
      }
      normalizedStatus = status;
    }

    const normalizedIsSwallow =
      normalizedCategory === "Foods"
        ? isSwallow === "true" || isSwallow === true
        : false;

    const soupsInput = parseAvailableSoupsInput(availableSoups);
    if (soupsInput.error) {
      return res.status(400).json({ message: soupsInput.error });
    }

    const swallowQtyInput = parseSwallowQuantityInput(swallowQuantity);
    if (swallowQtyInput.error) {
      return res.status(400).json({ message: swallowQtyInput.error });
    }

    const normalizedAvailableSoups = normalizedIsSwallow ? soupsInput.value : [];
    const normalizedSwallowQuantity = normalizedIsSwallow ? swallowQtyInput.value : 0;

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

    const foodPayload = {
      name: normalizedName,
      price: normalizedPrice,
      category: normalizedCategory,
      description: normalizedDescription,
      imageUrl,
      isSwallow: normalizedIsSwallow,
      availableSoups: normalizedAvailableSoups,
      swallowQuantity: normalizedSwallowQuantity,
    };

    if (normalizedStatus !== undefined) {
      foodPayload.status = normalizedStatus;
    }

    const food = await Food.create(foodPayload);

    /* ================= REAL-TIME EMIT ================= */
    const io = req.app.get("io");
    io.emit("food_added", food);
    console.log("EMITTING FOOD ADDED");

    return res.status(201).json({
      message: "Food added",
      food,
    });
  } catch (err) {
    console.error("ADD FOOD ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ================= UPDATE FOOD ================= */
module.exports.updateFood = async (req, res) => {
  try {
    const existingFood = await Food.findById(req.params.id);
    if (!existingFood)
      return res.status(404).json({ message: "Food not found" });

    const updates = { ...req.body };

    if (updates.name !== undefined) {
      if (typeof updates.name !== "string" || !updates.name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      updates.name = updates.name.trim();
    }

    if (updates.category !== undefined) {
      if (typeof updates.category !== "string" || !updates.category.trim()) {
        return res.status(400).json({ message: "Category is required" });
      }
      updates.category = updates.category.trim();
    }

    if (typeof updates.description === "string")
      updates.description = updates.description.trim();

    if (updates.price !== undefined) {
      if (updates.price === null || updates.price === "") {
        return res.status(400).json({ message: "Valid price is required" });
      }
      const normalizedPrice = Number(updates.price);
      if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
        return res.status(400).json({ message: "Valid price is required" });
      }
      updates.price = normalizedPrice;
    }

    if (updates.status !== undefined && updates.status !== null && updates.status !== "") {
      const allowedStatuses = ["Available", "Not available", "Preparing"];
      if (!allowedStatuses.includes(updates.status)) {
        return res.status(400).json({
          message: "Status must be one of: Available, Not available, Preparing",
        });
      }
    } else if (updates.status === null || updates.status === "") {
      delete updates.status;
    }

    if (req.file) {
      const fileString = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
        "base64"
      )}`;

      const uploadResult = await cloudinary.uploader.upload(fileString, {
        folder: "foods",
      });

      updates.imageUrl = uploadResult.secure_url;
    }

    const soupsInput = parseAvailableSoupsInput(req.body.availableSoups);
    if (soupsInput.error) {
      return res.status(400).json({ message: soupsInput.error });
    }

    const swallowQtyInput = parseSwallowQuantityInput(req.body.swallowQuantity);
    if (swallowQtyInput.error) {
      return res.status(400).json({ message: swallowQtyInput.error });
    }

    const category = updates.category || existingFood.category;

    if (category === "Foods") {
      updates.isSwallow =
        req.body.isSwallow !== undefined
          ? req.body.isSwallow === "true" || req.body.isSwallow === true
          : existingFood.isSwallow;
    } else {
      updates.isSwallow = false;
    }

    const finalIsSwallowFood = category === "Foods" && updates.isSwallow === true;
    if (finalIsSwallowFood) {
      updates.availableSoups = soupsInput.provided
        ? soupsInput.value
        : Array.isArray(existingFood.availableSoups)
        ? existingFood.availableSoups
        : [];
      updates.swallowQuantity = swallowQtyInput.provided
        ? swallowQtyInput.value
        : Number.isInteger(existingFood.swallowQuantity) && existingFood.swallowQuantity >= 0
        ? existingFood.swallowQuantity
        : 0;
    } else {
      updates.availableSoups = [];
      updates.swallowQuantity = 0;
    }

    updates.imageUrl = updates.imageUrl || existingFood.imageUrl;

    const food = await Food.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
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
    console.error("UPDATE FOOD ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
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
    console.error("DELETE FOOD ERROR:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};