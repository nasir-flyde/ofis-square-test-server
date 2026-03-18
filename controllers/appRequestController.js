import AppRequest from "../models/appRequestModel.js";

/**
 * Create a new app access request
 * @route POST /api/app-requests
 */
export const createAppRequest = async (req, res) => {
  try {
    const { email, appName, platform } = req.body;

    if (!email || !appName || !platform) {
      return res.status(400).json({
        success: false,
        message: "Email, appName, and platform are required",
      });
    }

    const appRequest = await AppRequest.create({
      email,
      appName,
      platform,
    });

    res.status(201).json({
      success: true,
      message: "App request submitted successfully",
      data: appRequest,
    });
  } catch (error) {
    console.error("Error creating app request:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit app request",
      error: error.message,
    });
  }
};

/**
 * Get all app access requests
 * @route GET /api/app-requests
 */
export const getAllAppRequests = async (req, res) => {
  try {
    const requests = await AppRequest.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      data: requests,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch app requests",
      error: error.message,
    });
  }
};
