import AppConfig from "../models/appConfigModel.js";

/**
 * Get the global application configuration.
 * Publicly accessible.
 */
export const getAppConfig = async (req, res) => {
  try {
    const config = await AppConfig.findOne({});
    // Even though it's public, we only return the non-sensitive fields
    // if there were any sensitive ones, but for now both are fine.
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update the global application configuration.
 * Admin only.
 */
export const updateAppConfig = async (req, res) => {
  try {
    const config = await AppConfig.findOneAndUpdate(
      {},
      req.body,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
