import AddOn from "../models/addOnModel.js";
import Contract from "../models/contractModel.js";
import { logBusinessEvent } from "../middlewares/activityLogMiddleware.js";

/**
 * Get all contracts that have any add-ons (for global list view)
 */
export const getAllContractAddOns = async (req, res) => {
  try {
    const contracts = await Contract.find(
      { "addOns.0": { $exists: true } },
      { client: 1, building: 1, addOns: 1, monthlyRent: 1, startDate: 1 }
    )
      .populate("client", "companyName legalName")
      .populate("building", "name city")
      .sort({ updatedAt: -1 })
      .limit(200);

    // Flatten into a list of add-on rows for easy display
    const rows = [];
    contracts.forEach((contract) => {
      (contract.addOns || []).forEach((addon, idx) => {
        rows.push({
          contractId: contract._id,
          contractBuilding: contract.building?.name || "N/A",
          contractMonthlyRent: contract.monthlyRent,
          clientName: contract.client?.companyName || contract.client?.legalName || "N/A",
          clientId: contract.client?._id,
          addonIndex: idx,
          description: addon.description,
          amount: addon.amount,
          billingCycle: addon.billingCycle,
          status: addon.status,
          addedAt: addon.addedAt,
        });
      });
    });

    res.status(200).json({ success: true, data: rows, total: rows.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get all master add-ons
 */
export const getAllMasterAddOns = async (req, res) => {
  try {
    const addons = await AddOn.find({ isActive: true }).sort({ name: 1 });
    res.status(200).json({ success: true, data: addons });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Add an add-on to a specific contract
 */
export const addAddOnToContract = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { addonId, description, amount, billingCycle, quantity, startDate, endDate, zoho_item_id } = req.body;

    if (!description || amount === undefined) {
      return res.status(400).json({ success: false, message: "Description and amount are required" });
    }

    const contract = await Contract.findById(contractId);
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    const addon = await AddOn.findById(addonId);
    if (!addon) {
      return res.status(404).json({ success: false, message: "Add-on not found" });
    }

    const qty = Number(quantity || 1);
    const unitAmount = Number(amount) || addon.amount || 0; // Use provided amount or fallback to master addon

    const newAddon = {
      addonId: addonId || null,
      description,
      amount: unitAmount,
      quantity: qty,
      billingCycle: billingCycle || "monthly",
      status: "active",
      zoho_item_id: zoho_item_id || addon.zoho_item_id || "",
      startDate: startDate || null,
      endDate: endDate || null,
      addedAt: new Date(),
      addedBy: req.user?._id,
    };

    contract.addOns.push(newAddon);
    await contract.save();

    const totalAmount = unitAmount * qty;
    // Log the activity
    await logBusinessEvent({
      req,
      userId: req.user?._id,
      userName: req.user?.name || req.user?.email,
      userRole: req.user?.roleName,
      userEmail: req.user?.email,
      action: 'ADD_ON_ADDED',
      entity: 'Contract',
      entityId: contractId,
      description: `Added add-on "${description}" (₹${totalAmount}) to contract ${contract.contractNumber || contractId}`,
      metadata: { addon: newAddon }
    });

    res.status(201).json({ success: true, data: contract.addOns });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Remove an add-on from a contract (or mark as inactive)
 */
export const removeAddOnFromContract = async (req, res) => {
  try {
    const { contractId, addonIndex } = req.params;

    const contract = await Contract.findById(contractId);
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    if (!contract.addOns[addonIndex]) {
      return res.status(404).json({ success: false, message: "Add-on not found at this index" });
    }

    // Instead of deleting, we can mark as inactive or just pull from array if it was never billed
    // For simplicity, let's pull it if the user wants it gone
    contract.addOns.splice(addonIndex, 1);
    await contract.save();

    // Log the activity
    await logBusinessEvent({
      req,
      userId: req.user?._id,
      userName: req.user?.name || req.user?.email,
      userRole: req.user?.roleName,
      userEmail: req.user?.email,
      action: 'ADD_ON_REMOVED',
      entity: 'Contract',
      entityId: contractId,
      description: `Removed add-on at index ${addonIndex} from contract ${contract.contractNumber || contractId}`,
      metadata: { addonIndex }
    });

    res.status(200).json({ success: true, data: contract.addOns });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update an add-on in a contract
 */
export const updateAddOnInContract = async (req, res) => {
  try {
    const { contractId, addonIndex } = req.params;
    const { description, amount, quantity, billingCycle, status, startDate, endDate, zoho_item_id } = req.body;

    const contract = await Contract.findById(contractId);
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    if (!contract.addOns[addonIndex]) {
      return res.status(404).json({ success: false, message: "Add-on not found at this index" });
    }

    const addon = contract.addOns[addonIndex];
    if (description) addon.description = description;
    if (amount !== undefined) addon.amount = amount;
    if (quantity !== undefined) addon.quantity = quantity;
    if (billingCycle) addon.billingCycle = billingCycle;
    if (status) addon.status = status;
    if (startDate !== undefined) addon.startDate = startDate;
    if (endDate !== undefined) addon.endDate = endDate;
    if (zoho_item_id !== undefined) addon.zoho_item_id = zoho_item_id;

    await contract.save();

    // Log the activity
    await logBusinessEvent({
      req,
      userId: req.user?._id,
      userName: req.user?.name || req.user?.email,
      userRole: req.user?.roleName,
      userEmail: req.user?.email,
      action: 'ADD_ON_UPDATED',
      entity: 'Contract',
      entityId: contractId,
      description: `Updated add-on at index ${addonIndex} in contract ${contract.contractNumber || contractId}`,
      metadata: { changes: { description, amount, billingCycle, status } }
    });

    res.status(200).json({ success: true, data: contract.addOns });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a new master add-on
 */
export const createMasterAddOn = async (req, res) => {
  try {
    const { name, description, category, isActive, zoho_item_id } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    const newAddon = await AddOn.create({
      name,
      description,
      category,
      isActive,
      zoho_item_id,
    });

    res.status(201).json({ success: true, data: newAddon });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update a master add-on
 */
export const updateMasterAddOn = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, isActive, zoho_item_id } = req.body;

    const addon = await AddOn.findById(id);
    if (!addon) {
      return res.status(404).json({ success: false, message: "Add-on not found" });
    }

    if (name) addon.name = name;
    if (description !== undefined) addon.description = description;
    if (category) addon.category = category;
    if (isActive !== undefined) addon.isActive = isActive;
    if (zoho_item_id !== undefined) addon.zoho_item_id = zoho_item_id;

    await addon.save();

    res.status(200).json({ success: true, data: addon });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
