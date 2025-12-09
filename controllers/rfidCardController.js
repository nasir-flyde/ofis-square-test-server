import mongoose from "mongoose";
import RFIDCard from "../models/rfidCardModel.js";
import ProvisioningJob from "../models/provisioningJobModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

export const listRFIDCards = async (req, res) => {
  try {
    const { buildingId, clientId, memberId, status, q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (clientId) filter.clientId = clientId;
    if (memberId) filter.memberId = memberId;
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { cardUid: new RegExp(String(q), "i") },
        { facilityCode: new RegExp(String(q), "i") },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      RFIDCard.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      RFIDCard.countDocuments(filter),
    ]);
    return res.json({ success: true, data: items, pagination: { currentPage: Number(page)||1, totalPages: Math.ceil(total/Number(limit||1)), totalRecords: total, hasMore: skip + Number(limit) < total } });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:List");
    return res.status(500).json({ success: false, message: "Failed to list cards" });
  }
};

export const createRFIDCard = async (req, res) => {
  try {
    const { buildingId, clientId, memberId, cardUid, facilityCode, technology, cardType = "PHYSICAL", status = "ISSUED", expiresAt } = req.body || {};
    if (!cardUid || !String(cardUid).trim()) return res.status(400).json({ success: false, message: "cardUid is required" });

    const created = await RFIDCard.create({
      buildingId: buildingId || undefined,
      clientId: clientId || undefined,
      memberId: memberId || undefined,
      cardUid: String(cardUid).trim(),
      facilityCode: facilityCode || undefined,
      technology: technology || undefined,
      cardType,
      status,
      issuedAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    await logCRUDActivity(req, "CREATE", "RFIDCard", created._id, null, { cardUid: created.cardUid });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    const code = err?.code === 11000 ? 400 : 500;
    await logErrorActivity(req, err, "RFIDCards:Create");
    return res.status(code).json({ success: false, message: err?.message || "Failed to create card" });
  }
};

export const getRFIDCardById = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await RFIDCard.findById(id).lean();
    if (!card) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: card });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:Get");
    return res.status(500).json({ success: false, message: "Failed to fetch card" });
  }
};

export const assignMemberToCard = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberId, clientId } = req.body || {};
    if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) return res.status(400).json({ success: false, message: "Valid memberId is required" });
    const updated = await RFIDCard.findByIdAndUpdate(id, { memberId, clientId: clientId || undefined }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });

    // Enqueue provisioning for assignment
    try {
      await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "ASSIGN_CARD", memberId, cardId: updated._id, payload: { cardUid: updated.cardUid, memberId } });
    } catch (e) { /* swallow */ }

    await logCRUDActivity(req, "UPDATE", "RFIDCard", updated._id, null, { memberId: updated.memberId });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:AssignMember");
    return res.status(500).json({ success: false, message: "Failed to assign member" });
  }
};

export const activateRFIDCard = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await RFIDCard.findByIdAndUpdate(id, { status: "ACTIVE", activatedAt: new Date() }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });

    if (updated.memberId) {
      try {
        await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "ASSIGN_CARD", memberId: updated.memberId, cardId: updated._id, payload: { cardUid: updated.cardUid, memberId: updated.memberId } });
      } catch {}
    }

    await logCRUDActivity(req, "UPDATE", "RFIDCard", updated._id, null, { status: updated.status });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:Activate");
    return res.status(500).json({ success: false, message: "Failed to activate card" });
  }
};

export const suspendRFIDCard = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await RFIDCard.findByIdAndUpdate(id, { status: "SUSPENDED", suspendedAt: new Date() }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });
    await logCRUDActivity(req, "UPDATE", "RFIDCard", updated._id, null, { status: updated.status });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:Suspend");
    return res.status(500).json({ success: false, message: "Failed to suspend card" });
  }
};

export const revokeRFIDCard = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await RFIDCard.findByIdAndUpdate(id, { status: "REVOKED", revokedAt: new Date() }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });

    try {
      await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "REVOKE_CARD", cardId: updated._id, memberId: updated.memberId || undefined, payload: { cardUid: updated.cardUid } });
    } catch {}

    await logCRUDActivity(req, "UPDATE", "RFIDCard", updated._id, null, { status: updated.status });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:Revoke");
    return res.status(500).json({ success: false, message: "Failed to revoke card" });
  }
};

export const markLostRFIDCard = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await RFIDCard.findByIdAndUpdate(id, { status: "LOST" }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Not found" });
    await logCRUDActivity(req, "UPDATE", "RFIDCard", updated._id, null, { status: updated.status });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:Lost");
    return res.status(500).json({ success: false, message: "Failed to mark lost" });
  }
};

export const replaceRFIDCard = async (req, res) => {
  try {
    const { id } = req.params; // old card id
    const { newCardUid, technology, cardType = "PHYSICAL", facilityCode } = req.body || {};
    const oldCard = await RFIDCard.findById(id);
    if (!oldCard) return res.status(404).json({ success: false, message: "Old card not found" });
    if (!newCardUid) return res.status(400).json({ success: false, message: "newCardUid is required" });

    const newCard = await RFIDCard.create({
      buildingId: oldCard.buildingId || undefined,
      clientId: oldCard.clientId || undefined,
      memberId: oldCard.memberId || undefined,
      cardUid: String(newCardUid).trim(),
      facilityCode: facilityCode || undefined,
      technology: technology || oldCard.technology,
      cardType,
      status: "ACTIVE",
      issuedAt: new Date(),
      activatedAt: new Date(),
    });

    oldCard.replacedById = newCard._id;
    oldCard.status = "REVOKED";
    oldCard.revokedAt = new Date();
    await oldCard.save();

    try {
      await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "REVOKE_CARD", cardId: oldCard._id, memberId: oldCard.memberId || undefined, payload: { cardUid: oldCard.cardUid } });
      if (newCard.memberId) {
        await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "ASSIGN_CARD", cardId: newCard._id, memberId: newCard.memberId, payload: { cardUid: newCard.cardUid, memberId: newCard.memberId } });
      }
    } catch {}

    await logCRUDActivity(req, "UPDATE", "RFIDCard", oldCard._id, null, { replacedById: newCard._id });
    await logCRUDActivity(req, "CREATE", "RFIDCard", newCard._id, null, { replacedFrom: oldCard._id });

    return res.json({ success: true, data: { oldCard, newCard } });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:Replace");
    const code = err?.code === 11000 ? 400 : 500;
    return res.status(code).json({ success: false, message: err?.message || "Failed to replace card" });
  }
};
