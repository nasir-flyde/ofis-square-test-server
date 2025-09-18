import DayPass from "../models/dayPassModel.js";
import Invoice from "../models/invoiceModel.js";
import Guest from "../models/guestModel.js";
import Visitor from "../models/visitorModel.js";
import Building from "../models/buildingModel.js";
import Contract from "../models/contractModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";

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
      guestDoc = await Guest.findById(guestId);
      if (!guestDoc) return res.status(404).json({ success: false, message: "Guest not found" });
    } else if (guestPayload) {
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

    // Check if guest has an active credit-enabled contract
    let creditContract = null;
    let shouldUseCredits = false;
    
    if (guestDoc.client) {
      creditContract = await Contract.findOne({
        client: guestDoc.client,
        building,
        status: "active",
        credit_enabled: true,
        startDate: { $lte: passDate },
        endDate: { $gte: passDate }
      });
      
      if (creditContract) {
        shouldUseCredits = true;
      }
    }

    // 1) Create DayPass (without invoice reference initially)
    const dayPass = await DayPass.create({
      guest: guestDoc._id,
      building,
      date: passDate,
      expiresAt: expiryAt,
      status: "active",
      price: Number(price),
    });

    if (shouldUseCredits) {
      // 2a) Use Credit System - Record credit consumption instead of creating invoice
      const creditsNeeded = Math.ceil(Number(price) / creditContract.credit_value); // Convert price to credits
      
      // Create credit transaction
      await CreditTransaction.create({
        client: guestDoc.client,
        member: null, // Day pass usage
        type: "consume",
        credits: creditsNeeded,
        valuePerCredit: creditContract.credit_value,
        refType: "day_pass",
        refId: dayPass._id,
        meta: {
          description: `Day Pass - ${buildingDoc.name}`,
          date: passDate.toISOString().slice(0, 10),
          price: Number(price),
          building: buildingDoc.name
        }
      });

      // Update client credit wallet balance
      await ClientCreditWallet.findOneAndUpdate(
        { client: guestDoc.client },
        { $inc: { balance: -creditsNeeded } },
        { upsert: true }
      );

      console.log(`Day pass created using ${creditsNeeded} credits for client ${guestDoc.client}`);
      
      return res.status(201).json({ 
        success: true, 
        data: { 
          dayPass, 
          credits_used: creditsNeeded,
          credit_value: creditContract.credit_value,
          message: "Day pass created using credit system"
        } 
      });
    } else {
      // 2b) Traditional Invoice System - Create invoice immediately
    const localInvoiceNumber = await generateLocalInvoiceNumber();
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
      invoice_number: localInvoiceNumber,
      guest: guestDoc._id,
      building,
      date: new Date(),
      billing_period: { start: startOfDay, end: endOfDay },
      line_items: [
        {
          description: `Day Pass - ${buildingName} - ${descDate}`,
          quantity,
          unitPrice,
          amount,
          // Zoho Books fields
          name: `Day Pass - ${buildingName}`,
          rate: unitPrice,
          unit: "day",
          item_total: amount,
        },
      ],
      sub_total: subtotal,
      discount: discount.amount,
      discount_type: "entity_level",
      tax_total: 0, // No taxes for day passes currently
      total,
      amount_paid: amountPaid,
      balance: balanceDue,
      status: "draft", // Start as draft for Zoho compatibility
      notes: notes || "",
      
      // Zoho Books specific fields
      currency_code: "INR",
      exchange_rate: 1,
      gst_treatment: "consumer", // Day passes are typically for consumers
      place_of_supply: "MH", // Default to Maharashtra
      payment_terms: 0, // Immediate payment for day passes
      payment_terms_label: "Due on receipt",
      
      // Guest address mapping (if available)
      ...(guestDoc.address && {
        billing_address: {
          attention: guestDoc.name,
          address: guestDoc.address,
          phone: guestDoc.phone
        }
      })
    });

    // 3) Link invoice to day pass
    dayPass.invoice = invoice._id;
    await dayPass.save();

    // 4) Automatically push to Zoho Books if guest has contact info (optional for day passes)
    try {
      // For day passes, we can create a simple contact payload if needed
      // or skip Zoho integration since day passes are typically one-time
      console.log(`Day pass invoice ${invoice._id} created - Zoho integration skipped for guest transactions`);
    } catch (zohoError) {
      console.error(`Failed to push day pass invoice ${invoice._id} to Zoho Books:`, zohoError.message);
      // Don't fail the day pass creation if Zoho push fails
    }

    return res.status(201).json({ success: true, data: { dayPass, invoice } });
    }
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate key" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
