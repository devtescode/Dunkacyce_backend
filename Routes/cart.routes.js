const express = require("express");
const router = express.Router();

const { addToCart, getUserCart, updateCartQty, removeFromCart, initializePayment } = require("../Controllers/cart.controller");
const { verifyToken } = require("../middleware/auth");

router.post("/add", verifyToken, addToCart);
router.get("/getusercart", verifyToken, getUserCart);
router.put("/updatecartqty", verifyToken, updateCartQty);
router.delete("/removefromcart/:id", verifyToken, removeFromCart);
router.post("/initialize-payment", initializePayment);

module.exports = router;