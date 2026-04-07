import mongoose from "mongoose";
import RFIDCard from "../models/rfidCardModel.js";
import ProvisioningJob from "../models/provisioningJobModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import Role from "../models/roleModel.js";
import User from "../models/userModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Building from "../models/buildingModel.js";
import bcrypt from "bcryptjs";
import { Readable } from "stream";
import csv from "csv-parser";

export const listRFIDCards = async (req, res) => {
  try {
    const { buildingId, status, currentMemberId, q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (status) filter.status = status;
    if (currentMemberId) filter.currentMemberId = currentMemberId;
    if (q) {
      filter.$or = [
        { cardUid: new RegExp(String(q), "i") },
        { facilityCode: new RegExp(String(q), "i") },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      RFIDCard.find(filter)
        .populate({ path: 'clientId', select: 'companyName legalName email' })
        .populate({ path: 'companyUserId', select: 'name email' })
        .populate({ path: 'currentMemberId', select: 'firstName lastName email' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
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
    const { buildingId, cardUid, facilityCode, technology, cardType = "PHYSICAL", status = "ISSUED", expiresAt } = req.body || {};
    if (!cardUid || !String(cardUid).trim()) return res.status(400).json({ success: false, message: "cardUid is required" });

    const created = await RFIDCard.create({
      buildingId: buildingId || undefined,
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
    const card = await RFIDCard.findById(id)
      .populate({ path: 'clientId', select: 'companyName legalName email' })
      .populate({ path: 'companyUserId', select: 'name email' })
      .populate({ path: 'currentMemberId', select: 'firstName lastName email' })
      .lean();
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
    const { memberId } = req.body || {};
    if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) return res.status(400).json({ success: false, message: "Valid memberId is required" });
    const card = await RFIDCard.findById(id);
    if (!card) return res.status(404).json({ success: false, message: "Not found" });

    // Enqueue provisioning for assignment
    try {
      await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "ASSIGN_CARD", memberId, cardId: card._id, payload: { cardUid: card.cardUid, memberId } });
    } catch (e) { /* swallow */ }

    await logCRUDActivity(req, "UPDATE", "RFIDCard", card._id, null, { assignedMemberId: memberId });
    return res.json({ success: true, data: card, message: "Assignment job enqueued" });
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
      await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "REVOKE_CARD", cardId: updated._id, payload: { cardUid: updated.cardUid } });
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
      await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "REVOKE_CARD", cardId: oldCard._id, payload: { cardUid: oldCard.cardUid } });
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

// Helper to ensure we have a "Company Access" user for a client (reuses existing or creates new)
export async function ensureCompanyAccessUserForClient(client, companyLabelInput) {
  let role = await Role.findOne({ roleName: "Company Access" });
  if (!role) {
    role = await Role.create({
      roleName: "Company Access",
      description: "Client-scoped user who can manage access cards for their members",
      canLogin: true,
      permissions: ["rfid:assign:member"],
    });
  }
  // Try existing user
  const existing = await User.findOne({ clientId: client._id, role: role._id });
  if (existing) {
    return { user: existing, created: false, role };
  }
  const genRandom10 = () => {
    let s = "";
    while (s.length < 10) s += Math.floor(Math.random() * 10).toString();
    return s.slice(0, 10);
  };
  const makeDomainFromCompany = (name) => {
    const slug = String(name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30) || "client";
    return `${slug}.com`;
  };
  const companyLabel = (companyLabelInput || client.companyName || client.legalName || "Company").trim();
  let contactPhone = genRandom10();
  const domain = makeDomainFromCompany(companyLabel);
  let contactEmail = `${contactPhone}@${domain}`;
  // Add a non-primary contact person to Client
  try {
    if (!Array.isArray(client.contactPersons)) client.contactPersons = [];
    client.contactPersons.push({
      first_name: companyLabel,
      last_name: undefined,
      email: contactEmail,
      phone: contactPhone,
      mobile: contactPhone,
      designation: "Company Access",
      department: undefined,
      is_primary_contact: false,
      enable_portal: false,
    });
    await client.save();
  } catch {}
  // Create user with retry on duplicates
  let ownerUser = null;
  let attempts = 0;
  while (!ownerUser && attempts < 3) {
    attempts += 1;
    try {
      ownerUser = await User.create({
        name: companyLabel,
        email: contactEmail,
        password: '123456',
        role: role._id,
        clientId: client._id,
        phone: contactPhone,
      });
    } catch (e) {
      if (e?.code === 11000) {
        const msg = String(e?.message || "");
        if (msg.includes("phone")) {
          contactPhone = genRandom10();
          contactEmail = `${contactPhone}@${domain}`;
          continue;
        }
        if (msg.includes("email")) {
          contactEmail = `${contactPhone}+${Date.now()}@${domain}`;
          continue;
        }
      }
      throw e;
    }
  }
  return { user: ownerUser, created: true, role };
}

export const assignClientToCard = async (req, res) => {
  try {
    const { id } = req.params;
    const { clientId } = req.body || {};
    // Prevent client/company scoped users from invoking this (only community/staff/admin should)
    const roleName = (req.user?.role?.roleName || '').toLowerCase();
    if (roleName === 'client' || roleName === 'company access') {
      return res.status(403).json({ success: false, message: 'Not authorized to assign card to client' });
    }
    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ success: false, message: "Valid clientId is required" });
    }

    const [card, client] = await Promise.all([
      RFIDCard.findById(id),
      Client.findById(clientId)
    ]);
    if (!card) return res.status(404).json({ success: false, message: "Card not found" });
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });

    // Reject if card is already assigned to any client
    if (card.clientId) {
      return res.status(400).json({ success: false, message: "Card is already assigned to a client" });
    }

    const companyLabel = (client.companyName || client.legalName || "Company").trim();
    const { user: ownerUser } = await ensureCompanyAccessUserForClient(client, companyLabel);

    // Update card linkage to client and the (existing or newly created) company user
    const before = card.toObject();
    card.clientId = client._id;
    card.companyUserId = ownerUser?._id || card.companyUserId;
    card.status = "ISSUED";
    card.issuedAt = card.issuedAt || new Date();
    await card.save();

    await logCRUDActivity(req, "UPDATE", "RFIDCard", card._id, { before, after: card.toObject(), fields: ["clientId", "companyUserId"] }, { clientId: client._id, companyUserId: ownerUser?._id });
    const populatedCard = await RFIDCard.findById(card._id)
      .populate({ path: 'clientId', select: 'companyName legalName email' })
      .populate({ path: 'companyUserId', select: 'name email' })
      .populate({ path: 'currentMemberId', select: 'firstName lastName email' })
      .lean();
    const companyUser = ownerUser ? { _id: ownerUser._id, name: ownerUser.name, email: ownerUser.email } : null;
    return res.json({ success: true, data: { card: populatedCard, companyUser }, message: "Card assigned to client and company user linked" });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:AssignClient");
    return res.status(500).json({ success: false, message: err?.message || "Failed to assign client" });
  }
};

