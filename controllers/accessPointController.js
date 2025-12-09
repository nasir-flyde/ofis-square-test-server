import mongoose from "mongoose";
import AccessPoint from "../models/accessPointModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// List access points with filters and pagination
export const listAccessPoints = async (req, res) => {
  try {
    const { buildingId, bindingType, refType, refId, status, q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (bindingType) filter.bindingType = bindingType;
    if (status) filter.status = status;
    if (refType) filter["resource.refType"] = refType;
    if (refId) filter["resource.refId"] = refId;
    if (q) {
      filter.$or = [
        { name: new RegExp(String(q), "i") },
        { "location.zone": new RegExp(String(q), "i") },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      AccessPoint.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AccessPoint.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        currentPage: Number(page) || 1,
        totalPages: Math.ceil(total / Number(limit || 1)),
        totalRecords: total,
        hasMore: skip + Number(limit) < total,
      },
    });
  } catch (err) {
    await logErrorActivity(req, err, "AccessPoints:List");
    return res.status(500).json({ success: false, message: "Failed to list access points" });
  }
};

// Create access point
export const createAccessPoint = async (req, res) => {
  try {
    const {
      buildingId,
      name,
      bindingType = "custom",
      resource,
      zoneId,
      pointType = "DOOR",
      deviceBindings = [],
      status = "active",
      location,
      meta,
    } = req.body || {};

    if (!buildingId || !mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ success: false, message: "Valid buildingId is required" });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }

    // Optional: verify building exists
    try {
      const building = await Building.findById(buildingId).select("_id").lean();
      if (!building) return res.status(400).json({ success: false, message: "Building not found" });
    } catch {}

    const created = await AccessPoint.create({
      buildingId,
      name: name.trim(),
      bindingType,
      resource,
      zoneId,
      pointType,
      deviceBindings,
      status,
      location,
      meta,
    });

    await logCRUDActivity(req, "CREATE", "AccessPoint", created._id, null, { buildingId, name: created.name });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    await logErrorActivity(req, err, "AccessPoints:Create");
    return res.status(500).json({ success: false, message: "Failed to create access point" });
  }
};

// Get by id
export const getAccessPointById = async (req, res) => {
  try {
    const { id } = req.params;
    const ap = await AccessPoint.findById(id).lean();
    if (!ap) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: ap });
  } catch (err) {
    await logErrorActivity(req, err, "AccessPoints:Get");
    return res.status(500).json({ success: false, message: "Failed to fetch access point" });
  }
};

// Update
export const updateAccessPoint = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      bindingType,
      resource,
      zoneId,
      pointType,
      deviceBindings,
      status,
      location,
      meta,
    } = req.body || {};

    const update = {};
    if (typeof name === "string") update.name = name.trim();
    if (bindingType) update.bindingType = bindingType;
    if (resource !== undefined) update.resource = resource;
    if (zoneId !== undefined) update.zoneId = zoneId;
    if (pointType) update.pointType = pointType;
    if (deviceBindings !== undefined) update.deviceBindings = deviceBindings;
    if (status) update.status = status;
    if (location !== undefined) update.location = location;
    if (meta !== undefined) update.meta = meta;

    const updated = await AccessPoint.findByIdAndUpdate(id, update, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });

    await logCRUDActivity(req, "UPDATE", "AccessPoint", updated._id, null, update);
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, "AccessPoints:Update");
    return res.status(500).json({ success: false, message: "Failed to update access point" });
  }
};

// Delete
export const deleteAccessPoint = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await AccessPoint.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Not found" });
    await logCRUDActivity(req, "DELETE", "AccessPoint", deleted._id, null, {});
    return res.json({ success: true, data: deleted });
  } catch (err) {
    await logErrorActivity(req, err, "AccessPoints:Delete");
    return res.status(500).json({ success: false, message: "Failed to delete access point" });
  }
};
