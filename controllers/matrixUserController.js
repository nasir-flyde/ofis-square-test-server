import MatrixUser from "../models/matrixUserModel.js";
import RFIDCard from "../models/rfidCardModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import AccessPoint from "../models/accessPointModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import EnrollmentDetail from "../models/enrollmentDetailModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import matrixApi from "../utils/matrixApi.js";

export const createMatrixUser = async (req, res) => {
  try {
    const {
      buildingId,
      clientId,
      memberId,
      name,
      phone,
      email,
      externalUserId, // required for Matrix user identity (maps to matrixApi id)
      cards = [],
      validTill,
      status = "active",
      meta,
      createOnMatrix = false,
      policyId,
    } = req.body || {};

    if (!name || !externalUserId) {
      return res.status(400).json({ success: false, message: "name and externalUserId are required" });
    }

    // Optional: validate referenced cards exist
    if (Array.isArray(cards) && cards.length) {
      const existing = await RFIDCard.find({ _id: { $in: cards } }).select("_id");
      if (existing.length !== cards.length) {
        return res.status(400).json({ success: false, message: "One or more cardIds are invalid" });
      }
    }

    const payload = {
      buildingId,
      clientId,
      memberId,
      name: name.trim(),
      phone,
      email,
      externalUserId: String(externalUserId).trim(),
      cards,
      validTill,
      status,
      meta,
      ...(policyId ? { policyId } : {}),
    };

    // Create locally first
    const user = await MatrixUser.create(payload);

    // Optionally provision on Matrix COSEC
    if (createOnMatrix) {
      try {
        await matrixApi.createUser({ id: externalUserId, name, email, phone, status: status === "active" ? "active" : "inactive" });
      } catch (e) {
        // Log but do not fail local creation
        await logErrorActivity(req, e, "MatrixUser:CreateOnMatrix", { externalUserId });
      }
    }

    // If a policy is provided, derive device_ids from its access points and assign the user on Matrix
    if (policyId) {
      try {
        const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
        if (policy && Array.isArray(policy.accessPointIds) && policy.accessPointIds.length) {
          const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } })
            .select('deviceBindings')
            .lean();
          const matrixDeviceObjectIds = [];
          for (const ap of accessPoints) {
            const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
            for (const b of bindings) {
              if ((b?.vendor === 'MATRIX_COSEC') && b?.deviceId) {
                matrixDeviceObjectIds.push(String(b.deviceId));
              }
            }
          }
          const uniqueDeviceObjIds = Array.from(new Set(matrixDeviceObjectIds));
          let assignedCount = 0;
          if (uniqueDeviceObjIds.length) {
            const devices = await MatrixDevice.find({ _id: { $in: uniqueDeviceObjIds } })
              .select('device_id')
              .lean();
            for (const d of devices) {
              const device_id = d?.device_id;
              if (!device_id) continue;
              try {
                const resAssign = await matrixApi.assignUserToDevice({ device_id, externalUserId });
                if (resAssign?.ok) assignedCount += 1;
              } catch (e) {
                await logErrorActivity(req, e, 'MatrixUser:DeviceAssign', { externalUserId, device_id });
              }
            }
          }
          if (assignedCount > 0) {
            try {
              await MatrixUser.findByIdAndUpdate(
                user._id,
                { $set: { isDeviceAssigned: true, isEnrolled: true } },
                { new: true }
              );
            } catch (e) {
              await logErrorActivity(req, e, 'MatrixUser:FlagUpdate', { userId: user._id, assignedCount });
            }
          }
        }
      } catch (e) {
        await logErrorActivity(req, e, 'MatrixUser:PolicyAssign', { policyId, externalUserId });
      }
    }

    await logCRUDActivity(req, 'CREATE', 'MatrixUser', user._id, null, { name: user.name, externalUserId });
    // Return the updated user snapshot
    const fresh = await MatrixUser.findById(user._id).lean();
    return res.status(201).json({ success: true, data: fresh || user });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:Create');
    return res.status(500).json({ success: false, message: 'Failed to create matrix user' });
  }
};

