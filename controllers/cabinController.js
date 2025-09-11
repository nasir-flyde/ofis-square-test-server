import Cabin from "../models/cabinModel.js";
import Building from "../models/buildingModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import Desk from "../models/deskModel.js";

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
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: cabins });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCabin = async (req, res) => {
  try {
    const { building, floor, number, type, capacity } = req.body || {};

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

    const cabin = await Cabin.create({ building, floor, number, type, capacity });
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

    return res.status(201).json({ success: true, data: cabin });
  } catch (error) {
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

    return res.json({ success: true, message: "Cabin allocated successfully", data: { cabin } });
  } catch (error) {
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
      .populate("desks", "number status allocatedAt releasedAt");
    
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
    const { building, floor, number, type, capacity, status } = req.body || {};
    const existingCabin = await Cabin.findById(id);
    if (!existingCabin) {
      return res.status(404).json({ success: false, message: "Cabin not found" });
    }

    if (building && building !== existingCabin.building.toString()) {
      const buildingDoc = await Building.findById(building);
      if (!buildingDoc) {
        return res.status(404).json({ success: false, message: "Building not found" });
      }
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

    const cabin = await Cabin.findByIdAndUpdate(
      id,
      {
        building,
        floor,
        number,
        type,
        capacity,
        status
      },
      { new: true, runValidators: true }
    ).populate("building", "name address city")
     .populate("allocatedTo", "companyName contactPerson phone email")
     .populate("contract", "startDate endDate status");

    return res.json({ success: true, data: cabin });
  } catch (error) {
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
    return res.json({ success: true, message: "Cabin deleted successfully" });
  } catch (error) {
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

    cabin.status = "available";
    cabin.allocatedTo = null;
    cabin.contract = null;
    cabin.releasedAt = new Date();
    await cabin.save();

    return res.json({ success: true, message: "Cabin released successfully", data: cabin });
  } catch (error) {
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
