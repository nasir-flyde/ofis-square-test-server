import CommonArea from "../models/commonAreaModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

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
    const data = await validateAndAttachDevices({ ...req.body });

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

    const updateData = { ...req.body };
    // Ensure buildingId used for validation is the updated one if provided, else existing
    if (updateData.buildingId === undefined) updateData.buildingId = existing.buildingId;

    // Validate devices when matrixDeviceIds is present (can be empty array to clear)
    if (updateData.matrixDeviceIds !== undefined) {
      await validateAndAttachDevices(updateData);
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