export const assignMemberToCardByCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberId } = req.body || {};
    if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) return res.status(400).json({ success: false, message: "Valid memberId is required" });

    const [card, member] = await Promise.all([
      RFIDCard.findById(id),
      Member.findById(memberId)
    ]);
    if (!card) return res.status(404).json({ success: false, message: "Card not found" });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    if (!card.clientId) return res.status(400).json({ success: false, message: "Card is not linked to any client" });

    const isOwner = String(req.user?._id) === String(card.companyUserId || "");
    const sameClient = req.user?.clientId && String(req.user.clientId) === String(card.clientId);
    if (!isOwner && !sameClient) {
      return res.status(403).json({ success: false, message: "Not authorized to assign this card" });
    }

    if (!member.client || String(member.client) !== String(card.clientId)) {
      return res.status(400).json({ success: false, message: "Member does not belong to this client" });
    }

    try {
      await ProvisioningJob.create({ vendor: "MATRIX_COSEC", jobType: "ASSIGN_CARD", memberId, cardId: card._id, payload: { cardUid: card.cardUid, memberId } });
    } catch {}

    const before = card.toObject();
    card.currentMemberId = member._id;
    await card.save();

    await logCRUDActivity(req, "UPDATE", "RFIDCard", card._id, { before, after: card.toObject(), fields: ["currentMemberId"] }, { assignedMemberId: memberId });
    return res.json({ success: true, data: card, message: "Assignment job enqueued" });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:AssignMemberCompany");
    return res.status(500).json({ success: false, message: "Failed to assign member" });
  }
};