export const listMatrixUsers = async (req, res) => {
  try {
    const { buildingId, clientId, memberId, status, q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (clientId) filter.clientId = clientId;
    if (memberId) filter.memberId = memberId;
    if (status) filter.status = status;
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } },
      { externalUserId: { $regex: q, $options: 'i' } },
    ];

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      MatrixUser.find(filter)
        .populate('clientId', 'companyName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      MatrixUser.countDocuments(filter),
    ]);

    return res.json({ success: true, data: items, pagination: { currentPage: Number(page)||1, totalPages: Math.ceil(total/Number(limit||1)), totalRecords: total } });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:List');
    return res.status(500).json({ success: false, message: 'Failed to list matrix users' });
  }
};

export const getMatrixUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MatrixUser.findById(id).populate('cards').lean();
    if (!item) return res.status(404).json({ success: false, message: 'Matrix user not found' });
    return res.json({ success: true, data: item });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:Get');
    return res.status(500).json({ success: false, message: 'Failed to get matrix user' });
  }
};

export const updateMatrixUser = async (req, res) => {
  try {
    const { id } = req.params;
    const update = { ...req.body };

    if (update.cards) {
      const cards = Array.isArray(update.cards) ? update.cards : [];
      const existing = await RFIDCard.find({ _id: { $in: cards } }).select("_id");
      if (existing.length !== cards.length) {
        return res.status(400).json({ success: false, message: "One or more cardIds are invalid" });
      }
    }

    const item = await MatrixUser.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    await logCRUDActivity(req, 'UPDATE', 'MatrixUser', item._id, null, update);
    return res.json({ success: true, data: item });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:Update');
    return res.status(500).json({ success: false, message: 'Failed to update matrix user' });
  }
};

export const deleteMatrixUser = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MatrixUser.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Matrix user not found' });
    await MatrixUser.deleteOne({ _id: id });
    await logCRUDActivity(req, 'DELETE', 'MatrixUser', id, null, null);
    return res.json({ success: true, message: 'Matrix user deleted' });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:Delete');
    return res.status(500).json({ success: false, message: 'Failed to delete matrix user' });
  }
};

export const addCardRef = async (req, res) => {
  try {
    const { id } = req.params;
    const { cardId } = req.body || {};
    if (!cardId) return res.status(400).json({ success: false, message: 'cardId is required' });

    const card = await RFIDCard.findById(cardId).select('_id');
    if (!card) return res.status(404).json({ success: false, message: 'RFID card not found' });

    const updated = await MatrixUser.findByIdAndUpdate(
      id,
      { $addToSet: { cards: cardId } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { addCard: cardId });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:AddCard');
    return res.status(500).json({ success: false, message: 'Failed to add card to matrix user' });
  }
};

export const addEnrollment = async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceId, externalDeviceId, refId, status = 'ENROLLED', meta } = req.body || {};
    if (!deviceId && !externalDeviceId) {
      return res.status(400).json({ success: false, message: 'deviceId or externalDeviceId is required' });
    }

    if (deviceId) {
      const dev = await MatrixDevice.findById(deviceId).select('_id');
      if (!dev) return res.status(404).json({ success: false, message: 'Matrix device not found' });
    }

    const enrollment = { deviceId, externalDeviceId, refId, status, meta, enrolledAt: new Date() };
    const updated = await MatrixUser.findByIdAndUpdate(
      id,
      { $push: { enrollments: enrollment } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { addEnrollment: enrollment });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:AddEnrollment');
    return res.status(500).json({ success: false, message: 'Failed to add enrollment' });
  }
};

export const setCardCredentialVerified = async (req, res) => {
  try {
    const { id } = req.params;
    const { verified = true } = req.body || {};
    const updated = await MatrixUser.findByIdAndUpdate(
      id,
      { isCardCredentialVerified: Boolean(verified) },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { isCardCredentialVerified: Boolean(verified) });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:SetCardVerified');
    return res.status(500).json({ success: false, message: 'Failed to update card verification state' });
  }
};

