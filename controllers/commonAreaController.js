import CommonArea from "../models/commonAreaModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import csv from "csv-parser";
import { Readable } from "stream";
import imagekit from "../utils/imageKit.js";

// Canonical area type mapping (CSV input -> model enum value)
const AREA_TYPE_CANONICAL = {
  CAFETERIA: "CAFETERIA",
  CORRIDOR: "CORRIDOR",
  LOBBY: "LOBBY",
  PANTRY: "PANTRY",
  LOUNGE: "LOUNGE",
  RECEPTION: "Reception",
  "SQUARE BOX": "Square Box",
  "PHONE BOOTH": "Phone Booth",
  "DAY PASS AREA": "Day Pass Area",
  OTHER: "OTHER",
};

// Validate and map matrixDeviceIds -> matrixDevices array
async function validateAndAttachDevices(payload) {
  if (Array.isArray(payload.matrixDeviceIds) && payload.matrixDeviceIds.length > 0) {
    const buildingId = payload.buildingId;
    if (!buildingId) {
      const err = new Error("buildingId is required when attaching matrix devices");
      err.statusCode = 400;
      throw err;
    }
    const ids = payload.matrixDeviceIds;
    const devices = await MatrixDevice.find({ _id: { $in: ids } })
      .select("_id buildingId status")
      .lean();
    const foundIds = new Set(devices.map((d) => String(d._id)));
    const missing = ids.map(String).filter((x) => !foundIds.has(x));
    if (missing.length) {
      const err = new Error(`Unknown matrix devices: ${missing.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }
    const invalid = devices.filter((d) => String(d.buildingId) !== String(buildingId));
    if (invalid.length) {
      const err = new Error("Matrix devices must belong to the same building as the common area");
      err.statusCode = 400;
      throw err;
    }
    const inactive = devices.filter((d) => d.status !== "active");
    if (inactive.length) {
      const err = new Error("Matrix devices must be active");
      err.statusCode = 400;
      throw err;
    }
    payload.matrixDevices = payload.matrixDeviceIds;
    delete payload.matrixDeviceIds;
  }
  return payload;
}

// Create
export const createCommonArea = async (req, res) => {
  try {
    const { images, ...payload } = req.body;
    const data = await validateAndAttachDevices({ ...payload });

    // Process images
    const processedImages = [];
    if (images && Array.isArray(images)) {
      const bld = await Building.findById(data.buildingId);
      for (const image of images) {
        try {
          const caption = (image.caption || '').trim();
          if (image?.file) {
            const uploadResult = await imagekit.upload({
              file: image.file,
              fileName: image.name || `${data.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/common-areas",
              useUniqueFileName: true,
              tags: ["common-area", data.name.replace(/\s+/g, '-').toLowerCase(), bld?.name.replace(/\s+/g, '-').toLowerCase()].filter(Boolean)
            });
            processedImages.push({ url: uploadResult.url, caption, isPrimary: image.isPrimary || false });
          } else if (image?.url) {
            processedImages.push({ url: image.url, caption, isPrimary: image.isPrimary || false });
          }
        } catch (uploadError) {
          console.warn("Failed to process image:", uploadError);
        }
      }
    }
    data.images = processedImages;

    const ca = await CommonArea.create(data);
    await logCRUDActivity(req, "CREATE", "CommonArea", ca._id, null, {
      name: ca.name,
      buildingId: ca.buildingId,
      areaType: ca.areaType,
    });
    return res.status(201).json({ success: true, data: ca });
  } catch (error) {
    await logErrorActivity(req, error, "CommonArea");
    return res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

// List with filters
export const listCommonAreas = async (req, res) => {
  try {
    const { buildingId, status, areaType, q } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (status) filter.status = status;
    if (areaType) filter.areaType = areaType;
    if (q) filter.name = { $regex: q, $options: "i" };

    const items = await CommonArea.find(filter)
      .populate("buildingId", "name address city")
      .populate("matrixDevices", "name device_id externalDeviceId")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    await logErrorActivity(req, error, "CommonArea");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get by ID
export const getCommonAreaById = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await CommonArea.findById(id)
      .populate("buildingId", "name address city")
      .populate("matrixDevices", "name device_id externalDeviceId");

    if (!item) return res.status(404).json({ success: false, message: "Common area not found" });

    // Log a read event for traceability (optional)
    await logCRUDActivity(req, "READ", "CommonArea", id, null, { name: item.name });

    return res.json({ success: true, data: item });
  } catch (error) {
    await logErrorActivity(req, error, "CommonArea");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update
export const updateCommonArea = async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await CommonArea.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: "Common area not found" });

    const { images, ...payload } = req.body;
    const updateData = { ...payload };
    // Ensure buildingId used for validation is the updated one if provided, else existing
    if (updateData.buildingId === undefined) updateData.buildingId = existing.buildingId;

    // Validate devices when matrixDeviceIds is present (can be empty array to clear)
    if (updateData.matrixDeviceIds !== undefined) {
      await validateAndAttachDevices(updateData);
    }

    // Process images
    if (images && Array.isArray(images)) {
      const processedImages = [];
      const bldId = updateData.buildingId || existing.buildingId;
      const bld = await Building.findById(bldId);
      for (const image of images) {
        try {
          const caption = (image.caption || '').trim();
          if (image?.file) {
            const uploadResult = await imagekit.upload({
              file: image.file,
              fileName: image.name || `${(updateData.name || existing.name).replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/common-areas",
              useUniqueFileName: true,
              tags: ["common-area", (updateData.name || existing.name).replace(/\s+/g, '-').toLowerCase(), bld?.name.replace(/\s+/g, '-').toLowerCase()].filter(Boolean)
            });
            processedImages.push({ url: uploadResult.url, caption, isPrimary: image.isPrimary || false });
          } else if (image?.url) {
            processedImages.push({ url: image.url, caption, isPrimary: image.isPrimary || false });
          }
        } catch (uploadError) {
          console.warn("Failed to process image:", uploadError);
        }
      }
      updateData.images = processedImages;
    }

    const updated = await CommonArea.findByIdAndUpdate(id, updateData, { new: true });
    await logCRUDActivity(req, "UPDATE", "CommonArea", id, null, {
      name: updated?.name,
      areaType: updated?.areaType,
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    await logErrorActivity(req, error, "CommonArea");
    return res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

// Delete
export const deleteCommonArea = async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await CommonArea.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Common area not found" });

    await logCRUDActivity(req, "DELETE", "CommonArea", id, null, { name: deleted.name });
    return res.json({ success: true, message: "Common area deleted" });
  } catch (error) {
    await logErrorActivity(req, error, "CommonArea");
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const exportMasterFileCommonAreas = async (req, res) => {
  try {
    const buildings = await Building.find().select('name').sort({ name: 1 });

    const areaTypes = Object.keys(AREA_TYPE_CANONICAL);
    const statuses = ["active", "inactive"];

    const masterData = {
      buildings: buildings.map(b => b.name),
      areaTypes,
      statuses
    };

    const sampleRows = [];
    if (buildings.length > 0) {
      sampleRows.push({
        buildingName: buildings[0].name,
        name: 'Main Cafeteria',
        areaType: 'CAFETERIA',
        floor: '1',
        zone: 'North',
        notes: 'Near entrance',
        description: 'Main dining area',
        status: 'active',
        image1: 'https://example.com/sample-cafe-1.jpg',
        image2: 'https://example.com/sample-cafe-2.jpg'
      });
      sampleRows.push({
        buildingName: buildings[0].name,
        name: 'Executive Lounge',
        areaType: 'LOUNGE',
        floor: '2',
        zone: 'East',
        notes: 'Access restricted',
        description: 'Premium lounge for members',
        status: 'active',
        image1: 'https://example.com/sample-lounge-1.jpg'
      });
    } else {
      sampleRows.push({
        buildingName: 'Main Building',
        name: 'Main Cafeteria',
        areaType: 'CAFETERIA',
        floor: '1',
        zone: 'North',
        notes: 'Near entrance',
        description: 'Main dining area',
        status: 'active',
        image1: 'https://example.com/sample-cafe.jpg'
      });
    }

    return res.json({
      success: true,
      data: {
        masterData,
        sampleRows
      }
    });
  } catch (error) {
    console.error('Error exporting master file:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const downloadSampleCSVCommonAreas = async (_req, res) => {
  try {
    const header = [
      'buildingName', 'name', 'areaType', 'floor', 'zone', 'notes', 'description', 'status', 'images', 'deviceId', 'deviceType'
    ];
    const sample1 = ['Main Building', 'Main Cafeteria', 'CAFETERIA', '1', 'North', 'Near entrance', 'Main dining area', 'active', 'https://example.com/cafe-1.jpg,https://example.com/cafe-2.jpg', 'd_10001', '16'];
    const sample2 = ['Main Building', 'Executive Lounge', 'LOUNGE', '2', 'East', 'Access restricted', 'Premium lounge', 'active', 'https://example.com/lounge-1.jpg', 'd_10002', '16'];

    const csvText = [header.join(','), sample1.join(','), sample2.join(',')].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="common_areas_import_sample.csv"');
    return res.send(csvText);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const importCommonAreasFromCSV = async (req, res) => {
  try {
    const file = req.file;
    const dryRun = String(req.query?.dryRun ?? req.body?.dryRun ?? 'false').toLowerCase() === 'true';
    if (!file) return res.status(400).json({ success: false, message: 'CSV file is required (field name: file)' });

    const rows = [];
    await new Promise((resolve, reject) => {
      try {
        const stream = Readable.from(file.buffer);
        stream
          .pipe(csv())
          .on('data', (data) => rows.push(data))
          .on('end', resolve)
          .on('error', reject);
      } catch (e) {
        reject(e);
      }
    });

    const toNumber = (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : undefined;
    };
    const norm = (s) => (s === undefined || s === null ? '' : String(s).trim());

    const parseBool = (v) => {
      if (v === undefined || v === null) return false;
      const s = String(v).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'y';
    };

    const parseImages = (obj) => {
      const combined = norm(obj.images);
      if (!combined) return [];

      const urls = combined.split(',').map(x => x.trim()).filter(Boolean);
      return urls.map((u, idx) => ({
        url: u,
        isPrimary: idx === 0,
      }));
    };

    // Caching buildings to avoid repeated lookups
    const buildings = await Building.find().select('name').lean();
    const buildingNameToId = new Map(buildings.map(b => [norm(b.name).toLowerCase(), String(b._id)]));

    const validAreaTypes = Object.keys(AREA_TYPE_CANONICAL);

    const perRow = [];
    let validCount = 0;
    let invalidCount = 0;
    let createdCount = 0;

    for (const [idx, originalRow] of rows.entries()) {
      try {
        const errors = [];
        const payload = {};

        // Building Lookup
        const bName = norm(originalRow.buildingName);
        const bId = originalRow.buildingId ? norm(originalRow.buildingId) : buildingNameToId.get(bName.toLowerCase());

        if (!bId && bName) {
          errors.push(`Building "${bName}" not found`);
        } else if (!bId && !bName) {
          errors.push("Building Name or Building ID is required");
        } else {
          payload.buildingId = bId;
        }

        // Name
        const name = norm(originalRow.name);
        if (!name) errors.push("Name is required");
        else payload.name = name;

        // Area Type
        const areaType = norm(originalRow.areaType).toUpperCase();
        if (areaType && !validAreaTypes.includes(areaType)) {
          errors.push(`Invalid Area Type: ${areaType}. Must be one of ${validAreaTypes.join(', ')}`);
        } else {
          payload.areaType = areaType ? AREA_TYPE_CANONICAL[areaType] : "OTHER";
        }

        // Description
        payload.description = norm(originalRow.description);

        // Location
        payload.location = {
          floor: toNumber(originalRow.floor),
          zone: norm(originalRow.zone),
          notes: norm(originalRow.notes)
        };

        // Status
        const status = norm(originalRow.status).toLowerCase();
        if (status && !['active', 'inactive'].includes(status)) {
          errors.push(`Invalid Status: ${status}. Must be active or inactive`);
        } else {
          payload.status = status || 'active';
        }

        // Images
        payload.images = parseImages(originalRow);

        // Matrix Device fields from CSV
        const rawDeviceInput = norm(originalRow.deviceId || originalRow.device_id || originalRow["device id"] || originalRow["Device ID"] || originalRow.device);
        const deviceTypeRaw = norm(originalRow.deviceType || originalRow["device type"] || originalRow["Device Type"]);
        let deviceType = toNumber(deviceTypeRaw);
        let deviceIdRaw = rawDeviceInput || '';
        let deviceIdNormalized = undefined;
        let numericDevice = undefined;

        if (rawDeviceInput) {
          const stripped = rawDeviceInput.startsWith('d_') ? rawDeviceInput.slice(2) : rawDeviceInput;
          deviceIdNormalized = rawDeviceInput.startsWith('d_') ? rawDeviceInput : `d_${stripped}`;
          const n = toNumber(stripped);
          if (n !== undefined) numericDevice = n;
          // default deviceType to 16 if not provided
          if (deviceType === undefined) deviceType = 16;
          const allowedTypes = new Set([1, 16, 17]);
          if (!allowedTypes.has(deviceType)) {
            errors.push(`Invalid deviceType: ${deviceType}. Allowed: 1, 16, 17`);
          }
        }

        if (errors.length > 0) {
          invalidCount++;
          perRow.push({ index: idx + 1, success: false, errors, originalRow });
          continue;
        }

        validCount++;
        if (dryRun) {
          payload.deviceId = deviceIdNormalized;
          payload.deviceType = deviceType;
          perRow.push({ index: idx + 1, success: true, preview: payload, originalRow });
          continue;
        }

        // Actual Import
        const ca = await CommonArea.create(payload);

        // If device details provided, find or create/link MatrixDevice
        if (deviceIdNormalized) {
          let deviceDoc = await MatrixDevice.findOne({
            $or: [
              { device_id: deviceIdNormalized },
              ...(numericDevice !== undefined ? [{ device: numericDevice }] : []),
              ...(deviceIdRaw && deviceIdRaw !== deviceIdNormalized ? [{ device_id: deviceIdRaw }] : [])
            ]
          });

          if (!deviceDoc) {
            deviceDoc = await MatrixDevice.create({
              buildingId: payload.buildingId,
              name: `Common Area ${payload.name} Device`,
              vendor: 'MATRIX_COSEC',
              deviceType: deviceType || 16,
              direction: 'BIDIRECTIONAL',
              device_id: deviceIdNormalized,
              device: numericDevice,
              status: 'Active',
              location: { floor: payload.location?.floor, zone: payload.location?.zone }
            });
          } else {
            // Check if device is already active in another building/place? 
            // For now, satisfy user request to implement "jst like its in importCabinsFromCSV"
            if (deviceDoc.status !== 'Active') {
              deviceDoc.status = 'Active';
              await deviceDoc.save();
            }
          }

          if (deviceDoc) {
            ca.matrixDevices = [deviceDoc._id];
            await ca.save();
          }
        }

        createdCount++;
        perRow.push({ index: idx + 1, success: true, id: ca._id, originalRow });
      } catch (e) {
        invalidCount++;
        const errMsg = e.code === 11000 ? "A conflict occurred (record might already exist)" : (e.message || 'Failed to create common area');
        perRow.push({ index: idx + 1, success: false, errors: [errMsg], originalRow });
      }
    }

    return res.json({
      success: true,
      dryRun,
      counts: { total: rows.length, valid: validCount, invalid: invalidCount, created: dryRun ? 0 : createdCount },
      results: perRow,
    });
  } catch (error) {
    await logErrorActivity(req, error, "CommonArea");
    return res.status(500).json({ success: false, message: error.message });
  }
};