// CSV Import: sample CSV download
export const downloadSampleCSV = async (req, res) => {
  try {
    const headers = [
      "cardUid",
      "building",
      "facilityCode",
      "technology",
      "cardType",
      "status",
      "expiresAt"
    ];
    const sampleRows = [
      ["ABC1234567", "Ofis Square - Koramangala", "1001", "MIFARE", "PHYSICAL", "ISSUED", "2026-12-31"],
      ["XYZ7654321", "Ofis Square - HSR", "1002", "GENERIC", "PHYSICAL", "ACTIVE", ""]
    ];
    const lines = [headers.join(","), ...sampleRows.map(r => r.join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=rfid-cards-sample.csv");
    return res.status(200).send(lines);
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:DownloadSampleCSV");
    return res.status(500).json({ success: false, message: "Failed to generate sample CSV" });
  }
};

// CSV Import: parse and import
export const importRFIDCardsFromCSV = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: "CSV file is required (field name: file)" });
    }

    const mode = (req.query.mode || "upsert").toLowerCase(); // 'upsert' | 'insert'
    const dryRun = String(req.query?.dryRun ?? req.body?.dryRun ?? 'false').toLowerCase() === 'true';
    const allowedTech = ["EM4100", "MIFARE", "HID", "ISO14443", "GENERIC"];
    const allowedCardType = ["PHYSICAL", "MOBILE", "VIRTUAL"];
    const allowedStatus = ["ISSUED", "ACTIVE", "SUSPENDED", "REVOKED", "LOST", "DAMAGED", "EXPIRED"];

    // Load buildings once to map names => ids
    const buildings = await Building.find({}, { _id: 1, name: 1 }).lean();
    const buildingNameMap = new Map(); // normalized name -> ObjectId string
    for (const b of buildings) {
      const key = String(b.name || "").trim().toLowerCase();
      if (key) buildingNameMap.set(key, String(b._id));
    }

    const rows = await new Promise((resolve, reject) => {
      const out = [];
      let index = 0;
      const stream = Readable.from([req.file.buffer]);
      stream
        .pipe(csv())
        .on("data", (data) => {
          index += 1;
          out.push({ __line: index, ...data });
        })
        .on("end", () => resolve(out))
        .on("error", reject);
    });

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "CSV appears to be empty" });
    }

    // If dryRun, we follow the cabin preview structure
    const perRow = [];
    let validCount = 0;
    let invalidCount = 0;

    // For non-dry-run legacy counters
    const errors = [];
    const toInsert = [];
    const bulkOps = [];
    let total = 0;

    for (const row of rows) {
      total += 1;
      const rawUid = row.cardUid || row.carduid || row["Card UID"] || row["card_uid"]; // tolerate some header variations
      const cardUid = rawUid ? String(rawUid).trim() : "";
      const rowErrors = [];
      const originalRow = { ...row };
      if (!cardUid) {
        if (dryRun) {
          invalidCount++;
          perRow.push({ index: row.__line, success: false, errors: ["cardUid is required"], originalRow });
        } else {
          errors.push({ line: row.__line, reason: "cardUid is required" });
        }
        continue;
      }

      // Resolve building (required) from id or name
      const buildingRaw = row.buildingId || row["building_id"] || row.building || row["Building"] || row.buildingName || row["buildingName"];
      let resolvedBuildingId;
      if (buildingRaw) {
        const br = String(buildingRaw).trim();
        if (mongoose.Types.ObjectId.isValid(br)) {
          resolvedBuildingId = new mongoose.Types.ObjectId(br);
        } else {
          const mapped = buildingNameMap.get(br.toLowerCase());
          if (mapped && mongoose.Types.ObjectId.isValid(mapped)) {
            resolvedBuildingId = new mongoose.Types.ObjectId(mapped);
          }
        }
      }
      if (!resolvedBuildingId) {
        if (dryRun) {
          invalidCount++;
          perRow.push({ index: row.__line, success: false, errors: ["building is required and must match an existing building (by name or id)"], originalRow });
        } else {
          errors.push({ line: row.__line, reason: "building is required and must match an existing building (by name or id)" });
        }
        continue;
      }

      const facilityCode = row.facilityCode ? String(row.facilityCode).trim() : undefined;
      const technology = row.technology ? String(row.technology).trim().toUpperCase() : undefined;
      const cardType = row.cardType ? String(row.cardType).trim().toUpperCase() : undefined;
      const status = row.status ? String(row.status).trim().toUpperCase() : undefined;

      if (technology && !allowedTech.includes(technology)) {
        if (dryRun) {
          invalidCount++;
          perRow.push({ index: row.__line, success: false, errors: [`Invalid technology '${technology}'`], originalRow });
        } else {
          errors.push({ line: row.__line, reason: `Invalid technology '${technology}'` });
        }
        continue;
      }
      if (cardType && !allowedCardType.includes(cardType)) {
        if (dryRun) {
          invalidCount++;
          perRow.push({ index: row.__line, success: false, errors: [`Invalid cardType '${cardType}'`], originalRow });
        } else {
          errors.push({ line: row.__line, reason: `Invalid cardType '${cardType}'` });
        }
        continue;
      }
      if (status && !allowedStatus.includes(status)) {
        if (dryRun) {
          invalidCount++;
          perRow.push({ index: row.__line, success: false, errors: [`Invalid status '${status}'`], originalRow });
        } else {
          errors.push({ line: row.__line, reason: `Invalid status '${status}'` });
        }
        continue;
      }

      const parseDate = (v) => {
        if (!v) return undefined;
        const d = new Date(String(v).trim());
        return isNaN(d.getTime()) ? undefined : d;
      };

      const expiresAt = parseDate(row.expiresAt || row.expiry || row["expires_at"]);
      const issuedAt = parseDate(row.issuedAt);
      const activatedAt = parseDate(row.activatedAt);

      const baseDoc = {
        buildingId: resolvedBuildingId,
        cardUid,
        facilityCode: facilityCode || undefined,
        technology: technology || undefined,
        cardType: cardType || "PHYSICAL",
        status: status || "ISSUED",
        expiresAt: expiresAt || undefined,
      };

      if (dryRun) {
        validCount++;
        perRow.push({
          index: row.__line,
          success: true,
          preview: {
            building: baseDoc.buildingId,
            cardUid: baseDoc.cardUid,
            facilityCode: baseDoc.facilityCode || null,
            technology: baseDoc.technology || null,
            cardType: baseDoc.cardType,
            status: baseDoc.status,
            expiresAt: baseDoc.expiresAt || null,
          },
          originalRow,
        });
        continue;
      }

      // Non-dry-run actual import path mirrors previous behavior
      if (mode === "insert") {
        toInsert.push({
          ...baseDoc,
          issuedAt: issuedAt || new Date(),
          activatedAt: activatedAt || undefined,
        });
      } else {
        const update = {
          $set: {
            buildingId: baseDoc.buildingId,
            facilityCode: baseDoc.facilityCode || undefined,
            technology: baseDoc.technology || undefined,
            cardType: baseDoc.cardType,
            status: baseDoc.status,
            expiresAt: baseDoc.expiresAt || undefined,
          },
          $setOnInsert: {
            cardUid: baseDoc.cardUid,
            issuedAt: issuedAt || new Date(),
            activatedAt: activatedAt || undefined,
          },
        };
        bulkOps.push({
          updateOne: {
            filter: { cardUid },
            update,
            upsert: true,
          },
        });
      }
    }

    if (dryRun) {
      const summary = {
        totalRows: rows.length,
        validRows: validCount,
        invalidRows: invalidCount,
        created: 0,
      };
      return res.json({
        success: true,
        dryRun: true,
        counts: { total: rows.length, valid: validCount, invalid: invalidCount, created: 0 },
        summary,
        canImport: validCount > 0,
        results: perRow,
      });
    }

    let insertedCount = 0;
    let updatedCount = 0;

    if (mode === "insert") {
      if (!toInsert.length) {
        return res.status(400).json({ success: false, message: "No valid rows to insert", errors });
      }
      try {
        const insertRes = await RFIDCard.insertMany(toInsert, { ordered: false });
        insertedCount = insertRes.length;
      } catch (e) {
        // Handle duplicate key errors etc.
        const writeErrors = e?.writeErrors || [];
        insertedCount = (e?.result?.nInserted) || 0;
        for (const we of writeErrors) {
          const idx = we?.index;
          errors.push({ line: rows[idx]?.__line || idx, reason: we?.errmsg || we?.message || "Insert error" });
        }
      }
    } else {
      if (bulkOps.length) {
        const result = await RFIDCard.bulkWrite(bulkOps, { ordered: false });
        insertedCount = result?.upsertedCount || 0;
        // For updates, matchedCount includes upserts; modifiedCount is more accurate for actual changes
        updatedCount = result?.modifiedCount || 0;
      }
    }

    const skippedCount = errors.length;

    try {
      await logCRUDActivity(req, "BULK_IMPORT", "RFIDCard", null, null, {
        totalRows: total,
        insertedCount,
        updatedCount,
        skippedCount,
        mode,
      });
    } catch {}

    return res.json({
      success: true,
      summary: { totalRows: total, insertedCount, updatedCount, skippedCount, mode },
      errors,
    });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:ImportCSV");
    const msg = err?.message || "Failed to import RFID cards";
    return res.status(500).json({ success: false, message: msg });
  }
};

