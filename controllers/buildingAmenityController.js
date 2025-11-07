import BuildingAmenity from "../models/buildingAmenityModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const getBuildingAmenities = async (req, res) => {
  try {
    const { isActive, search } = req.query || {};
    const filter = {};
    
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }
    
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const amenities = await BuildingAmenity.find(filter).sort({ name: 1 });
    return res.json({ success: true, data: amenities });
  } catch (error) {
    console.error("Error fetching building amenities:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBuildingAmenity = async (req, res) => {
  try {
    const { id } = req.params;
    const amenity = await BuildingAmenity.findById(id);
    
    if (!amenity) {
      return res.status(404).json({ success: false, message: "Building amenity not found" });
    }
    
    return res.json({ success: true, data: amenity });
  } catch (error) {
    console.error("Error fetching building amenity:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createBuildingAmenity = async (req, res) => {
  try {
    const { name, icon, iconUrl, description, isActive } = req.body || {};

    if (!name) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    const existing = await BuildingAmenity.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
    if (existing) {
      return res.status(409).json({ success: false, message: "Amenity with this name already exists" });
    }

    const amenity = await BuildingAmenity.create({
      name,
      icon,
      iconUrl,
      description,
      isActive: isActive !== undefined ? isActive : true
    });

    await logCRUDActivity(req, 'CREATE', 'BuildingAmenity', amenity._id, null, {
      amenityName: name
    });

    res.status(201).json({ success: true, data: amenity });
  } catch (error) {
    console.error("Error creating building amenity:", error);
    await logErrorActivity(req, 'CREATE', 'BuildingAmenity', null, error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBuildingAmenity = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, iconUrl, description, isActive } = req.body || {};

    const oldAmenity = await BuildingAmenity.findById(id);
    if (!oldAmenity) {
      return res.status(404).json({ success: false, message: "Building amenity not found" });
    }

    // Check for duplicate name if name is being changed
    if (name && name !== oldAmenity.name) {
      const existing = await BuildingAmenity.findOne({ 
        name: { $regex: `^${name}$`, $options: 'i' },
        _id: { $ne: id }
      });
      if (existing) {
        return res.status(409).json({ success: false, message: "Amenity with this name already exists" });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (icon !== undefined) updateData.icon = icon;
    if (iconUrl !== undefined) updateData.iconUrl = iconUrl;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    const amenity = await BuildingAmenity.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    await logCRUDActivity(req, 'UPDATE', 'BuildingAmenity', id, {
      before: oldAmenity.toObject(),
      after: amenity.toObject()
    }, {
      amenityName: amenity.name
    });

    res.json({ success: true, data: amenity });
  } catch (error) {
    console.error("Error updating building amenity:", error);
    await logErrorActivity(req, 'UPDATE', 'BuildingAmenity', req.params.id, error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBuildingAmenity = async (req, res) => {
  try {
    const { id } = req.params;
    
    const amenity = await BuildingAmenity.findByIdAndDelete(id);
    
    if (!amenity) {
      return res.status(404).json({ success: false, message: "Building amenity not found" });
    }

    await logCRUDActivity(req, 'DELETE', 'BuildingAmenity', id, null, {
      amenityName: amenity.name
    });

    res.json({ success: true, message: "Building amenity deleted successfully" });
  } catch (error) {
    console.error("Error deleting building amenity:", error);
    await logErrorActivity(req, 'DELETE', 'BuildingAmenity', req.params.id, error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  getBuildingAmenities,
  getBuildingAmenity,
  createBuildingAmenity,
  updateBuildingAmenity,
  deleteBuildingAmenity
};