export const setValidity = async (req, res) => {
  try {
    const { id } = req.params;
    const { validTill } = req.body || {};
    if (!validTill) return res.status(400).json({ success: false, message: 'validTill is required' });
    const updated = await MatrixUser.findByIdAndUpdate(
      id,
      { validTill: new Date(validTill) },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { validTill: updated.validTill });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:SetValidity');
    return res.status(500).json({ success: false, message: 'Failed to set validity' });
  }
};

export const addAccessHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, accessPointId, policyId, notes } = req.body || {};
    if (!action || ["ACCESS_GRANTED", "ACCESS_REVOKED"].includes(action) === false) {
      return res.status(400).json({ success: false, message: 'action must be ACCESS_GRANTED or ACCESS_REVOKED' });
    }

    if (accessPointId) {
      const ap = await AccessPoint.findById(accessPointId).select('_id');
      if (!ap) return res.status(404).json({ success: false, message: 'AccessPoint not found' });
    }

    const entry = { action, accessPointId, policyId, notes, performedBy: req.user?._id, performedAt: new Date() };
    const updated = await MatrixUser.findByIdAndUpdate(
      id,
      { $push: { accessHistory: entry } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { accessHistory: entry });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:AddAccessHistory');
    return res.status(500).json({ success: false, message: 'Failed to add access history' });
  }
};

// Assign a Matrix user to a Matrix device using Matrix COSEC API
export const assignToDevice = async (req, res) => {
  try {
    const { id } = req.params; // MatrixUser _id
    const device_id = req.query.device_id || req.body?.device_id;
    const deviceId = req.query.deviceId || req.body?.deviceId; // optional Mongo _id of MatrixDevice

    // Resolve device_id if only deviceId provided
    let resolvedDeviceId = device_id;
    if (!resolvedDeviceId && deviceId) {
      try {
        const dev = await MatrixDevice.findById(deviceId).select('device_id').lean();
        resolvedDeviceId = dev?.device_id;
      } catch {}
    }
    if (!resolvedDeviceId) {
      return res.status(400).json({ success: false, message: 'device_id (or deviceId resolvable to device_id) is required' });
    }

    const user = await MatrixUser.findById(id).select('externalUserId').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Matrix user not found' });
    if (!user.externalUserId) return res.status(400).json({ success: false, message: 'Matrix user externalUserId missing' });

    const resp = await matrixApi.assignUserToDevice({ device_id: resolvedDeviceId, externalUserId: user.externalUserId });
    const ok = !!resp?.ok;
    if (ok) {
      try {
        await MatrixUser.findByIdAndUpdate(id, { $set: { isDeviceAssigned: true, isEnrolled: true } });
      } catch {}
      await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { assignToDevice: { device_id: resolvedDeviceId } });
    }
    return res.status(ok ? 200 : 502).json({ success: ok, data: resp?.data || null, status: resp?.status || 0 });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:AssignToDevice');
    return res.status(500).json({ success: false, message: err?.message || 'Failed to assign device' });
  }
};

