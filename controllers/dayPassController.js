import DayPass from "../models/dayPassModel.js";
import Invoice from "../models/invoiceModel.js";
import Guest from "../models/guestModel.js";
import Visitor from "../models/visitorModel.js";
import Building from "../models/buildingModel.js";

// Helper: generate invoice number like INV-YYYY-MM-0001 (resets monthly)
async function generateInvoiceNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `INV-${yyyy}-${mm}-`;

  const latest = await Invoice.findOne({ invoiceNumber: { $regex: `^${prefix}` } })
    .sort({ createdAt: -1 })
    .lean();

  let nextSeq = 1;
  if (latest && latest.invoiceNumber) {
    const parts = latest.invoiceNumber.split("-");
    const seqStr = parts[3];
    const seq = Number(seqStr);
    if (!Number.isNaN(seq)) nextSeq = seq + 1;
  }

  const suffix = String(nextSeq).padStart(4, "0");
  return `${prefix}${suffix}`;
}

// POST /api/daypasses
// Body: { guestId | guest (object) | visitorId, building, date, price, notes?, expiresAt? }
export const createDayPass = async (req, res) => {
  try {
    const { guestId, guest: guestPayload, visitorId, building, date, price, notes, expiresAt } = req.body || {};
    if (!building) return res.status(400).json({ success: false, message: "building is required" });
    if (!date) return res.status(400).json({ success: false, message: "date is required" });
    if (price == null) return res.status(400).json({ success: false, message: "price is required" });

    // Resolve or create Guest/Visitor
    let guestDoc = null;
    let visitorDoc = null;
    
    if (visitorId) {
      // Use visitor system (new flow)
      visitorDoc = await Visitor.findById(visitorId);
      if (!visitorDoc) return res.status(404).json({ success: false, message: "Visitor not found" });
      
      // Create or find guest record for the visitor
      const query = [];
      if (visitorDoc.email) query.push({ email: visitorDoc.email.toLowerCase() });
      if (visitorDoc.phone) query.push({ phone: visitorDoc.phone });
      
      if (query.length > 0) {
        guestDoc = await Guest.findOne({ $or: query });
      }
      
      if (!guestDoc) {
        guestDoc = await Guest.create({
          name: visitorDoc.name,
          email: visitorDoc.email,
          phone: visitorDoc.phone,
          companyName: visitorDoc.companyName,
          notes: `Created from visitor: ${visitorDoc._id}`,
        });
      }
    } else if (guestId) {
      // Use existing guest system (legacy flow)
      guestDoc = await Guest.findById(guestId);
      if (!guestDoc) return res.status(404).json({ success: false, message: "Guest not found" });
    } else if (guestPayload) {
      // Create new guest (legacy flow)
      if (!guestPayload.name) {
        return res.status(400).json({ success: false, message: "guest.name is required when creating a new guest" });
      }
      // Try to find existing by email or phone to avoid duplicates
      const query = [];
      if (guestPayload.email) query.push({ email: guestPayload.email.toLowerCase() });
      if (guestPayload.phone) query.push({ phone: guestPayload.phone });
      if (query.length > 0) {
        guestDoc = await Guest.findOne({ $or: query });
      }
      if (!guestDoc) {
        guestDoc = await Guest.create({
          name: guestPayload.name,
          email: guestPayload.email,
          phone: guestPayload.phone,
          companyName: guestPayload.companyName,
          notes: guestPayload.notes,
        });
      }
    } else {
      return res.status(400).json({ success: false, message: "Provide visitorId, guestId, or guest details" });
    }

    const buildingDoc = await Building.findById(building);
    if (!buildingDoc) return res.status(404).json({ success: false, message: "Building not found" });

    const passDate = new Date(date);
    const startOfDay = new Date(passDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(passDate);
    endOfDay.setHours(23, 59, 59, 999);
    const expiryAt = expiresAt ? new Date(expiresAt) : endOfDay;

    // 1) Create DayPass (without invoice reference initially)
    const dayPass = await DayPass.create({
      guest: guestDoc._id,
      building,
      date: passDate,
      expiresAt: expiryAt,
      status: "active",
      price: Number(price),
    });

    // 2) Create Invoice for this day pass
    const invoiceNumber = await generateInvoiceNumber();
    const quantity = 1;
    const unitPrice = Number(price) || 0;
    const amount = Math.round(quantity * unitPrice * 100) / 100;
    const subtotal = amount;
    const discount = { type: "flat", value: 0, amount: 0 };
    const taxes = [];
    const total = subtotal; // no taxes/discount for now
    const amountPaid = 0;
    const balanceDue = total - amountPaid;

    const descDate = startOfDay.toISOString().slice(0, 10); // YYYY-MM-DD
    const buildingName = buildingDoc?.name || "Building";

    const invoice = await Invoice.create({
      invoiceNumber,
      guest: guestDoc._id,
      building,
      issueDate: new Date(),
      billingPeriod: { start: startOfDay, end: endOfDay },
      items: [
        {
          description: `Day Pass - ${buildingName} - ${descDate}`,
          quantity,
          unitPrice,
          amount,
        },
      ],
      subtotal,
      discount,
      taxes,
      total,
      amountPaid,
      balanceDue,
      status: "issued",
      notes: notes || "",
    });

    // 3) Link invoice to day pass
    dayPass.invoice = invoice._id;
    await dayPass.save();

    return res.status(201).json({ success: true, data: { dayPass, invoice } });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate key" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
