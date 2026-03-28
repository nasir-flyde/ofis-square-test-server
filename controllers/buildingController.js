import Building from "../models/buildingModel.js";
import City from "../models/cityModel.js";
import imagekit from "../utils/imageKit.js";
import { createObjectCsvStringifier } from 'csv-writer';
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

/**
 * Normalizes nested keys from form-data (e.g., "photos[0][category]") into a proper nested object structure.
 * Also handles simple array notation like "amenities[]".
 */
const normalizeNestedBody = (body) => {
  const result = {};
  for (const key in body) {
    const value = body[key];
    if (key.includes('[') || key.includes(']')) {
      // Handle nested keys like "photos[0][category]" or "amenities[]"
      const parts = key.split(/[\[\]]+/).filter(Boolean);
      let current = result;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];
        const isArrayIndex = /^\d+$/.test(nextPart) || (nextPart === undefined && key.endsWith('[]'));

        if (!current[part]) {
          current[part] = (isArrayIndex || /^\d+$/.test(part)) ? [] : {};
        }

        if (i === parts.length - 1) {
          if (Array.isArray(current)) {
            current.push(value);
          } else {
            current[part] = value;
          }
        } else {
          current = current[part];
        }
      }
    } else {
      result[key] = value;
    }
  }
  return result;
};