export const enrollCardToDevice = async (req, res) => {
  try {
    const { id } = req.params; // MatrixUser _id
    const { policyId, enrollmentDetailId } = req.body || {};

    if (!policyId) return res.status(400).json({ success: false, message: 'policyId is required' });
    if (!enrollmentDetailId) return res.status(400).json({ success: false, message: 'enrollmentDetailId is required' });

    // Load enrollment detail to get enrollType and enrollCount
    const detail = await EnrollmentDetail.findById(enrollmentDetailId).lean();
    if (!detail) return res.status(404).json({ success: false, message: 'EnrollmentDetail not found' });
    const enrollType = detail?.enroll?.enrollType || 'card';
    const enrollCount = Number(detail?.enroll?.enrollCount || 1);

    const user = await MatrixUser.findById(id).select('externalUserId').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Matrix user not found' });
    if (!user.externalUserId) return res.status(400).json({ success: false, message: 'Matrix user externalUserId missing' });

    const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
    if (!policy || !Array.isArray(policy.accessPointIds) || policy.accessPointIds.length === 0) {
      return res.status(404).json({ success: false, message: 'Policy not found or has no access points' });
    }

    const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } })
      .select('deviceBindings')
      .lean();
    const matrixDeviceObjIds = [];
    for (const ap of accessPoints) {
      const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
      for (const b of bindings) {
        if ((b?.vendor === 'MATRIX_COSEC') && b?.deviceId) {
          matrixDeviceObjIds.push(String(b.deviceId));
        }
      }
    }
    const uniqueDeviceObjIds = Array.from(new Set(matrixDeviceObjIds));
    if (!uniqueDeviceObjIds.length) {
      return res.status(404).json({ success: false, message: 'No Matrix devices bound to the policy access points' });
    }

    // Resolve Matrix device_id strings and fetch per-device deviceType (Number)
    const devices = await MatrixDevice.find({ _id: { $in: uniqueDeviceObjIds } })
      .select('_id name device_id deviceType')
      .lean();

    const results = [];
    let successCount = 0;

    for (const d of devices) {
      // Enforce using numeric `device` field for COSEC device-id
      const deviceParam = (typeof d?.device === 'number' && Number.isFinite(d.device)) ? d.device : null;
      if (deviceParam === null) {
        results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, ok: false, error: 'Missing numeric `device` on MatrixDevice (device-id must use `device`)' });
        continue;
      }
      const deviceTypeNum = Number(d?.deviceType);
      const allowedDeviceTypes = [1, 16, 17];
      if (!allowedDeviceTypes.includes(deviceTypeNum)) {
        results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, ok: false, error: `Unsupported deviceType ${d?.deviceType}` });
        continue;
      }
      try {
        const resp = await matrixApi.enrollCardToDevice({ externalUserId: user.externalUserId, device: deviceParam, deviceType: deviceTypeNum, enrollType, enrollCount });
        const ok = !!resp?.ok;
        if (ok) {
          successCount += 1;
          // Attach enrollment entry with reference to EnrollmentDetail
          try {
            await MatrixUser.findByIdAndUpdate(
              id,
              { $push: { enrollments: { deviceId: d._id, status: 'ENROLLED', enrolledAt: new Date(), enrollmentDetailId } } }
            );
          } catch (e) {
            await logErrorActivity(req, e, 'MatrixUser:EnrollEntryAttach', { id, deviceMongoId: d._id, enrollmentDetailId });
          }
        }
        results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, usedDeviceParam: deviceParam, ok, status: resp?.status || 0, data: resp?.data || null, deviceType: deviceTypeNum, enrollType, enrollCount });
      } catch (e) {
        results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, usedDeviceParam: deviceParam, ok: false, error: e?.message });
      }
    }

    if (successCount > 0) {
      try { await MatrixUser.findByIdAndUpdate(id, { $set: { isEnrolled: true } }); } catch {}
    }

    await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { enrollCardToDevice: { policyId, enrollmentDetailId, successCount, attempts: devices.length } });
    return res.json({ success: true, successCount, attempts: devices.length, results });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:EnrollCardToDevice');
    return res.status(500).json({ success: false, message: 'Failed to enroll card to device' });
  }
};

