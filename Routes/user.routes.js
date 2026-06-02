const express = require("express")
const { signup, login } = require("../Controllers/user.controllers")
const router = express.Router()
const upload = require("../middleware/upload");

router.post("/signup", signup)
router.post("/login", login)




module.exports = router