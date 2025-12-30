import Building from "../models/buildingModel.js";
import imagekit from "../utils/imageKit.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const createBuilding = async (req, res) => {
  try {
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos, latitude, longitude, businessMapLink, tdsSettings } = req.body || {};

// Update per-building invoice settings (draft invoice schedule and late fee policy)


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

    // Attach sanitized TDS settings if provided
    if (tdsSettings && typeof tdsSettings === 'object') {
      const sanitizedTds = {};
      if (typeof tdsSettings.enabled === 'boolean') sanitizedTds.enabled = tdsSettings.enabled;
      if (['sales', 'purchases', 'both'].includes(tdsSettings.applyOn)) sanitizedTds.applyOn = tdsSettings.applyOn;
      if (['before_tax', 'after_tax'].includes(tdsSettings.calculationBase)) sanitizedTds.calculationBase = tdsSettings.calculationBase;
      if (['194C', '194H', '194I', '194J', '194Q', 'OTHER'].includes(tdsSettings.defaultSection)) sanitizedTds.defaultSection = tdsSettings.defaultSection;
      if (tdsSettings.defaultRatePercent !== undefined) {
        const r = Number(tdsSettings.defaultRatePercent);
        if (Number.isFinite(r) && r >= 0 && r <= 100) sanitizedTds.defaultRatePercent = r;
      }
      if (tdsSettings.thresholdAnnualAmount !== undefined) {
        const th = Number(tdsSettings.thresholdAnnualAmount);
        if (Number.isFinite(th) && th >= 0) sanitizedTds.thresholdAnnualAmount = th;
      }
      if (['none', 'nearest', 'up', 'down'].includes(tdsSettings.roundOffMode)) sanitizedTds.roundOffMode = tdsSettings.roundOffMode;
      if (typeof tdsSettings.notes === 'string') sanitizedTds.notes = tdsSettings.notes;
      if (tdsSettings.integration && typeof tdsSettings.integration === 'object') {
        sanitizedTds.integration = {};
        if (tdsSettings.integration.zohoBooks && typeof tdsSettings.integration.zohoBooks === 'object') {
          sanitizedTds.integration.zohoBooks = {};
          if (typeof tdsSettings.integration.zohoBooks.enabled === 'boolean') sanitizedTds.integration.zohoBooks.enabled = tdsSettings.integration.zohoBooks.enabled;
          if (typeof tdsSettings.integration.zohoBooks.withholdingTaxName === 'string') sanitizedTds.integration.zohoBooks.withholdingTaxName = tdsSettings.integration.zohoBooks.withholdingTaxName;
          if (['before_tax', 'after_tax'].includes(tdsSettings.integration.zohoBooks.computeOn)) sanitizedTds.integration.zohoBooks.computeOn = tdsSettings.integration.zohoBooks.computeOn;
        }
      }
      if (Object.keys(sanitizedTds).length > 0) {
        buildingData.tdsSettings = sanitizedTds;
      }
    }

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
    const { name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos, openSpacePricing, latitude, longitude, businessMapLink, tdsSettings } = req.body || {};

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

    // Update TDS settings if provided
    if (tdsSettings !== undefined) {
      const sanitizedTds = {};
      if (typeof tdsSettings?.enabled === 'boolean') sanitizedTds.enabled = tdsSettings.enabled;
      if (['sales', 'purchases', 'both'].includes(tdsSettings?.applyOn)) sanitizedTds.applyOn = tdsSettings.applyOn;
      if (['before_tax', 'after_tax'].includes(tdsSettings?.calculationBase)) sanitizedTds.calculationBase = tdsSettings.calculationBase;
      if (['194C', '194H', '194I', '194J', '194Q', 'OTHER'].includes(tdsSettings?.defaultSection)) sanitizedTds.defaultSection = tdsSettings.defaultSection;
      if (tdsSettings?.defaultRatePercent !== undefined) {
        const r = Number(tdsSettings.defaultRatePercent);
        if (!Number.isFinite(r) || r < 0 || r > 100) {
          return res.status(400).json({ success: false, message: "tdsSettings.defaultRatePercent must be 0-100" });
        }
        sanitizedTds.defaultRatePercent = r;
      }
      if (tdsSettings?.thresholdAnnualAmount !== undefined) {
        const th = Number(tdsSettings.thresholdAnnualAmount);
        if (!Number.isFinite(th) || th < 0) {
          return res.status(400).json({ success: false, message: "tdsSettings.thresholdAnnualAmount must be a non-negative number" });
        }
        sanitizedTds.thresholdAnnualAmount = th;
      }
      if (['none', 'nearest', 'up', 'down'].includes(tdsSettings?.roundOffMode)) sanitizedTds.roundOffMode = tdsSettings.roundOffMode;
      if (typeof tdsSettings?.notes === 'string') sanitizedTds.notes = tdsSettings.notes;
      if (tdsSettings?.integration && typeof tdsSettings.integration === 'object') {
        sanitizedTds.integration = {};
        if (tdsSettings.integration.zohoBooks && typeof tdsSettings.integration.zohoBooks === 'object') {
          sanitizedTds.integration.zohoBooks = {};
          if (typeof tdsSettings.integration.zohoBooks.enabled === 'boolean') sanitizedTds.integration.zohoBooks.enabled = tdsSettings.integration.zohoBooks.enabled;
          if (typeof tdsSettings.integration.zohoBooks.withholdingTaxName === 'string') sanitizedTds.integration.zohoBooks.withholdingTaxName = tdsSettings.integration.zohoBooks.withholdingTaxName;
          if (['before_tax', 'after_tax'].includes(tdsSettings.integration.zohoBooks.computeOn)) sanitizedTds.integration.zohoBooks.computeOn = tdsSettings.integration.zohoBooks.computeOn;
        }
      }
      updatePayload.tdsSettings = sanitizedTds;
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
      fields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos: processedPhotos ? 'updated' : undefined, tdsSettings: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'tdsSettings')) ? 'updated' : undefined })
    }, {
      buildingName: building.name,
      updatedFields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos: processedPhotos ? 'updated' : undefined, tdsSettings: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'tdsSettings')) ? 'updated' : undefined })
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
export const updateBuildingInvoiceSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      draftInvoiceGeneration,
      draftInvoiceDay,
      draftInvoiceDueDay,
      lateFeePolicy
    } = req.body || {};

    const building = await Building.findById(id);
    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    // Build update payload with validation
    const updatePayload = {};

    if (typeof draftInvoiceGeneration === 'boolean') {
      updatePayload.draftInvoiceGeneration = draftInvoiceGeneration;
    }

    if (draftInvoiceDay !== undefined) {
      const day = Number(draftInvoiceDay);
      if (!Number.isFinite(day) || day < 1 || day > 31) {
        return res.status(400).json({ success: false, message: "draftInvoiceDay must be a number between 1 and 31" });
      }
      updatePayload.draftInvoiceDay = day;
    }

    if (draftInvoiceDueDay !== undefined) {
      const dueDay = Number(draftInvoiceDueDay);
      if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) {
        return res.status(400).json({ success: false, message: "draftInvoiceDueDay must be a number between 1 and 31" });
      }
      updatePayload.draftInvoiceDueDay = dueDay;
    }

    if (lateFeePolicy !== undefined) {
      const policy = lateFeePolicy || {};
      const enabled = policy.enabled === undefined ? building.lateFeePolicy?.enabled : Boolean(policy.enabled);
      const grace = policy.gracePeriodDays === undefined ? building.lateFeePolicy?.gracePeriodDays : Number(policy.gracePeriodDays);
      const customFormula = policy.customFormula === undefined ? building.lateFeePolicy?.customFormula : policy.customFormula;
      const variables = policy.variables === undefined ? building.lateFeePolicy?.variables : policy.variables;

      if (grace !== undefined && (!Number.isFinite(grace) || grace < 0)) {
        return res.status(400).json({ success: false, message: "lateFeePolicy.gracePeriodDays must be a non-negative number" });
      }

      updatePayload.lateFeePolicy = {
        enabled,
        gracePeriodDays: grace ?? 0,
        customFormula: customFormula || undefined,
        variables: variables || undefined,
      };
    }

    const before = building.toObject();
    Object.assign(building, updatePayload);
    await building.save();

    // Log activity
    await logCRUDActivity(
      req,
      'UPDATE',
      'Building',
      id,
      { before, after: building.toObject(), fields: Object.keys(updatePayload) },
      { buildingName: building.name, updatedFields: Object.keys(updatePayload) }
    );

    // If lateFeePolicy was updated, trigger background recompute for last month provisional fees
    try {
      if (updatePayload.lateFeePolicy) {
        // Fire and forget; don't block response
        recomputeLateFeesForBuilding(id).catch(() => {});
      }
    } catch (_) {}

    return res.json({ success: true, message: "Invoice settings updated", data: building });
  } catch (error) {
    console.error("updateBuildingInvoiceSettings error:", error);
    await logErrorActivity(req, error, 'Update Building Invoice Settings');
    return res.status(500).json({ success: false, message: error.message });
  }
};