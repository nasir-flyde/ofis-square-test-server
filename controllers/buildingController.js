import Building from "../models/buildingModel.js";
import imagekit from "../utils/imageKit.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const createBuilding = async (req, res) => {
  try {
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, pricing, photos } = req.body || {};

    if (!name || !address || !city) {
      return res.status(400).json({ success: false, message: "name, address and city are required" });
    }

    // Process uploaded photos from ImageKit
    const processedPhotos = [];
    if (photos && Array.isArray(photos)) {
      for (const photo of photos) {
        try {
          // Upload to ImageKit
          const uploadResult = await imagekit.upload({
            file: photo.file, // base64 string
            fileName: photo.name,
            folder: "/buildings",
            useUniqueFileName: true,
            tags: ["building", name.replace(/\s+/g, '-').toLowerCase()]
          });

          processedPhotos.push({
            fileId: uploadResult.fileId,
            name: uploadResult.name,
            url: uploadResult.url,
            thumbnailUrl: uploadResult.thumbnailUrl,
            size: uploadResult.size,
            filePath: uploadResult.filePath,
            uploadedAt: new Date()
          });
        } catch (uploadError) {
          console.warn("Failed to upload photo:", uploadError);
        }
      }
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
      pricing: pricing || {},
      photos: processedPhotos,
      openSpacePricing: req.body.openSpacePricing || 500
    });

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'Building', building._id, null, {
      buildingName: name,
      location: `${city}, ${state}`,
      totalFloors,
      photosCount: processedPhotos.length
    });

    res.status(201).json({ success: true, data: building });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBuildings = async (req, res) => {
  try {
    const { status, city } = req.query || {};
    const filter = {};
    if (status) filter.status = status;
    if (city) filter.city = city;

    const buildings = await Building.find().sort({ createdAt: -1 });
    
    res.json({ success: true, data: buildings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBuildingById = async (req, res) => {
  try {
    const { id } = req.params;
    const building = await Building.findById(id);
    
    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }
    
    res.json({ success: true, data: building });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBuilding = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, pricing } = req.body || {};

    const oldBuilding = await Building.findById(id);
    const building = await Building.findByIdAndUpdate(
      id,
      {
        name,
        address,
        city,
        state,
        country,
        pincode,
        totalFloors,
        amenities,
        status,
        pricing
      },
      { new: true, runValidators: true }
    );

    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    // Log activity with changes
    await logCRUDActivity(req, 'UPDATE', 'Building', id, {
      before: oldBuilding?.toObject(),
      after: building.toObject(),
      fields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, pricing })
    }, {
      buildingName: building.name,
      updatedFields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, pricing })
    });

    res.json({ success: true, data: building });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBuilding = async (req, res) => {
  try {
    const { id } = req.params;
    const building = await Building.findByIdAndDelete(id);

    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    // Log activity
    await logCRUDActivity(req, 'DELETE', 'Building', id, null, {
      buildingName: building.name,
      location: `${building.city}, ${building.state}`
    });

    res.json({ success: true, message: "Building deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
