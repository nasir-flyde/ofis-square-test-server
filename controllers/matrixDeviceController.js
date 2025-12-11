import MatrixDevice from "../models/matrixDeviceModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const createMatrixDevice = async (req, res) => {
  try {
    const {
      buildingId,
      name,
      vendor = "MATRIX_COSEC",
      deviceType,
      direction = "BIDIRECTIONAL",
      externalDeviceId,
      device_id,
      ipAddress,
      macAddress,
      site,
      location,
      status = "Active",
      meta,
    } = req.body || {};

    if (!buildingId || !name || !deviceType) {
      return res.status(400).json({ success: false, message: "buildingId, name, deviceType are required" });
    }

    const building = await Building.findById(buildingId).select('_id');
    if (!building) return res.status(404).json({ success: false, message: "Building not found" });

    if (externalDeviceId) {
      const dup = await MatrixDevice.findOne({ externalDeviceId });
      if (dup) return res.status(409).json({ success: false, message: "externalDeviceId already exists" });
    }

    if (device_id) {
      const dupDevId = await MatrixDevice.findOne({ device_id });
      if (dupDevId) return res.status(409).json({ success: false, message: "device_id already exists" });
    }

    const device = await MatrixDevice.create({
      buildingId,
      name: name.trim(),
      vendor,
      deviceType,
      direction,
      externalDeviceId,
      device_id,
      ipAddress,
      macAddress,
      site,
      location,
      status,
      meta,
    });

    await logCRUDActivity(req, 'CREATE', 'MatrixDevice', device._id, null, { buildingId, name: device.name, deviceType });
    return res.status(201).json({ success: true, data: device });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixDevice:Create');
    return res.status(500).json({ success: false, message: 'Failed to create matrix device' });
  }
};

export const listMatrixDevices = async (req, res) => {
  try {
    const { buildingId, deviceType, status, site, q, page = 1, limit = 100 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (deviceType) filter.deviceType = deviceType;
    if (status) filter.status = status;
    if (site) filter.site = site;
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { externalDeviceId: { $regex: q, $options: 'i' } },
      { device_id: { $regex: q, $options: 'i' } },
      { ipAddress: { $regex: q, $options: 'i' } },
      { macAddress: { $regex: q, $options: 'i' } },
      { site: { $regex: q, $options: 'i' } },
    ];

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      MatrixDevice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      MatrixDevice.countDocuments(filter)
    ]);

    return res.json({ success: true, data: items, pagination: { currentPage: Number(page)||1, totalPages: Math.ceil(total/Number(limit||1)), totalRecords: total } });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixDevice:List');
    return res.status(500).json({ success: false, message: 'Failed to list matrix devices' });
  }
};

export const getMatrixDeviceById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MatrixDevice.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Matrix device not found' });
    return res.json({ success: true, data: item });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixDevice:Get');
    return res.status(500).json({ success: false, message: 'Failed to get matrix device' });
  }
};

export const updateMatrixDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const update = { ...req.body };
    if (update.externalDeviceId) {
      const dup = await MatrixDevice.findOne({ externalDeviceId: update.externalDeviceId, _id: { $ne: id } });
      if (dup) return res.status(409).json({ success: false, message: 'externalDeviceId already exists' });
    }
    if (update.device_id) {
      const dupDevId = await MatrixDevice.findOne({ device_id: update.device_id, _id: { $ne: id } });
      if (dupDevId) return res.status(409).json({ success: false, message: 'device_id already exists' });
    }
    if (update.buildingId) {
      const building = await Building.findById(update.buildingId).select('_id');
      if (!building) return res.status(404).json({ success: false, message: 'Building not found' });
    }

    const item = await MatrixDevice.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ success: false, message: 'Matrix device not found' });

    await logCRUDActivity(req, 'UPDATE', 'MatrixDevice', item._id, null, update);
    return res.json({ success: true, data: item });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixDevice:Update');
    return res.status(500).json({ success: false, message: 'Failed to update matrix device' });
  }
};

export const deleteMatrixDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MatrixDevice.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Matrix device not found' });
    await MatrixDevice.deleteOne({ _id: id });
    await logCRUDActivity(req, 'DELETE', 'MatrixDevice', id, null, null);
    return res.json({ success: true, message: 'Matrix device deleted' });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixDevice:Delete');
    return res.status(500).json({ success: false, message: 'Failed to delete matrix device' });
  }
};

export default {
  createMatrixDevice,
  listMatrixDevices,
  getMatrixDeviceById,
  updateMatrixDevice,
  deleteMatrixDevice,
};
