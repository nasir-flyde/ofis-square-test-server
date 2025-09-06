import Building from "../models/buildingModel.js";

// Create a new building
export const createBuilding = async (req, res) => {
  try {
    const { name, address, city, state, country, pincode, totalFloors, amenities, status } = req.body || {};

    if (!name || !address || !city) {
      return res.status(400).json({ success: false, message: "name, address and city are required" });
    }

    const building = await Building.create({
      name,
      address,
      city,
      state,
      country,
      pincode,
      totalFloors,
      amenities,
      status,
    });

    return res.status(201).json({ success: true, data: building });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get buildings (optionally filter by status/city)
export const getBuildings = async (req, res) => {
  try {
    const { status, city } = req.query || {};
    const filter = {};
    if (status) filter.status = status;
    if (city) filter.city = city;

    const buildings = await Building.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, data: buildings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
