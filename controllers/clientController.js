import mongoose from "mongoose";
import Client from "../models/clientModel.js";
import imagekit from "../utils/imageKit.js";
import Contract from "../models/contractModel.js";

// Create client (standard create using model field names)
export const createClient = async (req, res) => {
  try {
    const body = req.body || {};
    // Map common inputs and enforce admin-driven flow defaults
    const payload = {
      companyName: body.companyName ?? body.company_name ?? undefined,
      contactPerson: body.contactPerson ?? body.contact_person ?? undefined,
      email: body.email ? String(body.email).toLowerCase().trim() : undefined,
      phone: body.phone ? String(body.phone).trim() : undefined,
      companyAddress: body.companyAddress ?? body.company_address ?? undefined,
      companyDetailsComplete: true,
      kycStatus: "pending",
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const client = await Client.create(payload);
    return res.status(201).json({ message: "Client created", client });
  } catch (err) {
    console.error("createClient error:", err);
    return res.status(500).json({ error: "Failed to create client" });
  }
};

export const upsertBasicDetails = async (req, res) => {
  try {
    const clientId = req.clientId; // set by clientMiddleware from JWT when available
    const payload = {
      companyName: req.body?.company_name?.trim(),
      contactPerson: req.body?.contact_person?.trim(),
      email: req.body?.email?.toLowerCase().trim(),
      phone: req.body?.phone?.trim(),
      companyDetailsComplete: true,
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    // If no clientId in token, create a new client from provided basic details
    if (!clientId) {
      const created = await Client.create(payload);
      return res.status(201).json({ message: "Client created from basic details", client: created });
    }

    // If clientId exists, validate and update
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: "Invalid client id in token" });
    }

    const client = await Client.findByIdAndUpdate(clientId, { $set: payload }, { new: true });
    if (!client) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "Client basic details updated", client });
  } catch (err) {
    console.error("upsertBasicDetails error:", err);
    return res.status(500).json({ error: "Failed to save client details" });
  }
};

export const getClients = async (_req, res) => {
  try {
    const clients = await Client.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: clients });
  } catch (err) {
    console.error("getClients error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
};

export const getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    return res.json(client);
  } catch (err) {
    console.error("getClientById error:", err);
    return res.status(500).json({ error: "Failed to fetch client" });
  }
};

export const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Client.findByIdAndUpdate(id, { $set: req.body || {} }, { new: true });
    if (!updated) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "Client updated", client: updated });
  } catch (err) {
    console.error("updateClient error:", err);
    return res.status(500).json({ error: "Failed to update client" });
  }
};

export const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Client.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "Client deleted" });
  } catch (err) {
    console.error("deleteClient error:", err);
    return res.status(500).json({ error: "Failed to delete client" });
  }
};

// Submit KYC documents: set kycDocuments and kycStatus=pending
export const submitKycDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const { kyc_documents } = req.body || {};

    // Upload incoming files to ImageKit and collect URLs by field
    const files = Array.isArray(req.files) ? req.files : [];
    const uploadsByField = {};
    await Promise.all(
      files.map(async (f) => {
        const folder = process.env.IMAGEKIT_KYC_FOLDER || "/ofis-square/kyc";
        const result = await imagekit.upload({
          file: f.buffer, // Buffer supported by SDK
          fileName: f.originalname || `${Date.now()}_${f.fieldname}`,
          folder,
        });
        const entry = {
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          url: result?.url,
          fileId: result?.fileId,
        };
        if (!uploadsByField[f.fieldname]) uploadsByField[f.fieldname] = [];
        uploadsByField[f.fieldname].push(entry);
      })
    );

    // Merge body-provided KYC data and uploaded file URLs
    const mergedKyc = {
      ...(kyc_documents ?? req.body?.kycDocuments ?? {}),
      ...(Object.keys(uploadsByField).length ? { files: uploadsByField } : {}),
    };

    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycDocuments: mergedKyc, kycStatus: "verified" } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "KYC submitted and set to verified", client: updated });
  } catch (err) {
    console.error("submitKycDocuments error:", err);
    return res.status(500).json({ error: "Failed to submit KYC documents" });
  }
};

export const verifyKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Client.findByIdAndUpdate(id, { $set: { kycStatus: "verified" } }, { new: true });
    if (!updated) return res.status(404).json({ error: "Client not found" });

    // After verification, create a draft Contract for this client
    try {
      const start = new Date();
      const end = new Date(start);
      end.setFullYear(start.getFullYear() + 1);

      await Contract.create({
        client: id,
        startDate: start,
        endDate: end,
        fileUrl: "placeholder",
        // status will default to 'draft' based on the model
      });
    } catch (e) {
      // Log but do not block the response
      console.error("verifyKyc: failed to create contract:", e);
    }

    return res.json({ message: "KYC verified", client: updated });
  } catch (err) {
    console.error("verifyKyc error:", err);
    return res.status(500).json({ error: "Failed to verify KYC" });
  }
};

export const rejectKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycStatus: "rejected", ...(reason && { kycRejectionReason: reason }) } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "KYC rejected", client: updated });
  } catch (err) {
    console.error("rejectKyc error:", err);
    return res.status(500).json({ error: "Failed to reject KYC" });
  }
};
