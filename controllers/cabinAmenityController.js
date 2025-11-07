import CabinAmenity from "../models/cabinAmenityModel.js";
import imagekit from "../utils/imageKit.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const getCabinAmenities = async (req, res) => {
  try {
    const { isActive } = req.query || {};
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const amenities = await CabinAmenity.find(filter).sort({ name: 1 });
    
    res.json({ success: true, data: amenities });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCabinAmenityById = async (req, res) => {
  try {
    const { id } = req.params;
    const amenity = await CabinAmenity.findById(id);
    
    if (!amenity) {
      return res.status(404).json({ success: false, message: "Cabin amenity not found" });
    }
    
    res.json({ success: true, data: amenity });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCabinAmenity = async (req, res) => {
  try {
    const { name, icon, iconUrl, description, isActive } = req.body || {};

    if (!name) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    // Check for duplicate
    const existing = await CabinAmenity.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existing) {
      return res.status(409).json({ success: false, message: "Cabin amenity with this name already exists" });
    }

    // Process icon upload if base64 provided
    let processedIconUrl = iconUrl;
    if (icon && icon.startsWith('data:image')) {
      try {
        const uploadResult = await imagekit.upload({
          file: icon,
          fileName: `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`,
          folder: "/cabin-amenities",
          useUniqueFileName: true,
          tags: ["cabin-amenity", name.replace(/\s+/g, '-').toLowerCase()]
        });
        processedIconUrl = uploadResult.url;
      } catch (uploadError) {
        console.warn("Failed to upload icon:", uploadError);
      }
    }

    const amenity = await CabinAmenity.create({
      name,
      icon: processedIconUrl ? undefined : icon,
      iconUrl: processedIconUrl,
      description,
      isActive: isActive !== undefined ? isActive : true
    });

    await logCRUDActivity(req, 'CREATE', 'CabinAmenity', amenity._id, null, {
      name,
      hasIcon: !!processedIconUrl
    });

    res.status(201).json({ success: true, data: amenity });
  } catch (error) {
    await logErrorActivity(req, error, 'Create Cabin Amenity');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCabinAmenity = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, iconUrl, description, isActive } = req.body || {};

    const existingAmenity = await CabinAmenity.findById(id);
    if (!existingAmenity) {
      return res.status(404).json({ success: false, message: "Cabin amenity not found" });
    }

    // Check for duplicate name (excluding current amenity)
    if (name && name !== existingAmenity.name) {
      const duplicate = await CabinAmenity.findOne({ 
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        _id: { $ne: id }
      });
      if (duplicate) {
        return res.status(409).json({ success: false, message: "Cabin amenity with this name already exists" });
      }
    }

    // Process icon upload if base64 provided
    let processedIconUrl = iconUrl;
    if (icon && icon.startsWith('data:image')) {
      try {
        const uploadResult = await imagekit.upload({
          file: icon,
          fileName: `${(name || existingAmenity.name).replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`,
          folder: "/cabin-amenities",
          useUniqueFileName: true,
          tags: ["cabin-amenity", (name || existingAmenity.name).replace(/\s+/g, '-').toLowerCase()]
        });
        processedIconUrl = uploadResult.url;
      } catch (uploadError) {
        console.warn("Failed to upload icon:", uploadError);
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (processedIconUrl) {
      updateData.iconUrl = processedIconUrl;
      updateData.icon = undefined;
    } else if (icon !== undefined) {
      updateData.icon = icon;
    }
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    const amenity = await CabinAmenity.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    await logCRUDActivity(req, 'UPDATE', 'CabinAmenity', id, null, updateData);

    res.json({ success: true, data: amenity });
  } catch (error) {
    await logErrorActivity(req, error, 'Update Cabin Amenity');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCabinAmenity = async (req, res) => {
  try {
    const { id } = req.params;
    const amenity = await CabinAmenity.findByIdAndDelete(id);

    if (!amenity) {
      return res.status(404).json({ success: false, message: "Cabin amenity not found" });
    }

    await logCRUDActivity(req, 'DELETE', 'CabinAmenity', id, null, {
      name: amenity.name
    });

    res.json({ success: true, message: "Cabin amenity deleted successfully" });
  } catch (error) {
    await logErrorActivity(req, error, 'Delete Cabin Amenity');
    return res.status(500).json({ success: false, message: error.message });
  }
};