export const exportBuildings = async (req, res) => {
  try {
    const { status, city } = req.query || {};
    const filter = {};
    if (status) filter.status = status;
    if (city) filter.city = city;

    const buildings = await Building.find(filter)
      .populate('city', 'name state')
      .populate('dayPassMatrixPolicyId', 'name')
      .populate('wifiAccess.enterpriseLevel.nasRefs', 'name ip')
      .populate('wifiAccess.daypass.nasRefs', 'name ip')
      .sort({ createdAt: -1 });

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'id', title: 'Building ID' },
        { id: 'name', title: 'Name' },
        { id: 'address', title: 'Address' },
        { id: 'city', title: 'City' },
        { id: 'state', title: 'State' },
        { id: 'country', title: 'Country' },
        { id: 'pincode', title: 'Pincode' },
        { id: 'location', title: 'Coordinates (Lat, Lng)' },
        { id: 'googleMapLink', title: 'Google Map Link' },

        { id: 'openingTime', title: 'Opening Time' },
        { id: 'closingTime', title: 'Closing Time' },
        { id: 'meetingCancellationGrace', title: 'Meeting Cancel Grace (min)' },

        { id: 'totalFloors', title: 'Total Floors' },
        { id: 'status', title: 'Status' },
        { id: 'amenities', title: 'Amenities' },

        // Pricing & Capacity
        { id: 'perSeatPricing', title: 'Per Seat Pricing' },
        { id: 'openSpacePricing', title: 'Open Space Pricing' },
        { id: 'dayPassCapacity', title: 'Day Pass Daily Capacity' },
        { id: 'creditValue', title: 'Credit Value' },
        { id: 'communityDiscount', title: 'Community Max Discount (%)' },

        // Invoice Settings
        { id: 'draftInvGen', title: 'Draft Invoice Generation' },
        { id: 'draftInvDay', title: 'Draft Invoice Day' },
        { id: 'draftInvDueDay', title: 'Draft Invoice Due Day' },
        { id: 'estSendDay', title: 'Estimate Send Day' },
        { id: 'invSendDay', title: 'Invoice Send Day' },
        { id: 'lateFeePolicy', title: 'Late Fee Policy' },

        // Security Deposit
        { id: 'sdThreshold', title: 'SD Threshold (%)' },
        { id: 'sdSettings', title: 'SD Note Settings' },

        // Integrations
        { id: 'wifiAccess', title: 'WiFi Access Config' },
        { id: 'wifiName', title: 'WiFi Name' },
        { id: 'dayPassPolicy', title: 'Day Pass Matrix Policy' },
        { id: 'zohoLocationId', title: 'Zoho Location ID' },
        { id: 'placeOfSupply', title: 'Place of Supply' },

        { id: 'photos', title: 'Photos' },
        { id: 'createdAt', title: 'Created At' },
        { id: 'updatedAt', title: 'Updated At' }
      ]
    });

    const records = buildings.map(b => {
      // Coordinates
      let coords = '';
      if (b.coordinates?.latitude && b.coordinates?.longitude) {
        coords = `${b.coordinates.latitude}, ${b.coordinates.longitude}`;
      } else if (b.location?.coordinates?.length === 2) {
        // GeoJSON is [lng, lat]
        coords = `${b.location.coordinates[1]}, ${b.location.coordinates[0]}`;
      }

      // Photos URLs
      const photoUrls = (b.photos || []).flatMap(p => (p.images || []).map(i => i.url)).join('; ');

      return {
        id: b._id,
        name: b.name || '',
        address: b.address || '',
        city: b.city || '',
        state: b.state || '',
        country: b.country || '',
        pincode: b.pincode || '',
        location: coords,
        googleMapLink: b.businessMapLink || '',

        openingTime: b.openingTime || '',
        closingTime: b.closingTime || '',
        meetingCancellationGrace: b.meetingCancellationGraceMinutes || 0,

        totalFloors: b.totalFloors || '',
        status: b.status || '',
        amenities: (b.amenities || []).map(a => a.name).join('; '),

        perSeatPricing: b.perSeatPricing || '',
        openSpacePricing: b.openSpacePricing || '',
        dayPassCapacity: b.dayPassDailyCapacity || 0,
        creditValue: b.creditValue || '',
        communityDiscount: b.communityDiscountMaxPercent || '',

        draftInvGen: b.draftInvoiceGeneration ? 'Yes' : 'No',
        draftInvDay: b.draftInvoiceDay || '',
        draftInvDueDay: b.draftInvoiceDueDay || '',
        estSendDay: b.estimateSendDay || '',
        invSendDay: b.invoiceSendDay || '',
        lateFeePolicy: JSON.stringify(b.lateFeePolicy || {}),

        sdThreshold: b.securityDepositThreshold || '',
        sdSettings: JSON.stringify(b.sdNoteSettings || {}),

        wifiAccess: JSON.stringify(b.wifiAccess || {}),
        wifiName: b.wifiAccess?.enterpriseLevel?.wifiName || '',
        dayPassPolicy: b.dayPassMatrixPolicyId?.name || b.dayPassMatrixPolicyId || '',
        zohoLocationId: b.zoho_books_location_id || '',
        placeOfSupply: b.place_of_supply || '',
        lateFeeItem: b.lateFeeItem?.name || b.lateFeeItem || '',

        photos: photoUrls,
        createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : '',
        updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : ''
      };
    });

    const header = csvStringifier.getHeaderString();
    const csvRecords = csvStringifier.stringifyRecords(records);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="buildings_full_export.csv"');
    res.send(header + csvRecords);

  } catch (error) {
    console.error("exportBuildings error:", error);
    res.status(500).send("Failed to export buildings");
  }
};

