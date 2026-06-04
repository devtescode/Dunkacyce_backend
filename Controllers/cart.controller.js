const Food = require("../Models/models/food.model");
const Cart = require("../Models/models/cart.model");
const axios = require("axios");
const crypto = require("crypto");
const Order = require("../Models/models/order.model");


module.exports.addToCart = async (req, res) => {
  try {
    const { foodId, quantity, soup } = req.body;

    console.log("Incoming foodId:", foodId);

    if (!foodId) {
      return res.status(400).json({
        message: "foodId is missing",
      });
    }

    // ✅ correct collection now
    const food = await Food.findById(foodId);

    if (!food) {
      return res.status(404).json({
        message: "Food not found in DB",
        foodId,
      });
    }

    const existingCartItem = await Cart.findOne({
      userId: req.user.id,
      foodId,
    });

    if (existingCartItem) {
      existingCartItem.quantity += quantity || 1;
      await existingCartItem.save();

      return res.status(200).json({
        success: true,
        message: "Cart updated",
      });
    }

    await Cart.create({
      userId: req.user.id,
      foodId: food._id,

      name: food.name,
      price: food.price,
      imageUrl: food.imageUrl,
      category: food.category,
      status: food.status,

      quantity: quantity || 1,
      soup, 
    });
    console.log(Cart, "adddddddddddddddd to cartttttttttttttttttttttt");

    return res.status(201).json({
      success: true,
      message: "Added to cart",
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Server Error",
    });
  }
};




module.exports.getUserCart = async (req, res) => {
  try {
    const cart = await Cart.find({ userId: req.user.id });

    return res.json({
      success: true,
      cart,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports.updateCartQty = async (req, res) => {
  try {
    const { cartId, quantity } = req.body;

    console.log("Updating cart quantity:", req.body);

    const cartItem = await Cart.findById(cartId);

    if (!cartItem) {
      console.log("Found cart item: null");
      return res.status(404).json({
        message: "Cart item not found",
        cartId,
      });
    }

    cartItem.quantity = quantity;

    if (quantity <= 0) {
      await cartItem.deleteOne();
      return res.json({ success: true, message: "Item removed" });
    }

    await cartItem.save();

    return res.json({
      success: true,
      message: "Cart updated",
      cart: cartItem,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Server error" });
  }
};


module.exports.removeFromCart = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Deleting cart item:", id);

    const deleted = await Cart.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        message: "Cart item not found",
      });
    }

    return res.json({
      success: true,
      message: "Item removed",
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      message: "Server error",
    });
  }
};




module.exports.initializePayment = async (req, res) => {
  try {
    const { email, amount, orderId } = req.body;

    // 1. Find order
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 2. Use ORDER reference (NOT random Paystack reference)
    const reference = order.reference;

    // 3. Initialize Paystack
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100,

        // 🔥 VERY IMPORTANT
        reference,

        // better callback (frontend only redirect)
        callback_url: "https://dunnkayce-navy.vercel.app/orders",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.API_SECRET}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.status(200).json({
      success: true,
      data: response.data.data,
      reference, // send back to frontend
    });
  } catch (error) {
    console.log(error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      message: "Payment initialization failed",
    });
  }
};