import Building from "../models/buildingModel.js";
import imagekit from "../utils/imageKit.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const createBuilding = async (req, res) => {
  try {
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos, latitude, longitude, businessMapLink } = req.body || {};

    if (!name || !address || !city) {
      return res.status(400).json({ success: false, message: "name, address and city are required" });
    }
    const processedPhotos = [];
    if (photos && Array.isArray(photos)) {
      for (const photo of photos) {
        try {
          const category = (photo.category || 'General').trim();
          if (photo?.file) {
            const uploadResult = await imagekit.upload({
              file: photo.file,
              fileName: photo.name || `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/buildings",
              useUniqueFileName: true,
              tags: ["building", name.replace(/\s+/g, '-').toLowerCase(), category.replace(/\s+/g, '-').toLowerCase()]
            });
            processedPhotos.push({
              category,
              imageUrl: uploadResult.url,
              uploadedAt: new Date()
            });
          } else if (photo?.imageUrl) {
            processedPhotos.push({
              category,
              imageUrl: photo.imageUrl,
              uploadedAt: new Date()
            });
          }
        } catch (uploadError) {
          console.warn("Failed to process photo:", uploadError);
        }
      }
    }

    const buildingData = {
      name,
      address,
      city,
      state,
      country,
      pincode,
      totalFloors,
      amenities,
      status,
      perSeatPricing,
      photos: processedPhotos,
      openSpacePricing: req.body.openSpacePricing || 500,
      businessMapLink
    };

    // Add coordinates object if provided
    if (longitude !== undefined && latitude !== undefined) {
      buildingData.coordinates = {
        longitude: parseFloat(longitude),
        latitude: parseFloat(latitude)
      };
      // Also add to location for geospatial queries
      buildingData.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)] // [longitude, latitude]
      };
    }

    const building = await Building.create(buildingData);

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

    const buildings = await Building.find(filter)
      .populate('amenities', 'name icon iconUrl description')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, data: buildings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBuildingById = async (req, res) => {
  try {
    const { id } = req.params;
    const building = await Building.findById(id)
      .populate('amenities', 'name icon iconUrl description');
    
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
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos, openSpacePricing, latitude, longitude, businessMapLink } = req.body || {};

    const oldBuilding = await Building.findById(id);

    // If photos provided, process them similarly to create. If not provided, don't change existing photos
    let processedPhotos;
    if (photos && Array.isArray(photos)) {
      processedPhotos = [];
      for (const photo of photos) {
        try {
          const category = (photo.category || 'General').trim();
          if (photo?.file) {
            const uploadResult = await imagekit.upload({
              file: photo.file,
              fileName: photo.name || `${(name || oldBuilding?.name || 'building').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/buildings",
              useUniqueFileName: true,
              tags: ["building", (name || oldBuilding?.name || 'building').replace(/\s+/g, '-').toLowerCase(), category.replace(/\s+/g, '-').toLowerCase()]
            });
            processedPhotos.push({ category, imageUrl: uploadResult.url, uploadedAt: new Date() });
          } else if (photo?.imageUrl) {
            processedPhotos.push({ category, imageUrl: photo.imageUrl, uploadedAt: new Date() });
          }
        } catch (uploadError) {
          console.warn("Failed to process photo:", uploadError);
        }
      }
    }

    const updatePayload = {
      name,
      address,
      city,
      state,
      country,
      pincode,
      totalFloors,
      amenities,
      status,
      perSeatPricing,
      openSpacePricing,
      businessMapLink
    };
    if (processedPhotos) {
      updatePayload.photos = processedPhotos;
    }

    // Update coordinates object if provided
    if (longitude !== undefined && latitude !== undefined) {
      updatePayload.coordinates = {
        longitude: parseFloat(longitude),
        latitude: parseFloat(latitude)
      };
      // Also update location for geospatial queries
      updatePayload.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)] // [longitude, latitude]
      };
    }

    const building = await Building.findByIdAndUpdate(
      id,
      updatePayload,
      { new: true, runValidators: true }
    );

    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    // Log activity with changes
    await logCRUDActivity(req, 'UPDATE', 'Building', id, {
      before: oldBuilding?.toObject(),
      after: building.toObject(),
      fields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos: processedPhotos ? 'updated' : undefined })
    }, {
      buildingName: building.name,
      updatedFields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos: processedPhotos ? 'updated' : undefined })
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

export const updateBuildingCreditValue = async (req, res) => {
  try {
    const { id } = req.params;
    const { creditValue } = req.body;

    if (creditValue === undefined) {
      return res.status(400).json({ success: false, message: "creditValue is required" });
    }

    if (creditValue < 0) {
      return res.status(400).json({ success: false, message: "creditValue must be non-negative" });
    }

    const oldBuilding = await Building.findById(id);
    if (!oldBuilding) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    const building = await Building.findByIdAndUpdate(
      id,
      { creditValue: parseFloat(creditValue) },
      { new: true, runValidators: true }
    );

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Building', id, {
      before: { creditValue: oldBuilding.creditValue },
      after: { creditValue: building.creditValue }
    }, {
      buildingName: building.name,
      updatedFields: ['creditValue'],
      oldValue: oldBuilding.creditValue,
      newValue: building.creditValue
    });

    res.json({ 
      success: true, 
      message: "Building credit value updated successfully",
      data: { 
        creditValue: building.creditValue,
        building: {
          id: building._id,
          name: building.name
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Activate a draft building
export const activateBuilding = async (req, res) => {
  try {
    const { id } = req.params;

    const building = await Building.findById(id);
    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    if (building.status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft buildings can be activated" });
    }

    // Validate required fields for activation
    if (!building.perSeatPricing || building.perSeatPricing <= 0) {
      return res.status(400).json({ success: false, message: "Per seat pricing must be set before activation" });
    }

    const updatedBuilding = await Building.findByIdAndUpdate(
      id,
      { status: "active" },
      { new: true, runValidators: true }
    );

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Building', id, {
      before: { status: building.status },
      after: { status: updatedBuilding.status }
    }, {
      buildingName: updatedBuilding.name,
      action: 'Activated building from draft',
      updatedFields: ['status']
    });

    res.json({ 
      success: true, 
      message: "Building activated successfully",
      data: updatedBuilding
    });
  } catch (error) {
    console.error("Error activating building:", error);
    await logErrorActivity(req, error, 'Activate Building');
    return res.status(500).json({ success: false, message: error.message });
  }
};
