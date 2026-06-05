// models/settings.model.js

    const mongoose = require("mongoose");

    const settingsSchema = new mongoose.Schema({
    rushHour: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("Settings", settingsSchema);