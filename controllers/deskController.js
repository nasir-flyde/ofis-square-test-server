import Desk from "../models/deskModel.js";
import Cabin from "../models/cabinModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";

export const getDesks = async (req, res) => {
  try {
    const { building, cabin, status } = req.query || {};
    const filter = {};
    if (building) filter.building = building;
    if (cabin) filter.cabin = cabin;
    if (status) filter.status = status;

    const desks = await Desk.find(filter)
      .populate('building', 'name address city')
      .populate('cabin', 'number floor type')
      .sort({ createdAt: -1 });

    // Log activity
    await logCRUDActivity(req, 'READ', 'Desk', null, null, {
      recordCount: desks.length,
      filters: filter
    });

    res.json({
      success: true,
      data: desks,
      count: desks.length
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createDesk = async (req, res) => {
  try {
    const { building, cabin, number, status } = req.body || {};
    if (!building || !cabin || !number) {
      return res.status(400).json({ success: false, message: "building, cabin and number are required" });
    }

    const [buildingDoc, cabinDoc] = await Promise.all([
      Building.findById(building),
      Cabin.findById(cabin),
    ]);
    if (!buildingDoc) return res.status(404).json({ success: false, message: "Building not found" });
    if (!cabinDoc) return res.status(404).json({ success: false, message: "Cabin not found" });

    // Ensure cabin belongs to the same building
    if (String(cabinDoc.building) !== String(buildingDoc._id)) {
      return res.status(400).json({ success: false, message: "Cabin does not belong to the given building" });
    }

    const desk = await Desk.create({
      number,
      building: building,
      cabin: cabin,
      status: status || 'available'
    });

    await desk.populate(['building', 'cabin']);

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'Desk', desk._id, null, {
      number,
      building: building,
      cabin: cabin,
      status: status || 'available'
    });

    res.status(201).json({
      success: true,
      message: 'Desk created successfully',
      data: desk
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const allocateDesk = async (req, res) => {
  try {
    const { clientId, deskId } = req.body || {};
    if (!clientId || !deskId) {
      return res.status(400).json({ success: false, message: "clientId and deskId are required" });
    }

    const [client, desk] = await Promise.all([
      Client.findById(clientId),
      Desk.findById(deskId).populate("building cabin"),
    ]);

    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    if (!desk) return res.status(404).json({ success: false, message: "Desk not found" });

    if (desk.status !== "available") {
      return res.status(409).json({ success: false, message: `Desk is not available (status: ${desk.status})` });
    }

    const activeContract = await Contract.findOne({ client: client._id, status: "active" })
      .sort({ startDate: -1 })
      .exec();

    if (!activeContract) {
      return res.status(400).json({ success: false, message: "No active contract found for this client" });
    }

    // Only update status and timestamps on the desk
    desk.status = "occupied";
    desk.allocatedAt = new Date();
    desk.releasedAt = undefined;
    await desk.save();

    return res.json({ success: true, message: "Desk allocated successfully", data: desk });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const releaseDesk = async (req, res) => {
  try {
    const { id } = req.params;
    const oldDesk = await Desk.findById(id);
    const desk = await Desk.findByIdAndUpdate(
      id,
      { status: "available" },
      { new: true, runValidators: true }
    ).populate(['building', 'cabin']);

    if (!desk) {
      return res.status(404).json({
        success: false,
        message: 'Desk not found'
      });
    }

    desk.releasedAt = new Date();

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Desk', id, {
      before: oldDesk?.toObject(),
      after: desk.toObject(),
      fields: ['status']
    }, {
      deskNumber: desk.number,
      updatedFields: ['status']
    });

    res.json({
      success: true,
      message: 'Desk released successfully',
      data: desk
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
