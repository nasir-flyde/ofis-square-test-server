import Desk from "../models/deskModel.js";
import Cabin from "../models/cabinModel.js";
import Building from "../models/buildingModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";

// List desks with optional filters
export const getDesks = async (req, res) => {
  try {
    const { building, cabin, status } = req.query || {};
    const filter = {};
    if (building) filter.building = building;
    if (cabin) filter.cabin = cabin;
    if (status) filter.status = status;

    const desks = await Desk.find(filter)
      .populate("building", "name city")
      .populate({ path: "cabin", select: "number floor" })
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: desks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Create a desk, and attach it to the cabin.desks array
export const createDesk = async (req, res) => {
  try {
    const { building, cabin, number } = req.body || {};
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

    const desk = await Desk.create({ building, cabin, number });

    // Attach to cabin.desks if not present
    if (!cabinDoc.desks) cabinDoc.desks = [];
    cabinDoc.desks.addToSet(desk._id);
    await cabinDoc.save();

    return res.status(201).json({ success: true, data: desk });
  } catch (error) {
    // Handle duplicate key errors for unique index (cabin, number)
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: "Desk number already exists in this cabin" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Allocate a desk to a client using client's active contract (no contractId required)
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

// Release a desk
export const releaseDesk = async (req, res) => {
  try {
    const { id } = req.params;
    const desk = await Desk.findById(id);
    if (!desk) return res.status(404).json({ success: false, message: "Desk not found" });

    if (desk.status !== "occupied") {
      return res.status(409).json({ success: false, message: "Desk is not currently occupied" });
    }

    desk.status = "available";
    desk.releasedAt = new Date();
    await desk.save();

    return res.json({ success: true, message: "Desk released successfully", data: desk });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