export const createBuilding = async (req, res) => {
  try {
    // Normalize body if it comes from form-data with nested keys
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      req.body = normalizeNestedBody(req.body);
    }

    const { name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos, latitude, longitude, businessMapLink, tdsSettings, communityDiscountMaxPercent, openingTime, closingTime, dayPassDailyCapacity, creditValue, draftInvoiceGeneration, draftInvoiceDay, draftInvoiceDueDay, securityDepositThreshold, meetingCancellationGraceMinutes, wifiAccess, zoho_books_location_id, place_of_supply, bankDetails, zohoChartsOfAccounts, lateFeePolicy, zoho_monthly_payment_item_id, zoho_tax_id, lateFeeItem } = req.body || {};

    if (!name || !address || !city) {
      return res.status(400).json({ success: false, message: "name, address and city are required" });
    }

    const processedPhotos = [];
    
    // 1. Process files from req.files (e.g. photos[0][file])
    const fileMap = new Map();
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        // Field name might be like "photos[0][file]"
        if (file.fieldname.startsWith('photos[')) {
          const match = file.fieldname.match(/photos\[(\d+)\]/);
          if (match) {
            const index = parseInt(match[1]);
            if (!fileMap.has(index)) fileMap.set(index, {});
            fileMap.get(index).file = file.buffer || file.path;
            fileMap.get(index).name = file.originalname;
          }
        }
      }
    }

    // 2. Combine files with metadata from photos array
    const photosToProcess = Array.isArray(photos) ? [...photos] : [];
    fileMap.forEach((fileInfo, index) => {
      if (!photosToProcess[index]) photosToProcess[index] = {};
      photosToProcess[index].file = fileInfo.file;
      photosToProcess[index].name = fileInfo.name || photosToProcess[index].name;
    });

    if (photosToProcess.length > 0) {
      const categoryMap = new Map();
      for (const photo of photosToProcess) {
        try {
          if (photo.category && Array.isArray(photo.images)) {
            const category = photo.category.trim();
            const images = photo.images.map(img => ({
              url: img.url || img.imageUrl,
              uploadedAt: img.uploadedAt || new Date()
            })).filter(img => img.url);
            if (images.length > 0) {
              if (!categoryMap.has(category)) categoryMap.set(category, []);
              categoryMap.get(category).push(...images);
            }
            continue;
          }

          const category = (photo.category || 'General').trim();
          let url = '';
          if (photo?.file) {
            const uploadResult = await imagekit.upload({
              file: photo.file,
              fileName: photo.name || `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/buildings",
              useUniqueFileName: true,
              tags: ["building", name.replace(/\s+/g, '-').toLowerCase(), category.replace(/\s+/g, '-').toLowerCase()]
            });
            url = uploadResult.url;
          } else if (photo?.imageUrl) {
            url = photo.imageUrl;
          }

          if (url) {
            if (!categoryMap.has(category)) categoryMap.set(category, []);
            categoryMap.get(category).push({ url, uploadedAt: new Date() });
          }
        } catch (uploadError) {
          console.warn("Failed to process photo:", uploadError);
        }
      }
      for (const [category, images] of categoryMap.entries()) {
        processedPhotos.push({ category, images });
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
      meetingCancellationGraceMinutes,
      photos: processedPhotos,
      openSpacePricing: req.body.openSpacePricing || 500,
      businessMapLink,
      ...(zoho_books_location_id !== undefined && { zoho_books_location_id: zoho_books_location_id || null }),
      ...(place_of_supply !== undefined && { place_of_supply: place_of_supply || null }),
      bankDetails: bankDetails || undefined,
      zohoChartsOfAccounts: zohoChartsOfAccounts || undefined,
      lateFeePolicy: lateFeePolicy || undefined,
      zoho_monthly_payment_item_id: zoho_monthly_payment_item_id || "",
      zoho_tax_id: zoho_tax_id || "",
      lateFeeItem: lateFeeItem || undefined,
      wifiAccess: wifiAccess || undefined
    };

    if (communityDiscountMaxPercent !== undefined) {
      const v = Number(communityDiscountMaxPercent);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return res.status(400).json({ success: false, message: "communityDiscountMaxPercent must be a number between 0 and 100" });
      }
      buildingData.communityDiscountMaxPercent = v;
    }

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
          if (typeof tdsSettings.integration.zohoBooks.withholdingTaxId === 'string') sanitizedTds.integration.zohoBooks.withholdingTaxId = tdsSettings.integration.zohoBooks.withholdingTaxId;
          if (['before_tax', 'after_tax'].includes(tdsSettings.integration.zohoBooks.computeOn)) sanitizedTds.integration.zohoBooks.computeOn = tdsSettings.integration.zohoBooks.computeOn;
        }
      }
      if (Object.keys(sanitizedTds).length > 0) {
        buildingData.tdsSettings = sanitizedTds;
      }
    }

    if (longitude !== undefined && latitude !== undefined) {
      buildingData.coordinates = {
        longitude: parseFloat(longitude),
        latitude: parseFloat(latitude)
      };
      buildingData.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)] // [longitude, latitude]
      };
    }

    // Add default wifiAccess for Gurugram
    if (city) {
      const cityDoc = await City.findById(city);
      if (cityDoc) {
        const cityName = cityDoc.name.toLowerCase().trim();
        if (cityName === "gurugram" || cityName === "gururgram") {
          buildingData.wifiAccess = {
            enterpriseLevel: {
              enabled: true,
              nasRefs: [
                "696dde95dac2caa5fbbca8b9",
                "696dde95dac2caa5fbbca8ba",
                "696dde95dac2caa5fbbca8bb",
                "696dde95dac2caa5fbbca8bc",
                "696dde95dac2caa5fbbca8bd"
              ],
              defaultValidityDays: 30
            },
            daypass: {
              enabled: true,
              nasRefs: [
                "696dde95dac2caa5fbbca8bc"
              ]
            }
          };
        }
      }
    }

    if (openingTime) buildingData.openingTime = String(openingTime);
    if (closingTime) buildingData.closingTime = String(closingTime);

    if (dayPassDailyCapacity !== undefined) {
      const cap = Number(dayPassDailyCapacity);
      if (!Number.isFinite(cap) || cap < 0) {
        return res.status(400).json({ success: false, message: "dayPassDailyCapacity must be a non-negative number" });
      }
      buildingData.dayPassDailyCapacity = cap;
    }

    if (creditValue !== undefined) {
      const cv = Number(creditValue);
      if (!Number.isFinite(cv) || cv < 0) {
        return res.status(400).json({ success: false, message: "creditValue must be a non-negative number" });
      }
      buildingData.creditValue = cv;
    }

    if (typeof draftInvoiceGeneration === 'boolean') {
      buildingData.draftInvoiceGeneration = draftInvoiceGeneration;
    }
    if (draftInvoiceDay !== undefined) {
      const dd = Number(draftInvoiceDay);
      if (!Number.isFinite(dd) || dd < 1 || dd > 31) {
        return res.status(400).json({ success: false, message: "draftInvoiceDay must be between 1 and 31" });
      }
      buildingData.draftInvoiceDay = dd;
    }
    if (draftInvoiceDueDay !== undefined) {
      const ddd = Number(draftInvoiceDueDay);
      if (!Number.isFinite(ddd) || ddd < 1 || ddd > 31) {
        return res.status(400).json({ success: false, message: "draftInvoiceDueDay must be between 1 and 31" });
      }
      buildingData.draftInvoiceDueDay = ddd;
    }

    if (securityDepositThreshold !== undefined) {
      const sdt = Number(securityDepositThreshold);
      if (!Number.isFinite(sdt) || sdt < 0) {
        return res.status(400).json({ success: false, message: "securityDepositThreshold must be a non-negative number" });
      }
      buildingData.securityDepositThreshold = sdt;
    }

    const building = await Building.create(buildingData);

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
      .populate('city', 'name state')
      .populate('lateFeeItem', 'name zoho_item_id')
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
      .populate('city', 'name state')
      .populate('lateFeeItem', 'name zoho_item_id');

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
    
    // Normalize body if it comes from form-data with nested keys
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      req.body = normalizeNestedBody(req.body);
    }

    const { name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos, openSpacePricing, latitude, longitude, businessMapLink, tdsSettings, communityDiscountMaxPercent, openingTime, closingTime, dayPassDailyCapacity, creditValue, draftInvoiceGeneration, draftInvoiceDay, draftInvoiceDueDay, securityDepositThreshold, wifiAccess, meetingCancellationGraceMinutes, zoho_books_location_id, place_of_supply, bankDetails, zohoChartsOfAccounts, lateFeePolicy, zoho_monthly_payment_item_id, zoho_tax_id, lateFeeItem } = req.body || {};

    const oldBuilding = await Building.findById(id);

    let processedPhotos;
    
    // Handle files in update similar to create
    const photosToProcess = Array.isArray(photos) ? [...photos] : (photos ? [photos] : undefined);
    if (req.files && req.files.length > 0 && photosToProcess) {
      for (const file of req.files) {
        if (file.fieldname.startsWith('photos[')) {
          const match = file.fieldname.match(/photos\[(\d+)\]/);
          if (match) {
            const index = parseInt(match[1]);
            if (photosToProcess[index]) {
              photosToProcess[index].file = file.buffer || file.path;
              photosToProcess[index].name = file.originalname;
            }
          }
        }
      }
    }

    if (photosToProcess && Array.isArray(photosToProcess)) {
      processedPhotos = [];
      const categoryMap = new Map();
      for (const photo of photosToProcess) {
        try {
          if (photo.category && Array.isArray(photo.images)) {
            const category = photo.category.trim();
            const images = photo.images.map(img => ({
              url: img.url || img.imageUrl,
              uploadedAt: img.uploadedAt || new Date()
            })).filter(img => img.url);
            if (images.length > 0) {
              if (!categoryMap.has(category)) categoryMap.set(category, []);
              categoryMap.get(category).push(...images);
            }
            continue;
          }

          const category = (photo.category || 'General').trim();
          let url = '';
          if (photo?.file) {
            const uploadResult = await imagekit.upload({
              file: photo.file,
              fileName: photo.name || `${(name || oldBuilding?.name || 'building').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/buildings",
              useUniqueFileName: true,
              tags: ["building", (name || oldBuilding?.name || 'building').replace(/\s+/g, '-').toLowerCase(), category.replace(/\s+/g, '-').toLowerCase()]
            });
            url = uploadResult.url;
          } else if (photo?.imageUrl) {
            url = photo.imageUrl;
          }

          if (url) {
            if (!categoryMap.has(category)) categoryMap.set(category, []);
            categoryMap.get(category).push({ url, uploadedAt: new Date() });
          }
        } catch (uploadError) {
          console.warn("Failed to process photo:", uploadError);
        }
      }
      for (const [category, images] of categoryMap.entries()) {
        processedPhotos.push({ category, images });
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
      businessMapLink,
      ...(zoho_books_location_id !== undefined && { zoho_books_location_id: zoho_books_location_id || null }),
      ...(place_of_supply !== undefined && { place_of_supply: place_of_supply || null }),
      bankDetails: bankDetails !== undefined ? bankDetails : undefined,
      zohoChartsOfAccounts: zohoChartsOfAccounts !== undefined ? zohoChartsOfAccounts : undefined,
      lateFeePolicy: lateFeePolicy !== undefined ? lateFeePolicy : undefined,
      zoho_monthly_payment_item_id: zoho_monthly_payment_item_id !== undefined ? zoho_monthly_payment_item_id : undefined,
      zoho_tax_id: zoho_tax_id !== undefined ? zoho_tax_id : undefined,
      lateFeeItem: lateFeeItem !== undefined ? lateFeeItem : undefined
    };
    if (processedPhotos) {
      updatePayload.photos = processedPhotos;
    }

    if (communityDiscountMaxPercent !== undefined) {
      const v = Number(communityDiscountMaxPercent);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return res.status(400).json({ success: false, message: "communityDiscountMaxPercent must be a number between 0 and 100" });
      }
      updatePayload.communityDiscountMaxPercent = v;
    }

    if (longitude !== undefined && latitude !== undefined) {
      updatePayload.coordinates = {
        longitude: parseFloat(longitude),
        latitude: parseFloat(latitude)
      };
      updatePayload.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)] // [longitude, latitude]
      };
    }

    if (openingTime !== undefined) updatePayload.openingTime = String(openingTime);
    if (closingTime !== undefined) updatePayload.closingTime = String(closingTime);

    if (dayPassDailyCapacity !== undefined) {
      const cap = Number(dayPassDailyCapacity);
      if (!Number.isFinite(cap) || cap < 0) {
        return res.status(400).json({ success: false, message: "dayPassDailyCapacity must be a non-negative number" });
      }
      updatePayload.dayPassDailyCapacity = cap;
    }

    if (creditValue !== undefined) {
      const cv = Number(creditValue);
      if (!Number.isFinite(cv) || cv < 0) {
        return res.status(400).json({ success: false, message: "creditValue must be a non-negative number" });
      }
      updatePayload.creditValue = cv;
    }

    if (draftInvoiceGeneration !== undefined) {
      updatePayload.draftInvoiceGeneration = Boolean(draftInvoiceGeneration);
    }
    if (draftInvoiceDay !== undefined) {
      const dd = Number(draftInvoiceDay);
      if (!Number.isFinite(dd) || dd < 1 || dd > 31) {
        return res.status(400).json({ success: false, message: "draftInvoiceDay must be between 1 and 31" });
      }
      updatePayload.draftInvoiceDay = dd;
    }
    if (draftInvoiceDueDay !== undefined) {
      const ddd = Number(draftInvoiceDueDay);
      if (!Number.isFinite(ddd) || ddd < 1 || ddd > 31) {
        return res.status(400).json({ success: false, message: "draftInvoiceDueDay must be between 1 and 31" });
      }
      updatePayload.draftInvoiceDueDay = ddd;
    }

    if (securityDepositThreshold !== undefined) {
      const sdt = Number(securityDepositThreshold);
      if (!Number.isFinite(sdt) || sdt < 0) {
        return res.status(400).json({ success: false, message: "securityDepositThreshold must be a non-negative number" });
      }
      updatePayload.securityDepositThreshold = sdt;
    }

    if (meetingCancellationGraceMinutes !== undefined) {
      updatePayload.meetingCancellationGraceMinutes = Number(meetingCancellationGraceMinutes);
    }
    if (meetingCancellationGraceMinutes !== undefined) {
      updatePayload.meetingCancellationGraceMinutes = Number(meetingCancellationGraceMinutes);
    }
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
          if (typeof tdsSettings.integration.zohoBooks.withholdingTaxId === 'string') sanitizedTds.integration.zohoBooks.withholdingTaxId = tdsSettings.integration.zohoBooks.withholdingTaxId;
          if (['before_tax', 'after_tax'].includes(tdsSettings.integration.zohoBooks.computeOn)) sanitizedTds.integration.zohoBooks.computeOn = tdsSettings.integration.zohoBooks.computeOn;
        }
      }
      updatePayload.tdsSettings = sanitizedTds;
    }
    if (wifiAccess !== undefined) {
      const sanitized = {};
      if (wifiAccess.enterpriseLevel && typeof wifiAccess.enterpriseLevel === 'object') {
        sanitized.enterpriseLevel = {};
        if (typeof wifiAccess.enterpriseLevel.enabled === 'boolean') {
          sanitized.enterpriseLevel.enabled = wifiAccess.enterpriseLevel.enabled;
        }
        if (Array.isArray(wifiAccess.enterpriseLevel.nasRefs)) {
          sanitized.enterpriseLevel.nasRefs = wifiAccess.enterpriseLevel.nasRefs.filter(Boolean);
        }
        if (typeof wifiAccess.enterpriseLevel.defaultProfile === 'string') {
          sanitized.enterpriseLevel.defaultProfile = wifiAccess.enterpriseLevel.defaultProfile;
        }
        if (typeof wifiAccess.enterpriseLevel.wifiName === 'string') {
          sanitized.enterpriseLevel.wifiName = wifiAccess.enterpriseLevel.wifiName;
        }
        if (wifiAccess.enterpriseLevel.defaultValidityDays !== undefined) {
          const d = Number(wifiAccess.enterpriseLevel.defaultValidityDays);
          if (!Number.isFinite(d) || d <= 0) {
            return res.status(400).json({ success: false, message: 'wifiAccess.enterpriseLevel.defaultValidityDays must be a positive number' });
          }
          sanitized.enterpriseLevel.defaultValidityDays = d;
        }
      }
      if (wifiAccess.daypass && typeof wifiAccess.daypass === 'object') {
        sanitized.daypass = {};
        if (typeof wifiAccess.daypass.enabled === 'boolean') {
          sanitized.daypass.enabled = wifiAccess.daypass.enabled;
        }
        if (Array.isArray(wifiAccess.daypass.nasRefs)) {
          sanitized.daypass.nasRefs = wifiAccess.daypass.nasRefs.filter(Boolean);
        }
      }
      updatePayload.wifiAccess = sanitized;
    }

    const building = await Building.findByIdAndUpdate(
      id,
      updatePayload,
      { new: true, runValidators: true }
    );

    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    await logCRUDActivity(req, 'UPDATE', 'Building', id, {
      before: oldBuilding?.toObject(),
      after: building.toObject(),
      fields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos: processedPhotos ? 'updated' : undefined, tdsSettings: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'tdsSettings')) ? 'updated' : undefined, communityDiscountMaxPercent: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'communityDiscountMaxPercent')) ? 'updated' : undefined, openingTime: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'openingTime')) ? 'updated' : undefined, closingTime: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'closingTime')) ? 'updated' : undefined, dayPassDailyCapacity: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'dayPassDailyCapacity')) ? 'updated' : undefined, creditValue: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'creditValue')) ? 'updated' : undefined, draftInvoiceGeneration: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'draftInvoiceGeneration')) ? 'updated' : undefined, draftInvoiceDay: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'draftInvoiceDay')) ? 'updated' : undefined, draftInvoiceDueDay: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'draftInvoiceDueDay')) ? 'updated' : undefined, securityDepositThreshold: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'securityDepositThreshold')) ? 'updated' : undefined, wifiAccess: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'wifiAccess')) ? 'updated' : undefined })
    }, {
      buildingName: building.name,
      updatedFields: Object.keys({ name, address, city, state, country, pincode, totalFloors, amenities, status, perSeatPricing, photos: processedPhotos ? 'updated' : undefined, tdsSettings: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'tdsSettings')) ? 'updated' : undefined, communityDiscountMaxPercent: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'communityDiscountMaxPercent')) ? 'updated' : undefined, openingTime: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'openingTime')) ? 'updated' : undefined, closingTime: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'closingTime')) ? 'updated' : undefined, dayPassDailyCapacity: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'dayPassDailyCapacity')) ? 'updated' : undefined, creditValue: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'creditValue')) ? 'updated' : undefined, draftInvoiceGeneration: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'draftInvoiceGeneration')) ? 'updated' : undefined, draftInvoiceDay: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'draftInvoiceDay')) ? 'updated' : undefined, draftInvoiceDueDay: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'draftInvoiceDueDay')) ? 'updated' : undefined, securityDepositThreshold: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'securityDepositThreshold')) ? 'updated' : undefined, wifiAccess: (req.body && Object.prototype.hasOwnProperty.call(req.body, 'wifiAccess')) ? 'updated' : undefined })
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

    if (!building.perSeatPricing || building.perSeatPricing <= 0) {
      return res.status(400).json({ success: false, message: "Per seat pricing must be set before activation" });
    }

    const updatedBuilding = await Building.findByIdAndUpdate(
      id,
      { status: "active" },
      { new: true, runValidators: true }
    );

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

    await logCRUDActivity(
      req,
      'UPDATE',
      'Building',
      id,
      { before, after: building.toObject(), fields: Object.keys(updatePayload) },
      { buildingName: building.name, updatedFields: Object.keys(updatePayload) }
    );

    try {
      if (updatePayload.lateFeePolicy) {
        recomputeLateFeesForBuilding(id).catch(() => { });
      }
    } catch (_) { }

    return res.json({ success: true, message: "Invoice settings updated", data: building });
  } catch (error) {
    console.error("updateBuildingInvoiceSettings error:", error);
    await logErrorActivity(req, error, 'Update Building Invoice Settings');
    return res.status(500).json({ success: false, message: error.message });
  }
};