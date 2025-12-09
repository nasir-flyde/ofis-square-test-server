import AccessEvent from "../models/accessEventModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import AccessPoint from "../models/accessPointModel.js";
import RFIDCard from "../models/rfidCardModel.js";

// Helper to verify vendor webhook
const verifyMatrixWebhook = (req) => {
  const configured = process.env.WEBHOOK_MATRIX_TOKEN;
  if (!configured) return true; // allow if not configured (dev)
  const header = req.headers["x-webhook-token"] || req.headers["x-matrix-token"];
  return header && String(header) === String(configured);
};

// POST /api/access-events/vendor/matrix
export const ingestMatrixEvents = async (req, res) => {
  try {
    if (!verifyMatrixWebhook(req)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const payload = req.body;
    const events = Array.isArray(payload) ? payload : [payload];
    const saved = [];

    for (const ev of events) {
      // Expected fields (flexible): externalDeviceId, cardUid, result, reason, occurredAt, direction, buildingId, externalEventId
      const externalDeviceId = ev.externalDeviceId || ev.deviceId || ev.device_id;
      const cardUid = ev.cardUid || ev.card_uid || ev.card || ev.tag;
      const occurredAt = ev.occurredAt ? new Date(ev.occurredAt) : new Date();
      const result = (ev.result || ev.decision || "").toString().toUpperCase() === "ALLOWED" ? "ALLOWED" : "DENIED";
      const reason = ev.reason || ev.code || undefined;
      const direction = (ev.direction || ev.dir || "UNKNOWN").toString().toUpperCase();
      const buildingId = ev.buildingId || undefined;
      const externalEventId = ev.externalEventId || ev.eventId || ev.event_id || undefined;

      // Resolve Matrix device
      let device = null;
      if (externalDeviceId) {
        device = await MatrixDevice.findOne({ externalDeviceId }).select("_id buildingId").lean();
      }

      // Resolve AccessPoint by device binding
      let accessPoint = null;
      if (device?._id) {
        accessPoint = await AccessPoint.findOne({ "deviceBindings.deviceId": device._id }).select("_id").lean();
        if (!accessPoint && externalDeviceId) {
          accessPoint = await AccessPoint.findOne({ "deviceBindings.externalDeviceId": externalDeviceId }).select("_id").lean();
        }
      } else if (externalDeviceId) {
        accessPoint = await AccessPoint.findOne({ "deviceBindings.externalDeviceId": externalDeviceId }).select("_id").lean();
      }

      // Resolve member via card registry
      let memberId = undefined;
      let clientId = undefined;
      if (cardUid) {
        const card = await RFIDCard.findOne({ cardUid }).select("memberId clientId").lean();
        if (card) {
          memberId = card.memberId || undefined;
          clientId = card.clientId || undefined;
        }
      }

      const doc = await AccessEvent.create({
        buildingId: buildingId || device?.buildingId || undefined,
        vendor: "MATRIX_COSEC",
        externalEventId,
        deviceId: device?._id || undefined,
        accessPointId: accessPoint?._id || undefined,
        cardUid: cardUid || undefined,
        memberId,
        clientId,
        result,
        reason,
        direction,
        occurredAt,
        raw: ev,
      });
      saved.push(doc);
    }

    return res.status(201).json({ success: true, data: { count: saved.length } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to ingest events", error: err?.message });
  }
};

// GET /api/access-events
export const listAccessEvents = async (req, res) => {
  try {
    const { buildingId, deviceId, accessPointId, memberId, cardUid, result, from, to, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (buildingId) filter.buildingId = buildingId;
    if (deviceId) filter.deviceId = deviceId;
    if (accessPointId) filter.accessPointId = accessPointId;
    if (memberId) filter.memberId = memberId;
    if (cardUid) filter.cardUid = cardUid;
    if (result) filter.result = result;
    if (from || to) {
      filter.occurredAt = {};
      if (from) filter.occurredAt.$gte = new Date(from);
      if (to) filter.occurredAt.$lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      AccessEvent.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      AccessEvent.countDocuments(filter),
    ]);

    return res.json({ success: true, data: items, pagination: { currentPage: Number(page)||1, totalPages: Math.ceil(total/Number(limit||1)), totalRecords: total, hasMore: skip + Number(limit) < total } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to list events", error: err?.message });
  }
};
