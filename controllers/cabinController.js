import Cabin from "../models/cabinModel.js";
import Building from "../models/buildingModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import Desk from "../models/deskModel.js";
import imagekit from "../utils/imageKit.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import csv from "csv-parser";
import { Readable } from "stream";

export const getCabins = async (req, res) => {
  try {
    const { building, floor, status, type } = req.query || {};
    const filter = {};
    if (building) filter.building = building;
    if (floor !== undefined) filter.floor = Number(floor);
    if (status) filter.status = status;
    if (type) filter.type = type;

    const cabins = await Cabin.find(filter)
      .populate("building", "name address city")
      .populate("allocatedTo", "companyName contactPerson phone email")
      .populate("contract", "startDate endDate status")
      .populate("desks", "number status allocatedAt releasedAt")
      .populate("amenities", "name icon iconUrl description")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: cabins });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCabin = async (req, res) => {
  try {
    const { 
      building, 
      floor, 
      number, 
      type, 
      capacity,
      category,
      sizeSqFt,
      amenities,
      images,
      pricing,
      matrixDeviceIds
    } = req.body || {};

    if (!building || !number || !type) {
      return res.status(400).json({ success: false, message: "building, number and type are required" });
    }

    const buildingDoc = await Building.findById(building);
    if (!buildingDoc) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    const existing = await Cabin.findOne({ building, number });
    if (existing) {
      return res.status(409).json({ success: false, message: "Cabin number already exists in this building" });
    }

    // Process images: support either base64 uploads (image.file) or direct URLs (image.url)
    const processedImages = [];
    if (images && Array.isArray(images)) {
      for (const image of images) {
        try {
          const caption = (image.caption || '').trim();
          if (image?.file) {
            const uploadResult = await imagekit.upload({
              file: image.file, // base64 string
              fileName: image.name || `${number.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/cabins",
              useUniqueFileName: true,
              tags: ["cabin", number.replace(/\s+/g, '-').toLowerCase(), buildingDoc.name.replace(/\s+/g, '-').toLowerCase()]
            });
            processedImages.push({
              url: uploadResult.url,
              caption,
              isPrimary: image.isPrimary || false
            });
          } else if (image?.url) {
            processedImages.push({
              url: image.url,
              caption,
              isPrimary: image.isPrimary || false
            });
          }
        } catch (uploadError) {
          console.warn("Failed to process image:", uploadError);
        }
      }
    }

    // Validate and set matrix devices, if provided
    let matrixDevicesToSet = [];
    if (matrixDeviceIds !== undefined) {
      const ids = Array.isArray(matrixDeviceIds) ? matrixDeviceIds : [];
      if (ids.length > 0) {
        const devices = await MatrixDevice.find({ _id: { $in: ids } }).select('_id buildingId status').lean();
        const targetBuildingId = String(building);
        const foundIds = new Set(devices.map(d => String(d._id)));
        const missing = ids.map(String).filter(x => !foundIds.has(x));
        if (missing.length) {
          return res.status(400).json({ success: false, message: `Unknown matrix devices: ${missing.join(', ')}` });
        }
        const invalid = devices.filter(d => String(d.buildingId) !== targetBuildingId);
        if (invalid.length) {
          return res.status(400).json({ success: false, message: 'Matrix devices must belong to the same building as the cabin' });
        }
        const inactive = devices.filter(d => d.status !== 'active');
        if (inactive.length) {
          return res.status(400).json({ success: false, message: 'Matrix devices must be active' });
        }
      }
      matrixDevicesToSet = ids;
    }

    const cabin = await Cabin.create({ 
      building, 
      floor, 
      number, 
      type, 
      capacity,
      category,
      sizeSqFt,
      amenities,
      images: processedImages,
      pricing,
      matrixDevices: matrixDevicesToSet
    });
    const deskCount = Math.max(1, Number(capacity || 1));
    const deskDocs = [];
    for (let i = 1; i <= deskCount; i++) {
      const deskNumber = `${number}-D${i}`;
      deskDocs.push({ building, cabin: cabin._id, number: deskNumber });
    }

    try {
      const createdDesks = await Desk.insertMany(deskDocs);
      cabin.desks = createdDesks.map((d) => d._id);
      await cabin.save();
    } catch (e) {
      return res.status(201).json({
        success: true,
        data: cabin,
        warning: "Cabin created but failed to create all desks",
        error: e.message,
      });
    }

    await logCRUDActivity(req, 'CREATE', 'Cabin', cabin._id, null, {
      building,
      floor,
      number,
      type,
      capacity,
      category,
      sizeSqFt,
      amenities: amenities?.length || 0,
      images: processedImages?.length || 0,
      pricing,
      matrixDevices: matrixDevicesToSet?.length || 0
    });

    return res.status(201).json({ success: true, data: cabin });
  } catch (error) {
    await logErrorActivity(req, 'CREATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const allocateCabin = async (req, res) => {
  try {
    const { clientId, cabinId } = req.body || {};
    if (!clientId || !cabinId) {
      return res.status(400).json({ success: false, message: "clientId and cabinId are required" });
    }

    const [client, cabin] = await Promise.all([
      Client.findById(clientId),
      Cabin.findById(cabinId).populate("building"),
    ]);

    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    if (!cabin) return res.status(404).json({ success: false, message: "Cabin not found" });

    if (cabin.status !== "available") {
      return res.status(409).json({ success: false, message: `Cabin is not available (status: ${cabin.status})` });
    }

    const activeContract = await Contract.findOne({
      client: client._id,
      status: "active",
    })
      .sort({ startDate: -1 })
      .exec();

    if (!activeContract) {
      return res.status(400).json({ success: false, message: "No active contract found for this client" });
    }

    cabin.status = "occupied";
    cabin.allocatedTo = client._id;
    cabin.contract = activeContract._id;
    cabin.allocatedAt = new Date();
    cabin.releasedAt = undefined;
    await cabin.save();

    await logCRUDActivity(req, 'UPDATE', 'Cabin', cabin._id, null, {
      clientId,
      cabinId
    });

    return res.json({ success: true, message: "Cabin allocated successfully", data: { cabin } });
  } catch (error) {
    await logErrorActivity(req, 'UPDATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCabinById = async (req, res) => {
  try {
    const { id } = req.params;
    const cabin = await Cabin.findById(id)
      .populate("building", "name address city")
      .populate("allocatedTo", "companyName contactPerson phone email")
      .populate("contract", "startDate endDate status")
      .populate("desks", "number status allocatedAt releasedAt")
      .populate("amenities", "name icon iconUrl description")
      .populate("matrixDevices", "name deviceType status");
    
    if (!cabin) {
      return res.status(404).json({ success: false, message: "Cabin not found" });
    }
    
    return res.json({ success: true, data: cabin });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCabin = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      building, 
      floor, 
      number, 
      type, 
      capacity, 
      status,
      category,
      sizeSqFt,
      amenities,
      images,
      pricing,
      matrixDeviceIds
    } = req.body || {};
    const existingCabin = await Cabin.findById(id);
    if (!existingCabin) {
      return res.status(404).json({ success: false, message: "Cabin not found" });
    }

    let buildingDoc;
    if (building && building !== existingCabin.building.toString()) {
      buildingDoc = await Building.findById(building);
      if (!buildingDoc) {
        return res.status(404).json({ success: false, message: "Building not found" });
      }
    } else {
      buildingDoc = await Building.findById(existingCabin.building);
    }

    if (number && number !== existingCabin.number) {
      const buildingId = building || existingCabin.building;
      const duplicate = await Cabin.findOne({ 
        building: buildingId, 
        number: number,
        _id: { $ne: id }
      });
      if (duplicate) {
        return res.status(409).json({ success: false, message: "Cabin number already exists in this building" });
      }
    }

    // Process images if provided, similar to create
    let processedImages;
    if (images && Array.isArray(images)) {
      processedImages = [];
      for (const image of images) {
        try {
          const caption = (image.caption || '').trim();
          if (image?.file) {
            const uploadResult = await imagekit.upload({
              file: image.file,
              fileName: image.name || `${(number || existingCabin.number).replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`,
              folder: "/cabins",
              useUniqueFileName: true,
              tags: ["cabin", (number || existingCabin.number).replace(/\s+/g, '-').toLowerCase(), buildingDoc.name.replace(/\s+/g, '-').toLowerCase()]
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

    const updateData = {};
    if (building !== undefined) updateData.building = building;
    if (floor !== undefined) updateData.floor = floor;
    if (number !== undefined) updateData.number = number;
    if (type !== undefined) updateData.type = type;
    if (capacity !== undefined) updateData.capacity = capacity;
    if (status !== undefined) updateData.status = status;
    if (category !== undefined) updateData.category = category;
    if (sizeSqFt !== undefined) updateData.sizeSqFt = sizeSqFt;
    if (amenities !== undefined) updateData.amenities = amenities;
    if (processedImages) updateData.images = processedImages;
    if (pricing !== undefined) updateData.pricing = pricing;

    // Validate and set matrix devices, if provided
    if (matrixDeviceIds !== undefined) {
      const ids = Array.isArray(matrixDeviceIds) ? matrixDeviceIds : [];
      if (ids.length > 0) {
        const devices = await MatrixDevice.find({ _id: { $in: ids } }).select('_id buildingId status').lean();
        const targetBuildingId = String(building || existingCabin.building);
        const foundIds = new Set(devices.map(d => String(d._id)));
        const missing = ids.map(String).filter(x => !foundIds.has(x));
        if (missing.length) {
          return res.status(400).json({ success: false, message: `Unknown matrix devices: ${missing.join(', ')}` });
        }
        const invalid = devices.filter(d => String(d.buildingId) !== targetBuildingId);
        if (invalid.length) {
          return res.status(400).json({ success: false, message: 'Matrix devices must belong to the same building as the cabin' });
        }
        const inactive = devices.filter(d => d.status !== 'active');
        if (inactive.length) {
          return res.status(400).json({ success: false, message: 'Matrix devices must be active' });
        }
      }
      updateData.matrixDevices = ids;
    }

    const cabin = await Cabin.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate("building", "name address city")
     .populate("allocatedTo", "companyName contactPerson phone email")
     .populate("contract", "startDate endDate status")
     .populate("amenities", "name icon iconUrl description");

    await logCRUDActivity(req, 'UPDATE', 'Cabin', cabin._id, null, updateData);

    return res.json({ success: true, data: cabin });
  } catch (error) {
    await logErrorActivity(req, 'UPDATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a cabin
export const deleteCabin = async (req, res) => {
  try {
    const { id } = req.params;
    const cabin = await Cabin.findById(id);

    if (!cabin) {
      return res.status(404).json({ success: false, message: "Cabin not found" });
    }
    if (cabin.status === "occupied") {
      return res.status(409).json({ success: false, message: "Cannot delete occupied cabin. Please release it first." });
    }

    await Cabin.findByIdAndDelete(id);
    await logCRUDActivity(req, 'DELETE', 'Cabin', id, null, null);

    return res.json({ success: true, message: "Cabin deleted successfully" });
  } catch (error) {
    await logErrorActivity(req, 'DELETE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const releaseCabin = async (req, res) => {
  try {
    const { id } = req.params;
    const cabin = await Cabin.findById(id);
    if (!cabin) return res.status(404).json({ success: false, message: "Cabin not found" });

    if (cabin.status !== "occupied") {
      return res.status(409).json({ success: false, message: "Cabin is not currently occupied" });
    }

    // If there are active blocks, keep cabin as 'blocked', else 'available'
    const hasActiveBlocks = (cabin.blocks || []).some(b => b.status === 'active');
    cabin.status = hasActiveBlocks ? "blocked" : "available";
    cabin.allocatedTo = null;
    cabin.contract = null;
    cabin.releasedAt = new Date();
    await cabin.save();

    await logCRUDActivity(req, 'UPDATE', 'Cabin', cabin._id, null, {
      status: 'available'
    });

    return res.json({ success: true, message: "Cabin released successfully", data: cabin });
  } catch (error) {
    await logErrorActivity(req, 'UPDATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};


export const getAvailableCabinsByBuilding = async (req, res) => {
  try {
    const { buildingId } = req.params;
    
    if (!buildingId) {
      return res.status(400).json({ success: false, message: "Building ID is required" });
    }

    // Verify building exists
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ success: false, message: "Building not found" });
    }

    // Get available cabins in the building
    const cabins = await Cabin.find({ 
      building: buildingId, 
      status: "available" 
    })
      .populate("building", "name address city")
      .sort({ floor: 1, number: 1 });

    return res.json({ 
      success: true, 
      data: {
        building,
        cabins
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Create a block for a cabin for a client (and optionally a contract)
export const blockCabin = async (req, res) => {
  try {
    const { id } = req.params; // cabin id
    const { clientId, contractId, fromDate, toDate, reason, notes } = req.body || {};

    if (!clientId || !fromDate || !toDate) {
      return res.status(400).json({ success: false, message: 'clientId, fromDate and toDate are required' });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }

    const cabin = await Cabin.findById(id).populate('building');
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    if (cabin.status === 'occupied') {
      return res.status(409).json({ success: false, message: 'Cabin is currently occupied and cannot be blocked' });
    }

    // Overlap check against active blocks
    const overlap = (b) => b.status === 'active' && !(new Date(b.toDate) < from || new Date(b.fromDate) > to);
    if ((cabin.blocks || []).some(overlap)) {
      return res.status(409).json({ success: false, message: 'Cabin already has an overlapping active block' });
    }

    const block = {
      client: clientId,
      contract: contractId || undefined,
      fromDate: from,
      toDate: to,
      status: 'active',
      reason: reason || undefined,
      notes: notes || undefined,
      createdBy: req.user?.id,
      createdAt: new Date(),
    };

    cabin.blocks = cabin.blocks || [];
    cabin.blocks.push(block);
    // Mark cabin status as blocked
    if (cabin.status === 'available') {
      cabin.status = 'blocked';
    }
    await cabin.save();

    await logCRUDActivity(req, 'UPDATE', 'Cabin', cabin._id, null, {
      action: 'block_created',
      blockClient: clientId,
      contractId: contractId || null,
      fromDate: from,
      toDate: to,
    });

    return res.status(201).json({ success: true, message: 'Cabin blocked successfully', data: { block: cabin.blocks[cabin.blocks.length - 1], cabinId: cabin._id } });
  } catch (error) {
    await logErrorActivity(req, 'UPDATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Release a specific block on a cabin
export const releaseCabinBlock = async (req, res) => {
  try {
    const { id, blockId } = req.params;
    const cabin = await Cabin.findById(id);
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    const blk = (cabin.blocks || []).id(blockId);
    if (!blk) return res.status(404).json({ success: false, message: 'Block not found' });
    if (blk.status !== 'active') {
      return res.status(409).json({ success: false, message: `Block is not active (status: ${blk.status})` });
    }

    blk.status = 'released';
    blk.updatedBy = req.user?.id;
    blk.updatedAt = new Date();
    // If no other active blocks remain, revert cabin status to available (if not occupied)
    const hasOtherActive = (cabin.blocks || []).some(b => b._id.toString() !== blk._id.toString() && b.status === 'active');
    if (!hasOtherActive && cabin.status === 'blocked') {
      cabin.status = 'available';
    }
    await cabin.save();

    await logCRUDActivity(req, 'UPDATE', 'Cabin', cabin._id, null, { action: 'block_released', blockId });

    return res.json({ success: true, message: 'Block released successfully', data: { block: blk } });
  } catch (error) {
    await logErrorActivity(req, 'UPDATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// List blocks for a cabin (auto-expiring past blocks)
export const listCabinBlocks = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query || {};
    const cabin = await Cabin.findById(id)
      .populate('blocks.client', 'companyName')
      .populate('blocks.contract', 'startDate endDate status');
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    // Auto-expire blocks past their toDate
    let changed = false;
    const now = new Date();
    (cabin.blocks || []).forEach(b => {
      if (b.status === 'active' && b.toDate && new Date(b.toDate) < now) {
        b.status = 'expired';
        b.updatedAt = now;
        changed = true;
      }
    });
    if (changed) await cabin.save();

    let blocks = cabin.blocks || [];
    if (status) blocks = blocks.filter(b => b.status === status);

    return res.json({ success: true, data: blocks });
  } catch (error) {
    await logErrorActivity(req, 'READ', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Allocate a cabin from a specific active block
export const allocateCabinFromBlock = async (req, res) => {
  try {
    const { id, blockId } = req.params;
    const cabin = await Cabin.findById(id).populate('building');
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    const blk = (cabin.blocks || []).id(blockId);
    if (!blk) return res.status(404).json({ success: false, message: 'Block not found' });
    if (blk.status !== 'active') {
      return res.status(409).json({ success: false, message: `Block is not active (status: ${blk.status})` });
    }
    if (!['available','blocked'].includes(cabin.status)) {
      return res.status(409).json({ success: false, message: `Cabin is not in allocatable state (status: ${cabin.status})` });
    }

    // If a contract is linked and exists, optionally ensure it's active
    if (blk.contract) {
      const contract = await Contract.findById(blk.contract);
      if (!contract) return res.status(404).json({ success: false, message: 'Linked contract not found' });
      if (contract.status !== 'active') {
        return res.status(409).json({ success: false, message: 'Contract is not active for allocation' });
      }
    }

    cabin.status = 'occupied';
    cabin.allocatedTo = blk.client;
    cabin.contract = blk.contract || cabin.contract;
    cabin.allocatedAt = new Date();

    blk.status = 'allocated';
    blk.updatedBy = req.user?.id;
    blk.updatedAt = new Date();

    await cabin.save();

    await logCRUDActivity(req, 'UPDATE', 'Cabin', cabin._id, null, { action: 'block_allocated', blockId });

    return res.json({ success: true, message: 'Cabin allocated from block successfully', data: { cabin } });
  } catch (error) {
    await logErrorActivity(req, 'UPDATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const exportMasterFile = async (req, res) => {
  try {
    const CabinAmenity = (await import("../models/cabinAmenityModel.js")).default;
    const [buildings, amenities] = await Promise.all([
      Building.find().select('name').sort({ name: 1 }),
      CabinAmenity.find({ isActive: true }).select('name').sort({ name: 1 })
    ]);

    const cabinTypes = ['cabin', 'private', 'shared'];
    const cabinCategories = ['Standard', 'Premium', 'Executive', 'Deluxe'];
    const cabinStatuses = ['available', 'blocked', 'occupied', 'maintenance'];
    const masterData = {
      buildings: buildings.map(b => b.name),
      amenities: amenities.map(a => a.name),
      types: cabinTypes,
      categories: cabinCategories,
      statuses: cabinStatuses
    };

    const sampleRows = [];
    
    if (buildings.length > 0 && amenities.length > 0) {
      const buildingName = buildings[0].name;
      const amenityNames = amenities.slice(0, 3).map(a => a.name);
      
      sampleRows.push({
        buildingName: buildingName,
        cabinNumber: 'C101',
        floor: '1',
        capacity: '4',
        type: 'private',
        status: 'available',
        category: 'Standard',
        sizeSqFt: '100',
        pricing: '5000',
        image1: 'https://example.com/sample-cabin-1.jpg',
        amenity1: amenityNames[0],
        amenity2: amenityNames[1],
        amenity3: amenityNames[2]
      });

      sampleRows.push({
        buildingName: buildingName,
        cabinNumber: 'C102',
        floor: '1',
        capacity: '6',
        type: 'shared',
        status: 'available',
        category: 'Premium',
        sizeSqFt: '150',
        pricing: '7500',
        image1: 'https://example.com/sample-cabin-2.jpg',
        amenity1: amenityNames[0],
        amenity2: amenityNames[1],
        amenity3: amenityNames[2]
      });
    } else {
      // Fallback sample data
      sampleRows.push({
        buildingName: 'Main Building',
        cabinNumber: 'C101',
        floor: '1',
        capacity: '4',
        type: 'private',
        status: 'available',
        category: 'Standard',
        sizeSqFt: '100',
        pricing: '5000',
        image1: 'https://example.com/sample-cabin.jpg',
        amenity1: 'WiFi',
        amenity2: 'Air Conditioning',
        amenity3: 'Whiteboard'
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

export const importCabinsFromCSV = async (req, res) => {
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

    const CabinAmenity = (await import("../models/cabinAmenityModel.js")).default;
    const allAmenities = await CabinAmenity.find({ isActive: true }).select('name').lean();
    const amenityNameToId = new Map(allAmenities.map(a => [String(a.name).trim().toLowerCase(), String(a._id)]));

    const toNumber = (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : undefined;
    };
    const norm = (s) => (s === undefined || s === null ? '' : String(s).trim());
    const parseAmenities = (obj) => {
      const fromCombined = norm(obj.amenities);
      let list = [];
      if (fromCombined) list = fromCombined.split(/[;,]/).map(x => x.trim()).filter(Boolean);
      // amenity1..amenity10 support
      for (let i = 1; i <= 10; i++) {
        const key = `amenity${i}`;
        if (obj[key]) list.push(norm(obj[key]));
      }
      const ids = [];
      const missing = [];
      list.forEach(name => {
        const id = amenityNameToId.get(name.toLowerCase());
        if (id) ids.push(id);
        else missing.push(name);
      });
      return { ids, missing };
    };

    const parseBool = (v) => {
      if (v === undefined || v === null) return false;
      const s = String(v).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'y';
    };

    const parseImages = (obj) => {
      const urls = [];
      const captions = {};
      const primaryFlags = {};

      const combined = norm(obj.images);
      if (combined) {
        combined.split(/[;,]/).map(x => x.trim()).filter(Boolean).forEach((u) => urls.push(u));
      }
      // image1..image10 and captions image1Caption..image10Caption and primary flags image1Primary..image10Primary
      for (let i = 1; i <= 10; i++) {
        const urlKey = `image${i}`;
        const captionKey = `image${i}Caption`;
        const primaryKey = `image${i}Primary`;
        const u = norm(obj[urlKey]);
        if (u) {
          urls.push(u);
          if (obj[captionKey]) captions[urls.length - 1] = norm(obj[captionKey]);
          if (obj[primaryKey] !== undefined) primaryFlags[urls.length - 1] = parseBool(obj[primaryKey]);
        }
      }

      // Build processed image objects
      const processed = urls
        .map((u, idx) => ({
          url: u,
          caption: captions[idx] || undefined,
          isPrimary: Boolean(primaryFlags[idx]) || false,
        }))
        // remove exact duplicate URLs while preserving first occurrence
        .filter((img, idx, arr) => arr.findIndex(x => x.url === img.url) === idx);

      // Allow specifying primaryImage column by URL or index
      const primaryImage = norm(obj.primaryImage);
      if (primaryImage) {
        const byIndex = Number(primaryImage);
        if (Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= processed.length) {
          processed.forEach((p, i) => p.isPrimary = i === (byIndex - 1));
        } else {
          const idx = processed.findIndex(p => p.url === primaryImage);
          if (idx >= 0) processed.forEach((p, i) => p.isPrimary = i === idx);
        }
      }

      // If none marked as primary but we have images, mark first as primary
      if (processed.length > 0 && !processed.some(p => p.isPrimary)) {
        processed[0].isPrimary = true;
      }

      return processed;
    };

    const perRow = [];
    let createdCount = 0;
    let validCount = 0;
    let invalidCount = 0;

    // Preload buildings map by name (lowercase) for quick lookup
    const buildings = await Building.find().select('name').lean();
    const buildingNameToId = new Map(buildings.map(b => [String(b.name).trim().toLowerCase(), String(b._id)]));

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const errors = [];
      const originalRow = { ...r };

      const buildingIdInput = norm(r.buildingId) || undefined;
      const buildingName = norm(r.buildingName);
      let buildingId = buildingIdInput;
      if (!buildingId) {
        if (!buildingName) errors.push('buildingName is required (or provide buildingId)');
        else {
          const mapped = buildingNameToId.get(buildingName.toLowerCase());
          if (!mapped) errors.push(`Unknown building name: ${buildingName}`);
          else buildingId = mapped;
        }
      }

      const number = norm(r.cabinNumber);
      if (!number) errors.push('cabinNumber is required');

      const type = norm(r.type) || 'private';
      const capacity = toNumber(r.capacity);
      if (!capacity || capacity <= 0) errors.push('capacity must be a positive number');
      const floor = toNumber(r.floor) ?? 0;
      const status = norm(r.status) || 'available';
      const category = norm(r.category) || undefined;
      const sizeSqFt = toNumber(r.sizeSqFt);
      const pricing = toNumber(r.pricing);
      const { ids: amenityIds, missing: missingAmenityNames } = parseAmenities(r);
      if (missingAmenityNames.length) {
        errors.push(`Unknown amenities: ${missingAmenityNames.join(', ')}`);
      }

      // Optional Matrix Device fields from CSV
      const rawDeviceInput = norm(r.deviceId || r.device_id || r["device id"] || r["Device ID"] || r.device);
      const deviceTypeRaw = norm(r.deviceType || r["device type"] || r["Device Type"]);
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

      const imagesProcessed = parseImages(r);

      if (!errors.length) {
        // Check duplicates within building
        const dup = await Cabin.findOne({ building: buildingId, number }).lean();
        if (dup) errors.push('Cabin number already exists in this building');
      }

      if (errors.length) {
        invalidCount++;
        perRow.push({ index: idx + 1, success: false, errors, originalRow });
        continue;
      }

      validCount++;

      if (dryRun) {
        perRow.push({
          index: idx + 1,
          success: true,
          preview: { building: buildingId, number, type, capacity, floor, status, category, sizeSqFt, pricing, images: imagesProcessed.length, amenities: amenityIds.length, deviceId: deviceIdNormalized || null, deviceType: deviceIdNormalized ? deviceType : undefined },
          originalRow
        });
        continue;
      }

      // Create the cabin and desks
      try {
        const cabin = await Cabin.create({
          building: buildingId,
          floor,
          number,
          type,
          capacity,
          status,
          category,
          sizeSqFt,
          amenities: amenityIds,
          images: imagesProcessed,
          pricing,
        });
        const deskDocs = [];
        const deskCount = Math.max(1, Number(capacity || 1));
        for (let i = 1; i <= deskCount; i++) {
          const deskNumber = `${number}-D${i}`;
          deskDocs.push({ building: buildingId, cabin: cabin._id, number: deskNumber });
        }
        const createdDesks = await Desk.insertMany(deskDocs);
        cabin.desks = createdDesks.map((d) => d._id);
        await cabin.save();

        // If device details provided, create or link MatrixDevice and attach to cabin
        if (deviceIdNormalized) {
          let deviceDoc = await MatrixDevice.findOne({
            $or: [
              { device_id: deviceIdNormalized },
              ...(numericDevice !== undefined ? [{ device: numericDevice }] : []),
              // Backward compatibility: also check unprefixed raw id if provided and different
              ...(deviceIdRaw && deviceIdRaw !== deviceIdNormalized ? [{ device_id: deviceIdRaw }] : [])
            ]
          });

          if (!deviceDoc) {
            deviceDoc = await MatrixDevice.create({
              buildingId: buildingId,
              name: `Cabin ${number} Device`,
              vendor: 'MATRIX_COSEC',
              deviceType: deviceType ?? 16,
              direction: 'BIDIRECTIONAL',
              device_id: deviceIdNormalized,
              device: numericDevice,
              status: 'Active',
              location: { floor }
            });
          } else {
            let needSave = false;
            if (String(deviceDoc.buildingId || '') !== String(buildingId)) {
              deviceDoc.buildingId = buildingId;
              needSave = true;
            }
            if (deviceType !== undefined && deviceDoc.deviceType !== deviceType) {
              deviceDoc.deviceType = deviceType;
              needSave = true;
            }
            // Ensure stored device_id is normalized going forward
            if (deviceDoc.device_id !== deviceIdNormalized) {
              deviceDoc.device_id = deviceIdNormalized;
              needSave = true;
            }
            if (numericDevice !== undefined && deviceDoc.device !== numericDevice) {
              deviceDoc.device = numericDevice;
              needSave = true;
            }
            if (needSave) await deviceDoc.save();
          }

          cabin.matrixDevices = Array.from(new Set([...(cabin.matrixDevices || []), deviceDoc._id]));
          await cabin.save();
        }

        await logCRUDActivity(req, 'CREATE', 'Cabin', cabin._id, null, {
          imported: true,
          building: buildingId,
          number,
          type,
          capacity,
          floor,
          status,
          category,
          sizeSqFt,
          amenities: amenityIds.length,
          pricing,
          matrixDevices: (cabin.matrixDevices || []).length,
        });

        createdCount++;
        perRow.push({ index: idx + 1, success: true, id: cabin._id, originalRow });
      } catch (e) {
        invalidCount++;
        perRow.push({ index: idx + 1, success: false, errors: [e.message || 'Failed to create cabin'], originalRow });
      }
    }

    const summary = {
      totalRows: rows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      created: dryRun ? 0 : createdCount,
    };
    return res.json({
      success: true,
      dryRun,
      counts: { total: rows.length, valid: validCount, invalid: invalidCount, created: dryRun ? 0 : createdCount },
      summary,
      canImport: dryRun ? validCount > 0 : undefined,
      results: perRow,
    });
  } catch (error) {
    await logErrorActivity(req, 'CREATE', 'Cabin', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Download sample CSV for cabin import
export const downloadSampleCSV = async (_req, res) => {
  try {
    const header = [
      'buildingName','cabinNumber','floor','capacity','type','status','category','sizeSqFt','pricing','amenities','images','primaryImage','deviceId','deviceType'
    ];
    // deviceType is optional during import and defaults to 16 if omitted. Provide 16 in sample for clarity.
    // images: semicolon-separated URLs. primaryImage can be the 1-based index or the exact URL.
    const sample1 = ['Main Building','C101','1','4','private','available','Standard','100','5000','WiFi;Air Conditioning;Whiteboard','https://example.com/sample-cabin-1.jpg;https://example.com/sample-cabin-1b.jpg','1','d_10001','16'];
    const sample2 = ['Main Building','C102','1','6','shared','available','Premium','150','7500','WiFi;Whiteboard','https://example.com/sample-cabin-2.jpg','1','d_10002','16'];
    const csvText = [header.join(','), sample1.join(','), sample2.join(',')].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cabins_import_sample.csv"');
    return res.send(csvText);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
