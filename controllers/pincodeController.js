import { findLocationByPincode } from "../utils/pincodeUtils.js";

export const getLocationByPincode = async (req, res) => {
  try {
    const { pincode } = req.params;

    if (!pincode) {
      return res.status(400).json({
        success: false,
        message: "Pincode is required",
      });
    }

    const locations = await findLocationByPincode(pincode);

    if (locations.length > 0) {
      const location = locations[0]; // Take the first match
      res.status(200).json({
        success: true,
        data: {
          pincode: location.Pincode,
          city: location.City,
          district: location.District,
          state: location.State,
        },
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Pincode not found",
      });
    }
  } catch (error) {
    console.error("Error fetching location by pincode:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
