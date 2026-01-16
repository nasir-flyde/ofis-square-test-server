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
    const { buildingId, status, q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (status) filter.status = status;
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

    // Determine a primary phone from client details (primary contact > any contact person > client.phone > contactNumber)
    let primaryPhone;
    const normalizePhone = (v) => (v ? String(v).replace(/\D/g, "") : undefined);
    try {
      if (Array.isArray(client.contactPersons) && client.contactPersons.length) {
        const primaryCP = client.contactPersons.find((cp) => cp?.is_primary_contact);
        const fromPrimary = normalizePhone(primaryCP?.phone || primaryCP?.mobile);
        if (fromPrimary) primaryPhone = fromPrimary;
        if (!primaryPhone) {
          for (const cp of client.contactPersons) {
            const p = normalizePhone(cp?.phone || cp?.mobile);
            if (p) { primaryPhone = p; break; }
          }
        }
      }
      if (!primaryPhone && client.phone) primaryPhone = normalizePhone(client.phone);
      if (!primaryPhone && client.contactNumber) primaryPhone = normalizePhone(client.contactNumber);
    } catch {}

    // Ensure Company Access User role exists
    let role = await Role.findOne({ roleName: "Company Access" });
    if (!role) {
      role = await Role.create({
        roleName: "Company Access",
        description: "Client-scoped user who can manage access cards for their members",
        canLogin: true,
        permissions: ["rfid:assign:member"],
      });
    }

    // Determine company user from client context
    const ownerEmailFromClient = client.email ? String(client.email).toLowerCase().trim() : undefined;
    if (!ownerEmailFromClient) {
      return res.status(400).json({ success: false, message: "Client email is required to auto-create company user" });
    }

    // 1) Prefer an existing Company Access user scoped to this client
    let ownerUser = await User.findOne({ clientId: client._id, role: role._id });

    // 2) If not found, try by email; if a user exists with that email, DO NOT modify it.
    //    Instead create a new Company Access user with a unique dummy email on the same domain.
    if (!ownerUser) {
      const existingByEmail = await User.findOne({ email: ownerEmailFromClient });
      if (existingByEmail) {
        const nameFromClient = (client.companyName || client.legalName || "Company Access").trim();
        const domain = ownerEmailFromClient.includes('@') ? ownerEmailFromClient.split('@')[1] : 'example.com';
        const dummyLocal = `company+${String(client.companyName).slice(-6)}+${Date.now()}`;
        const dummyEmail = `${dummyLocal}@${domain}`;
        const hashed = await bcrypt.hash(Math.random().toString(36).slice(-10), 10);
        try {
          ownerUser = await User.create({
            name: nameFromClient,
            email: dummyEmail,
            password: hashed,
            role: role._id,
            clientId: client._id,
            phone: primaryPhone || undefined,
          });
        } catch (e) {
          // In case phone collides with an existing user, retry without phone
          if (e?.code === 11000 && String(e?.message || '').includes('phone')) {
            ownerUser = await User.create({
              name: nameFromClient,
              email: dummyEmail,
              password: hashed,
              role: role._id,
              clientId: client._id,
            });
          } else {
            throw e;
          }
        }
      }
    }

    // 3) If still not found, create a new Company Access user with client details
    if (!ownerUser) {
      const nameFromClient = (client.companyName || client.legalName || "Company Access").trim();
      const hashed = await bcrypt.hash(Math.random().toString(36).slice(-10), 10);
      try {
        ownerUser = await User.create({
          name: nameFromClient,
          email: ownerEmailFromClient,
          password: hashed,
          role: role._id,
          clientId: client._id,
          phone: primaryPhone || undefined,
        });
      } catch (e) {
        // In case phone collides, retry without phone
        if (e?.code === 11000 && String(e?.message || '').includes('phone')) {
          ownerUser = await User.create({
            name: nameFromClient,
            email: ownerEmailFromClient,
            password: hashed,
            role: role._id,
            clientId: client._id,
          });
        } else {
          throw e;
        }
      }
    }

    // 4) If we found/created ownerUser but phone differs/missing, try to align to primary phone (best-effort)
    if (ownerUser && primaryPhone && String(ownerUser.phone || '').replace(/\D/g, '') !== primaryPhone) {
      try {
        await User.updateOne({ _id: ownerUser._id }, { $set: { phone: primaryPhone } });
        ownerUser.phone = primaryPhone;
      } catch (e) {
        // Ignore duplicate phone errors to avoid breaking the flow
      }
    }

    // Update card linkage
    const before = card.toObject();
    card.clientId = client._id;
    card.companyUserId = ownerUser?._id || card.companyUserId;
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

    const errors = [];
    const toInsert = [];
    const bulkOps = [];
    let total = 0;

    for (const row of rows) {
      total += 1;
      const rawUid = row.cardUid || row.carduid || row["Card UID"] || row["card_uid"]; // tolerate some header variations
      const cardUid = rawUid ? String(rawUid).trim() : "";
      if (!cardUid) {
        errors.push({ line: row.__line, reason: "cardUid is required" });
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
        errors.push({ line: row.__line, reason: "building is required and must match an existing building (by name or id)" });
        continue;
      }

      const facilityCode = row.facilityCode ? String(row.facilityCode).trim() : undefined;
      const technology = row.technology ? String(row.technology).trim().toUpperCase() : undefined;
      const cardType = row.cardType ? String(row.cardType).trim().toUpperCase() : undefined;
      const status = row.status ? String(row.status).trim().toUpperCase() : undefined;

      if (technology && !allowedTech.includes(technology)) {
        errors.push({ line: row.__line, reason: `Invalid technology '${technology}'` });
        continue;
      }
      if (cardType && !allowedCardType.includes(cardType)) {
        errors.push({ line: row.__line, reason: `Invalid cardType '${cardType}'` });
        continue;
      }
      if (status && !allowedStatus.includes(status)) {
        errors.push({ line: row.__line, reason: `Invalid status '${status}'` });
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
