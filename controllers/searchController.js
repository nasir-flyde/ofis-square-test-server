import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import Cabin from "../models/cabinModel.js";
import MeetingRoom from "../models/meetingRoomModel.js";
import Invoice from "../models/invoiceModel.js";
import Payment from "../models/paymentModel.js";

function escapeRegex(text = "") {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function globalSearch(req, res) {
  try {
    const qRaw = String(req.query.q || "").trim();
    const typesParam = String(req.query.types || "").trim();
    const perTypeLimit = Math.min(parseInt(req.query.limit, 10) || 5, 20);

    if (qRaw.length < 2) {
      return res.json({ query: qRaw, results: [], counts: {}, limit: perTypeLimit });
    }

    const regex = new RegExp(escapeRegex(qRaw), "i");

    const allowedTypes = [
      "members",
      "clients",
      "buildings",
      "cabins",
      "meeting_rooms",
      "invoices",
      "payments",
    ];

    const types = typesParam
      ? typesParam
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => allowedTypes.includes(t))
      : allowedTypes;

    const queries = [];

    if (types.includes("members")) {
      queries.push(
        Member.find({
          $or: [
            { firstName: regex },
            { lastName: regex },
            { email: regex },
            { phone: regex },
            { companyName: regex },
          ],
        })
          .limit(perTypeLimit)
          .select("firstName lastName email phone companyName")
          .lean()
          .then((rows) =>
            rows.map((m) => ({
              type: "members",
              id: String(m._id),
              title: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || m.phone || "Member",
              subtitle: m.companyName || m.email || m.phone || "",
              url: `/members/${m._id}/edit`,
              raw: m,
            }))
          )
      );
    }

    if (types.includes("clients")) {
      queries.push(
        Client.find({
          $or: [
            { companyName: regex },
            { legalName: regex },
            { contactPerson: regex },
            { email: regex },
            { phone: regex },
          ],
        })
          .limit(perTypeLimit)
          .select("companyName legalName contactPerson email phone")
          .lean()
          .then((rows) =>
            rows.map((c) => ({
              type: "clients",
              id: String(c._id),
              title: c.companyName || c.legalName || c.contactPerson || c.email || c.phone || "Client",
              subtitle: [c.contactPerson, c.email, c.phone].filter(Boolean).join(" · "),
              url: `/clients/${c._id}/edit`,
              raw: c,
            }))
          )
      );
    }

    if (types.includes("buildings")) {
      queries.push(
        Building.find({
          $or: [
            { name: regex },
            { address: regex },
            { city: regex },
            { pincode: regex },
          ],
        })
          .limit(perTypeLimit)
          .select("name address city pincode")
          .lean()
          .then((rows) =>
            rows.map((b) => ({
              type: "buildings",
              id: String(b._id),
              title: b.name,
              subtitle: [b.address, b.city, b.pincode].filter(Boolean).join(", "),
              url: `/buildings/${b._id}/edit`,
              raw: b,
            }))
          )
      );
    }

    if (types.includes("cabins")) {
      queries.push(
        Cabin.find({
          $or: [
            { number: regex },
            { category: regex },
            { status: regex },
          ],
        })
          .limit(perTypeLimit)
          .select("number category status building")
          .populate({ path: "building", select: "name" })
          .lean()
          .then((rows) =>
            rows.map((c) => ({
              type: "cabins",
              id: String(c._id),
              title: `Cabin ${c.number}`,
              subtitle: [c.category, c.status, c?.building?.name].filter(Boolean).join(" · "),
              url: `/cabins/${c._id}/edit`,
              raw: c,
            }))
          )
      );
    }

    if (types.includes("meeting_rooms")) {
      queries.push(
        MeetingRoom.find({
          $or: [
            { name: regex },
          ],
        })
          .limit(perTypeLimit)
          .select("name building capacity")
          .populate({ path: "building", select: "name" })
          .lean()
          .then((rows) =>
            rows.map((r) => ({
              type: "meeting_rooms",
              id: String(r._id),
              title: r.name,
              subtitle: [r?.building?.name, r.capacity ? `${r.capacity} pax` : null].filter(Boolean).join(" · "),
              url: `/meeting-rooms/${r._id}`,
              raw: r,
            }))
          )
      );
    }

    if (types.includes("invoices")) {
      queries.push(
        Invoice.find({
          $or: [
            { invoice_number: regex },
            { zoho_invoice_number: regex },
            { reference_number: regex },
            { status: regex },
          ],
        })
          .limit(perTypeLimit)
          .select("invoice_number zoho_invoice_number reference_number status client total date")
          .populate({ path: "client", select: "companyName" })
          .lean()
          .then((rows) =>
            rows.map((inv) => ({
              type: "invoices",
              id: String(inv._id),
              title: inv.invoice_number || inv.zoho_invoice_number || inv.reference_number || "Invoice",
              subtitle: [inv?.client?.companyName, inv.status, inv.total != null ? `₹${inv.total}` : null]
                .filter(Boolean)
                .join(" · "),
              url: `/invoices/${inv._id}`,
              raw: inv,
            }))
          )
      );
    }

    if (types.includes("payments")) {
      queries.push(
        Payment.find({
          $or: [
            { referenceNumber: regex },
            { payment_number: regex },
            { type: regex },
          ],
        })
          .limit(perTypeLimit)
          .select("referenceNumber payment_number type amount paymentDate client")
          .populate({ path: "client", select: "companyName" })
          .lean()
          .then((rows) =>
            rows.map((p) => ({
              type: "payments",
              id: String(p._id),
              title: p.payment_number || p.referenceNumber || p.type || "Payment",
              subtitle: [p?.client?.companyName, p.type, p.amount != null ? `₹${p.amount}` : null]
                .filter(Boolean)
                .join(" · "),
              url: `/payments/${p._id}`,
              raw: p,
            }))
          )
      );
    }

    const settled = await Promise.all(queries);
    const flat = settled.flat();

    // Basic counts per type
    const counts = flat.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});

    res.json({ query: qRaw, results: flat, counts, limit: perTypeLimit });
  } catch (err) {
    console.error("Global search error:", err);
    res.status(500).json({ message: "Search failed", error: err?.message || String(err) });
  }
}
