import Building from "../models/buildingModel.js";
import imagekit from "../utils/imageKit.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const createBuilding = async (req, res) => {
  try {
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, pricing, photos, latitude, longitude } = req.body || {};

    if (!name || !address || !city) {
      return res.status(400).json({ success: false, message: "name, address and city are required" });
    }

    // Process photos: support either base64 uploads (photo.file) or direct URLs (photo.imageUrl)
    const processedPhotos = [];
    if (photos && Array.isArray(photos)) {
      for (const photo of photos) {
        try {
          const category = (photo.category || 'General').trim();
          if (photo?.file) {
            const uploadResult = await imagekit.upload({
              file: photo.file, // base64 string
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
      pricing: pricing || {},
      photos: processedPhotos,
      openSpacePricing: req.body.openSpacePricing || 500
    };

    // Add location coordinates if provided
    if (longitude !== undefined && latitude !== undefined) {
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
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, pricing, photos, openSpacePricing, latitude, longitude } = req.body || {};

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
      pricing,
      openSpacePricing
    };
    if (processedPhotos) {
      updatePayload.photos = processedPhotos;
    }

    // Update location coordinates if provided
    if (longitude !== undefined && latitude !== undefined) {
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
      fields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, pricing, photos: processedPhotos ? 'updated' : undefined })
    }, {
      buildingName: building.name,
      updatedFields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, pricing, photos: processedPhotos ? 'updated' : undefined })
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