export const setCardCredential = async (req, res) => {
  try {
    const { id } = req.params; // MatrixUser _id
    const { rfidCardId, cardId, deviceId: bodyDeviceId, device_id: bodyDevice_id, policyId: bodyPolicyId } = req.body || {};
    const refId = rfidCardId || cardId;
    if (!refId) return res.status(400).json({ success: false, message: 'rfidCardId (or cardId) is required' });

    const user = await MatrixUser.findById(id).select('externalUserId policyId').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Matrix user not found' });
    if (!user.externalUserId) return res.status(400).json({ success: false, message: 'Matrix user externalUserId missing' });

    const card = await RFIDCard.findById(refId).select('cardUid').lean();
    if (!card) return res.status(404).json({ success: false, message: 'RFID card not found' });
    if (!card.cardUid) return res.status(400).json({ success: false, message: 'RFID card has no cardUid' });

    const resp = await matrixApi.setCardCredential({ externalUserId: user.externalUserId, data: card.cardUid });
    const ok = !!resp?.ok;
    if (ok) {
      // Resolve MatrixDevice _ids to attach to the RFID card
      const resolvedDeviceMongoIds = [];
      try {
        if (bodyDeviceId) {
          const devById = await MatrixDevice.findById(bodyDeviceId).select('_id').lean();
          if (devById?._id) resolvedDeviceMongoIds.push(devById._id);
        } else if (bodyDevice_id) {
          const devByCode = await MatrixDevice.findOne({ device_id: bodyDevice_id }).select('_id').lean();
          if (devByCode?._id) resolvedDeviceMongoIds.push(devByCode._id);
        } else {
          // Fallback: derive from policy (request body policyId or user's stored policyId)
          const policyId = bodyPolicyId || user?.policyId;
          if (policyId) {
            const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
            if (policy && Array.isArray(policy.accessPointIds) && policy.accessPointIds.length) {
              const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } })
                .select('deviceBindings')
                .lean();
              const deviceIdStrings = [];
              for (const ap of accessPoints) {
                const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
                for (const b of bindings) {
                  if ((b?.vendor === 'MATRIX_COSEC') && b?.deviceId) {
                    deviceIdStrings.push(String(b.deviceId));
                  }
                }
              }
              const unique = Array.from(new Set(deviceIdStrings));
              resolvedDeviceMongoIds.push(...unique);
            }
          }
        }
      } catch {}

      try {
        // Flag user verified and link the card to the user
        await MatrixUser.findByIdAndUpdate(
          id,
          {
            $set: { isCardCredentialVerified: true },
            $addToSet: { cards: refId },
          }
        );
        // Attach devices to the RFID card if any resolved
        if (resolvedDeviceMongoIds.length) {
          await RFIDCard.findByIdAndUpdate(
            refId,
            { $addToSet: { devices: { $each: resolvedDeviceMongoIds } } }
          );
        }
      } catch {}

      await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, {
        setCardCredential: {
          rfidCardId: String(refId),
          devicesCount: resolvedDeviceMongoIds.length,
        }
      });
    }
    return res.status(ok ? 200 : 502).json({ success: ok, data: resp?.data || null, status: resp?.status || 0 });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:SetCardCredential');
    return res.status(500).json({ success: false, message: err?.message || 'Failed to set card credential' });
  }
};

// List Matrix devices associated to an access policy (via access points -> deviceBindings)
export const listPolicyDevices = async (req, res) => {
  try {
    const { id } = req.params; // MatrixUser _id (for existence check)
    const { policyId } = req.query || {};
    if (!policyId) return res.status(400).json({ success: false, message: 'policyId is required' });

    const user = await MatrixUser.findById(id).select('_id').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
    if (!policy || !Array.isArray(policy.accessPointIds) || policy.accessPointIds.length === 0) {
      return res.status(404).json({ success: false, message: 'Policy not found or has no access points' });
    }

    const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } }).select('deviceBindings').lean();
    const matrixDeviceObjIds = [];
    for (const ap of accessPoints) {
      const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
      for (const b of bindings) {
        if ((b?.vendor === 'MATRIX_COSEC') && b?.deviceId) {
          matrixDeviceObjIds.push(String(b.deviceId));
        }
      }
    }
    const uniqueIds = Array.from(new Set(matrixDeviceObjIds));
    if (!uniqueIds.length) return res.json({ success: true, data: [] });

    const devices = await MatrixDevice.find({ _id: { $in: uniqueIds } }).select('_id name device_id').lean();
    return res.json({ success: true, data: devices });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:ListPolicyDevices');
    return res.status(500).json({ success: false, message: 'Failed to list policy devices' });
  }
};

