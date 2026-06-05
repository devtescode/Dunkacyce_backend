const Settings = require("../Models/settings.model");

// GET rush hour status
module.exports.getRushHour = async (req, res) => {
   try {
    const settings = await Settings.findOne();

    return res.status(200).json({
      success: true,
      rushHour: settings ? settings.rushHour : false,
      message: "settings route is working",
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// TOGGLE rush hour
module.exports.toggleRushHour = async (req, res) => {
  try {
    let settings = await Settings.findOne();

    console.log("BEFORE TOGGLE:", settings?.rushHour);

    if (!settings) {
      settings = await Settings.create({ rushHour: true });
    } else {
      settings.rushHour = !settings.rushHour;
      await settings.save();
    }

    console.log("AFTER TOGGLE:", settings.rushHour);

    return res.json({
      success: true,
      rushHour: settings.rushHour,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Server Error" });
  }
};