// CSV: sample for assigning clients to cards
export const downloadAssignClientSampleCSV = async (req, res) => {
  try {
    const headers = ["cardUid", "client"]; // client can be clientId or companyName/legalName
    const sampleRows = [
      ["ABC1234567", "Acme Corp"],
      ["XYZ7654321", "65f0e2c1b7c4e2a0a1b2c3d4"],
    ];
    const lines = [headers.join(","), ...sampleRows.map(r => r.join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=rfid-card-client-assignment-sample.csv");
    return res.status(200).send(lines);
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:DownloadAssignClientSampleCSV");
    return res.status(500).json({ success: false, message: "Failed to generate sample CSV" });
  }
};

// CSV: bulk assignment of clients to cards using same logic as assignClientToCard
export const importRFIDCardClientAssignmentsFromCSV = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: "CSV file is required (field name: file)" });
    }

    const dryRun = String(req.query?.dryRun || "false").toLowerCase() === "true";

    const rows = await new Promise((resolve, reject) => {
      const out = [];
      let index = 0;
      const stream = Readable.from([req.file.buffer]);
      stream
        .pipe(csv())
        .on("data", (data) => {
          index += 1;
          out.push({ __line: index, ...data });
        })
        .on("end", () => resolve(out))
        .on("error", reject);
    });

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "CSV appears to be empty" });
    }

    const errors = [];
    let total = 0;
    let assignedCount = 0;

    // Preload role for dry-run checks (avoid creation during dryRun)
    let companyAccessRole = await Role.findOne({ roleName: "Company Access" });
    let willCreateRole = false;
    if (dryRun && !companyAccessRole) {
      // Indicate role will be created during import
      willCreateRole = true;
    }

    // For preview mode, collect structured results per row
    const previewResults = [];

    for (const row of rows) {
      total += 1;
      const rawUid = row.cardUid || row.carduid || row["Card UID"] || row["card_uid"]; // tolerate some header variations
      const cardUid = rawUid ? String(rawUid).trim() : "";
      if (!cardUid) {
        if (dryRun) {
          previewResults.push({
            success: false,
            originalRow: row,
            errors: ["cardUid is required"],
          });
        } else {
          errors.push({ line: row.__line, reason: "cardUid is required" });
        }
        continue;
      }

      const clientRaw = row.clientId || row.client || row.clientName || row["Client"]; // id or name
      if (!clientRaw) {
        if (dryRun) {
          previewResults.push({ success: false, originalRow: row, errors: ["client (id or name) is required"] });
        } else {
          errors.push({ line: row.__line, reason: "client (id or name) is required" });
        }
        continue;
      }

      const card = await RFIDCard.findOne({ cardUid });
      if (!card) {
        if (dryRun) {
          previewResults.push({ success: false, originalRow: row, errors: [`Card not found for cardUid '${cardUid}'`] });
        } else {
          errors.push({ line: row.__line, reason: `Card not found for cardUid '${cardUid}'` });
        }
        continue;
      }

      // Reject if already assigned
      if (card.clientId) {
        const msg = "Card is already assigned to a client";
        if (dryRun) {
          previewResults.push({ success: false, originalRow: row, errors: [msg] });
        } else {
          errors.push({ line: row.__line, reason: msg });
        }
        continue;
      }

      let client = null;
      const cr = String(clientRaw).trim();
      if (mongoose.Types.ObjectId.isValid(cr)) {
        client = await Client.findById(cr);
      } else {
        client = await Client.findOne({ $or: [
          { companyName: new RegExp(`^${cr}$`, 'i') },
          { legalName: new RegExp(`^${cr}$`, 'i') }
        ]});
      }
      if (!client) {
        if (dryRun) {
          previewResults.push({ success: false, originalRow: row, errors: [`Client not found for '${cr}'`] });
        } else {
          errors.push({ line: row.__line, reason: `Client not found for '${cr}'` });
        }
        continue;
      }

      if (dryRun) {
        // Determine if a Company Access user exists for this client without creating anything
        let willCreateUser = false;
        try {
          // refresh role if not loaded
          const roleToUse = companyAccessRole || (await Role.findOne({ roleName: "Company Access" }));
          if (!roleToUse) {
            willCreateUser = true; // role itself will be created during import
          } else {
            const existing = await User.findOne({ clientId: client._id, role: roleToUse._id });
            willCreateUser = !existing;
          }
        } catch {
          willCreateUser = true;
        }
        previewResults.push({
          success: true,
          originalRow: row,
          preview: {
            cardUid,
            cardId: card._id,
            clientId: client._id,
            clientName: client.companyName || client.legalName || client.email || String(client._id),
            willCreateRole,
            willCreateUser,
          },
          errors: [],
        });
        assignedCount += 1;
      } else {
        try {
          const companyLabel = (client.companyName || client.legalName || "Company").trim();
          const { user: ownerUser } = await ensureCompanyAccessUserForClient(client, companyLabel);
          const before = card.toObject();
          card.clientId = client._id;
          card.companyUserId = ownerUser?._id || card.companyUserId;
          card.status = "ISSUED";
          card.issuedAt = card.issuedAt || new Date();
          await card.save();
          await logCRUDActivity(req, "UPDATE", "RFIDCard", card._id, { before, after: card.toObject(), fields: ["clientId", "companyUserId"] }, { clientId: client._id, companyUserId: ownerUser?._id, csvLine: row.__line });
          assignedCount += 1;
        } catch (e) {
          errors.push({ line: row.__line, reason: e?.message || "Assignment failed" });
        }
      }
    }

    try {
      await logCRUDActivity(req, dryRun ? "BULK_PREVIEW" : "BULK_IMPORT", "RFIDCard:AssignClient", null, null, {
        totalRows: total,
        assignedCount,
        skippedCount: dryRun ? (total - assignedCount) : errors.length,
        dryRun,
      });
    } catch {}

    if (dryRun) {
      const previewCounts = { total, valid: assignedCount, invalid: total - assignedCount, willAssign: assignedCount };
      return res.json({ success: true, counts: previewCounts, results: previewResults });
    }

    return res.json({ success: true, summary: { totalRows: total, assignedCount, skippedCount: errors.length }, errors });
  } catch (err) {
    await logErrorActivity(req, err, "RFIDCards:ImportAssignClientCSV");
    const msg = err?.message || "Failed to import card-client assignments";
    return res.status(500).json({ success: false, message: msg });
  }
};