// Revoke a Matrix user's access from a selected device
export const revokeFromDevice = async (req, res) => {
  try {
    const { id } = req.params; // MatrixUser _id
    const { deviceId, device_id, rfidCardId } = req.body || {};
    const user = await MatrixUser.findById(id).select('externalUserId').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Matrix user not found' });
    if (!user.externalUserId) return res.status(400).json({ success: false, message: 'Matrix user externalUserId missing' });

    let resolvedDeviceId = device_id;
    let resolvedDeviceMongoId = null;
    if (!resolvedDeviceId && deviceId) {
      const dev = await MatrixDevice.findById(deviceId).select('_id device_id').lean();
      resolvedDeviceId = dev?.device_id;
      resolvedDeviceMongoId = dev?._id || null;
    }
    if (!resolvedDeviceId) return res.status(400).json({ success: false, message: 'deviceId (or device_id) is required' });

    const resp = await matrixApi.revokeUserFromDevice({ device_id: resolvedDeviceId, externalUserId: user.externalUserId });
    const ok = !!resp?.ok;
    if (ok) {
      // If rfidCardId provided and we resolved the device mongo id (or can resolve it), pull from RFIDCard.devices
      try {
        if (!resolvedDeviceMongoId && resolvedDeviceId) {
          const d = await MatrixDevice.findOne({ device_id: resolvedDeviceId }).select('_id').lean();
          resolvedDeviceMongoId = d?._id || null;
        }
        if (rfidCardId && resolvedDeviceMongoId) {
          await RFIDCard.findByIdAndUpdate(rfidCardId, { $pull: { devices: resolvedDeviceMongoId } });
        }
      } catch {}
      await logCRUDActivity(req, 'UPDATE', 'MatrixUser', id, null, { revokeFromDevice: { device_id: resolvedDeviceId, rfidCardId: rfidCardId || null } });
    }
    return res.status(ok ? 200 : 502).json({ success: ok, data: resp?.data || null, status: resp?.status || 0 });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:RevokeFromDevice');
    return res.status(500).json({ success: false, message: err?.message || 'Failed to revoke from device' });
  }
};

// List devices derived from the user's RFID cards (RFIDCard.devices) with device_id and name
export const listCardDevices = async (req, res) => {
  try {
    const { id } = req.params; // MatrixUser _id
    const user = await MatrixUser.findById(id).select('cards').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Matrix user not found' });

    const cardIds = Array.isArray(user.cards) ? user.cards : [];
    if (!cardIds.length) return res.json({ success: true, data: [] });

    const cards = await RFIDCard.find({ _id: { $in: cardIds } }).select('_id cardUid devices').lean();
    const allDeviceObjIds = new Set();
    for (const c of cards) {
      const devs = Array.isArray(c.devices) ? c.devices : [];
      for (const d of devs) allDeviceObjIds.add(String(d));
    }

    const deviceIdList = Array.from(allDeviceObjIds);
    if (!deviceIdList.length) return res.json({ success: true, data: [] });

    const devices = await MatrixDevice.find({ _id: { $in: deviceIdList } }).select('_id name device_id').lean();
    // Build rows associating device with each card that references it
    const deviceMap = new Map(devices.map(d => [String(d._id), d]));
    const rows = [];
    for (const c of cards) {
      const devs = Array.isArray(c.devices) ? c.devices : [];
      for (const did of devs) {
        const d = deviceMap.get(String(did));
        if (d) rows.push({ _id: d._id, name: d.name, device_id: d.device_id, rfidCardId: c._id, cardUid: c.cardUid });
      }
    }
    return res.json({ success: true, data: rows });
  } catch (err) {
    await logErrorActivity(req, err, 'MatrixUser:ListCardDevices');
    return res.status(500).json({ success: false, message: 'Failed to list card devices' });
  }
};

export default {
  createMatrixUser,
  listMatrixUsers,
  getMatrixUserById,
  updateMatrixUser,
  deleteMatrixUser,
  addCardRef,
  addEnrollment,
  setCardCredentialVerified,
  setValidity,
  addAccessHistory,
  assignToDevice,
  enrollCardToDevice,
  listPolicyDevices,
  revokeFromDevice,
  setCardCredential,
  listCardDevices,
};
