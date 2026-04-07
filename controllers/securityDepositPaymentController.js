import SecurityDepositPayment from "../models/securityDepositPaymentModel.js";
import SecurityDeposit from "../models/securityDepositModel.js";
import { recordSDAgreementJournal, recordSDPaymentJournal } from "../services/securityDepositCOAService.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";

/**
 * Record a Security Deposit Payment
 */
export const createSDPayment = async (req, res) => {
  try {
    console.log("➡️ [SD Payment] Received request to create SD Payment");
    const { depositId, clientId, amount, paymentDate, type, referenceNumber, notes } = req.body || {};
    console.log(`➡️ [SD Payment] Payload received - depositId: ${depositId}, clientId: ${clientId}, amount: ${amount}`);
    
    if (!depositId || depositId === "undefined" || !clientId || clientId === "undefined" || !amount) {
      return res.status(400).json({ success: false, message: "depositId, clientId, and amount are required" });
    }

    const deposit = await SecurityDeposit.findById(depositId);
    if (!deposit) return res.status(404).json({ success: false, message: "Security Deposit not found" });

    console.log("➡️ [SD Payment] Processing Image Uploads via ImageKit...");
    let imageUrls = [];
    if (req.files && req.files.images) {
      const folder = process.env.IMAGEKIT_SECURITY_DEPOSIT_FOLDER || "/ofis-square/security-deposits";
      const files = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
      
      const uploads = files.map(async (file) => {
        const result = await imagekit.upload({
          file: file.buffer,
          fileName: `sd_payment_${Date.now()}_${file.originalname}`,
          folder,
        });
        return result.url;
      });
      imageUrls = await Promise.all(uploads);
    }

    const typeMap = {
      'cash': 'Cash', 'bank transfer': 'Bank Transfer', 'banktransfer': 'BankTransfer',
      'upi': 'UPI', 'card': 'Card', 'creditcard': 'Card', 'cheque': 'Cheque',
      'neft': 'NEFT', 'rtgs': 'RTGS', 'imps': 'IMPS', 'other': 'Other', 'online gateway': 'Bank Transfer'
    };
    const normType = type ? (typeMap[String(type).trim().toLowerCase()] || "Bank Transfer") : "Bank Transfer";
    console.log(`➡️ [SD Payment] Normalized Payment Type to: ${normType}`);

    // 1. Create the Local Payment Record
    console.log("➡️ [SD Payment] Creating Local SecurityDepositPayment document...");
    const payment = await SecurityDepositPayment.create({
      deposit: depositId,
      client: clientId,
      building: deposit.building,
      amount: Number(amount),
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      type: normType,
      referenceNumber: referenceNumber || undefined,
      notes: notes || undefined,
      images: imageUrls,
      source: "manual"
    });
    console.log(`✅ [SD Payment] Successfully created local DB Payment id: ${payment._id}`);

    // 2. Update the Security Deposit's paid amount
    console.log("➡️ [SD Payment] Updating original Security Deposit amounts/status...");
    deposit.amount_paid = (Number(deposit.amount_paid) || 0) + Number(amount);
    if (!deposit.paid_date) deposit.paid_date = new Date();
    
    // Recompute Status (Simplified logic matched from securityDepositController)
    const paid = deposit.amount_paid;
    const due = deposit.amount_due;
    if (paid >= due && due > 0) deposit.status = "PAID";
    else if (due > 0) deposit.status = "DUE";
    
    await deposit.save();
    console.log(`✅ [SD Payment] Security Deposit amounts successfully updated. Status is now: ${deposit.status}`);

    // 3. Trigger Zoho Journaling (Blocking & Rollback on Failure)
    console.log("➡️ [SD Payment] Triggering Zoho Books manual journaling...");
    try {
      const journal = await recordSDPaymentJournal(depositId, amount, referenceNumber || `SDPAY-${payment._id}`, req.user?.name);
      if (journal && journal.journal_id) {
        console.log(`✅ [SD Payment] Zoho Journal successfully created. Journal ID: ${journal.journal_id}`);
        payment.zoho_journal_id = journal.journal_id;
        payment.zoho_journal_number = journal.journal_number;
        await payment.save();
        console.log("✅ [SD Payment] Zoho context saved to local payment document");
      }
    } catch (journalErr) {
      console.error("Zoho Journaling failed, rolling back local edits:", journalErr.message);
      // Rollback deposit amounts due to Zoho failure
      deposit.amount_paid = Math.max(0, deposit.amount_paid - Number(amount));
      if (deposit.amount_paid < deposit.amount_due) deposit.status = "DUE";
      else deposit.status = "AGREED";
      await deposit.save();
      // Delete the dummy payment record
      await SecurityDepositPayment.findByIdAndDelete(payment._id);
      
      throw new Error(`Zoho interaction failed: ${journalErr.message}`);
    }

    await logCRUDActivity(req, 'CREATE', 'SecurityDepositPayment', payment._id, null, { depositId, amount });
    
    console.log("🟢 [SD Payment] Entire payment chain successfully completed");
    return res.status(201).json({ success: true, data: payment });
  } catch (error) {
    await logErrorActivity(req, error, 'Create SecurityDepositPayment');
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * List Payments for a specific Deposit
 */
export const getSDPayments = async (req, res) => {
  try {
    const { depositId } = req.query;
    const filter = {};
    if (depositId) filter.deposit = depositId;

    const payments = await SecurityDepositPayment.find(filter)
      .populate('client', 'companyName email')
      .sort({ paymentDate: -1 });

    return res.json({ success: true, data: payments });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a Security Deposit Payment (and reverse logic)
 */
export const deleteSDPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await SecurityDepositPayment.findById(id);
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

    // Reverse the amount on the Security Deposit
    const deposit = await SecurityDeposit.findById(payment.deposit);
    if (deposit) {
      deposit.amount_paid = Math.max(0, (Number(deposit.amount_paid) || 0) - Number(payment.amount));
      // Recompute status
      const paid = deposit.amount_paid;
      const due = deposit.amount_due;
      if (paid >= due && due > 0) deposit.status = "PAID";
      else if (due > 0) deposit.status = "DUE";
      else deposit.status = "AGREED";
      
      await deposit.save();
    }

    // Note: Reversing Zoho Journal entries usually requires a manual void or a reverse journal.
    // For now, we'll just delete the local record and log it.
    await SecurityDepositPayment.findByIdAndDelete(id);
    
    await logCRUDActivity(req, 'DELETE', 'SecurityDepositPayment', id, null, { amount: payment.amount });

    return res.json({ success: true, message: "Security Deposit Payment deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
