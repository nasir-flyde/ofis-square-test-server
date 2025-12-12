import mongoose from "mongoose";
import AccessZone from "../models/accessZoneModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const listAccessZones = async (req, res) => {
  try {
    const { buildingId, status, q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (status) filter.status = status;
    if (q) filter.name = new RegExp(String(q), "i");

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      AccessZone.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AccessZone.countDocuments(filter),
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
    await logErrorActivity(req, err, "AccessZones:List");
    return res.status(500).json({ success: false, message: "Failed to list zones" });
  }
};

export const createAccessZone = async (req, res) => {
  try {
    const { buildingId, name, description, matrixDevices = [], status = "active", meta } = req.body || {};
    if (!buildingId || !mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ success: false, message: "Valid buildingId is required" });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const created = await AccessZone.create({ buildingId, name: String(name).trim(), description, matrixDevices, status, meta });
    await logCRUDActivity(req, "CREATE", "AccessZone", created._id, null, { buildingId, name: created.name });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    await logErrorActivity(req, err, "AccessZones:Create");
    return res.status(500).json({ success: false, message: "Failed to create zone" });
  }
};

export const getAccessZoneById = async (req, res) => {
  try {
    const { id } = req.params;
    const z = await AccessZone.findById(id).lean();
    if (!z) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: z });
  } catch (err) {
    await logErrorActivity(req, err, "AccessZones:Get");
    return res.status(500).json({ success: false, message: "Failed to fetch zone" });
  }
};

export const updateAccessZone = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, matrixDevices, status, meta } = req.body || {};
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (description !== undefined) update.description = description;
    if (matrixDevices !== undefined) update.matrixDevices = matrixDevices;
    if (status !== undefined) update.status = status;
    if (meta !== undefined) update.meta = meta;

    const updated = await AccessZone.findByIdAndUpdate(id, update, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });
    await logCRUDActivity(req, "UPDATE", "AccessZone", updated._id, null, update);
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, "AccessZones:Update");
    return res.status(500).json({ success: false, message: "Failed to update zone" });
  }
};

export const deleteAccessZone = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await AccessZone.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Not found" });
    await logCRUDActivity(req, "DELETE", "AccessZone", deleted._id, null, {});
    return res.json({ success: true, data: deleted });
  } catch (err) {
    await logErrorActivity(req, err, "AccessZones:Delete");
    return res.status(500).json({ success: false, message: "Failed to delete zone" });
  }
};
