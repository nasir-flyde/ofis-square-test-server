import mongoose from "mongoose";
import AccessPoint from "../models/accessPointModel.js";
import Building from "../models/buildingModel.js";
import AccessZone from "../models/accessZoneModel.js";
import CommonArea from "../models/commonAreaModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// List access points with filters and pagination
export const listAccessPoints = async (req, res) => {
  try {
    const { buildingId, bindingType, refType, refId, zoneId, status, q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (bindingType) filter.bindingType = bindingType;
    if (status) filter.status = status;
    if (refType) filter["resource.refType"] = refType;
    if (refId) filter["resource.refId"] = refId;
    if (zoneId) filter.zoneId = zoneId;
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

    // Validate CommonArea binding if provided
    let resolvedResource = resource;
    try {
      if ((bindingType === "common_area") || (resource && resource.refType === "CommonArea")) {
        const refId = resource?.refId;
        if (!refId || !mongoose.Types.ObjectId.isValid(refId)) {
          return res.status(400).json({ success: false, message: "Valid resource.refId is required for CommonArea" });
        }
        const ca = await CommonArea.findById(refId).select("_id buildingId name").lean();
        if (!ca) return res.status(400).json({ success: false, message: "CommonArea not found" });
        if (String(ca.buildingId) !== String(buildingId)) {
          return res.status(400).json({ success: false, message: "CommonArea must belong to the same building as the access point" });
        }
        resolvedResource = { refType: "CommonArea", refId, label: resource?.label || ca.name };
      }
    } catch (e) {
      await logErrorActivity(req, e, "AccessPoints:CommonArea:Validate");
      return res.status(400).json({ success: false, message: e?.message || "Invalid CommonArea binding" });
    }

    const effectivePointType = pointType || (bindingType === "common_area" ? "COMMON_AREA" : "DOOR");

    const created = await AccessPoint.create({
      buildingId,
      name: name.trim(),
      bindingType,
      resource: resolvedResource,
      zoneId,
      pointType: effectivePointType,
      deviceBindings,
      status,
      location,
      meta,
    });

    // Sync zone's matrixDevices with this AP's Matrix devices
    if (created?.zoneId) {
      try {
        const devIds = (created.deviceBindings || [])
          .filter((b) => b && b.vendor === "MATRIX_COSEC" && b.deviceId)
          .map((b) => b.deviceId);
        if (devIds.length) {
          await AccessZone.updateOne(
            { _id: created.zoneId },
            { $addToSet: { matrixDevices: { $each: devIds } } }
          );
        }
      } catch (e) {
        await logErrorActivity(req, e, "AccessPoints:ZoneSync:Create");
      }
    }

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

    // Validate CommonArea binding on update if provided
    let validatedResource = resource;
    let validatedPointType = pointType;
    if ((bindingType === "common_area") || (resource && resource.refType === "CommonArea")) {
      try {
        const refId = resource?.refId;
        if (!refId || !mongoose.Types.ObjectId.isValid(refId)) {
          return res.status(400).json({ success: false, message: "Valid resource.refId is required for CommonArea" });
        }
        // Determine building to validate against: need the AP's building if not provided
        const existingAp = await AccessPoint.findById(id).select("buildingId").lean();
        const targetBuildingId = existingAp?.buildingId;
        const ca = await CommonArea.findById(refId).select("_id buildingId name").lean();
        if (!ca) return res.status(400).json({ success: false, message: "CommonArea not found" });
        if (targetBuildingId && String(ca.buildingId) !== String(targetBuildingId)) {
          return res.status(400).json({ success: false, message: "CommonArea must belong to the same building as the access point" });
        }
        validatedResource = { refType: "CommonArea", refId, label: resource?.label || ca.name };
        if (!validatedPointType) validatedPointType = "COMMON_AREA";
      } catch (e) {
        await logErrorActivity(req, e, "AccessPoints:CommonArea:ValidateUpdate");
        return res.status(400).json({ success: false, message: e?.message || "Invalid CommonArea binding" });
      }
    }
    if (validatedResource !== undefined) update.resource = validatedResource;
    if (zoneId !== undefined) update.zoneId = zoneId;
    if (validatedPointType) update.pointType = validatedPointType;
    if (deviceBindings !== undefined) update.deviceBindings = deviceBindings;
    if (status) update.status = status;
    if (location !== undefined) update.location = location;
    if (meta !== undefined) update.meta = meta;

    // Fetch previous to detect zone and device changes
    const prev = await AccessPoint.findById(id).select("zoneId deviceBindings").lean();
    const prevZoneId = prev?.zoneId ? String(prev.zoneId) : undefined;
    const prevDevIdsStr = (prev?.deviceBindings || [])
      .filter((b) => b && b.vendor === "MATRIX_COSEC" && b.deviceId)
      .map((b) => String(b.deviceId));

    const updated = await AccessPoint.findByIdAndUpdate(id, update, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });

    // Sync zone's matrixDevices according to zone changes or deviceBinding changes
    try {
      const newZoneId = updated.zoneId ? String(updated.zoneId) : undefined;
      const newDevIdsStr = (updated?.deviceBindings || [])
        .filter((b) => b && b.vendor === "MATRIX_COSEC" && b.deviceId)
        .map((b) => String(b.deviceId));

      // Helper to convert string ids to ObjectIds
      const toObjIds = (arr) => arr.map((s) => new mongoose.Types.ObjectId(s));

      if (prevZoneId && prevZoneId !== newZoneId) {
        // Zone changed: remove all previous deviceIds from old zone, add all new to new zone
        if (prevDevIdsStr.length) {
          await AccessZone.updateOne(
            { _id: prevZoneId },
            { $pull: { matrixDevices: { $in: toObjIds(prevDevIdsStr) } } }
          );
        }
        if (newZoneId && newDevIdsStr.length) {
          await AccessZone.updateOne(
            { _id: newZoneId },
            { $addToSet: { matrixDevices: { $each: toObjIds(newDevIdsStr) } } }
          );
        }
      } else if (newZoneId) {
        // Zone unchanged: sync differences
        const prevSet = new Set(prevDevIdsStr);
        const newSet = new Set(newDevIdsStr);
        const toAdd = Array.from(newSet).filter((x) => !prevSet.has(x));
        const toRemove = Array.from(prevSet).filter((x) => !newSet.has(x));
        if (toAdd.length) {
          await AccessZone.updateOne(
            { _id: newZoneId },
            { $addToSet: { matrixDevices: { $each: toObjIds(toAdd) } } }
          );
        }
        if (toRemove.length) {
          await AccessZone.updateOne(
            { _id: newZoneId },
            { $pull: { matrixDevices: { $in: toObjIds(toRemove) } } }
          );
        }
      }
    } catch (e) {
      await logErrorActivity(req, e, "AccessPoints:ZoneSync:Update");
    }

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

    // Remove this AP's Matrix devices from the zone if present
    try {
      if (deleted.zoneId) {
        const devIdsStr = (deleted?.deviceBindings || [])
          .filter((b) => b && b.vendor === "MATRIX_COSEC" && b.deviceId)
          .map((b) => String(b.deviceId));
        if (devIdsStr.length) {
          const toObjIds = devIdsStr.map((s) => new mongoose.Types.ObjectId(s));
          await AccessZone.updateOne(
            { _id: deleted.zoneId },
            { $pull: { matrixDevices: { $in: toObjIds } } }
          );
        }
      }
    } catch (e) {
      await logErrorActivity(req, e, "AccessPoints:ZoneSync:Delete");
    }

    await logCRUDActivity(req, "DELETE", "AccessPoint", deleted._id, null, {});
    return res.json({ success: true, data: deleted });
  } catch (err) {
    await logErrorActivity(req, err, "AccessPoints:Delete");
    return res.status(500).json({ success: false, message: "Failed to delete access point" });
  }
};
