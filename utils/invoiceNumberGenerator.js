import Invoice from "../models/invoiceModel.js";

export async function generateLocalInvoiceNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `INV-${yyyy}-${mm}-`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const latest = await Invoice.findOne({ invoice_number: { $regex: `^${prefix}` } })
        .sort({ createdAt: -1 })
        .lean();

      let nextSeq = 10;
      if (latest && latest.invoice_number) {
        const parts = latest.invoice_number.split("-");
        const seqStr = parts[3];
        const seq = Number(seqStr);
        if (!Number.isNaN(seq)) nextSeq = seq + 1;
      }

      const invoiceNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;
      const exists = await Invoice.findOne({ invoice_number: invoiceNumber });
      if (!exists) {
        return invoiceNumber;
      }
      await new Promise(resolve => setTimeout(resolve, 50 * attempt));
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
  
  // Fallback: use timestamp suffix
  const timestamp = Date.now().toString().slice(-4);
  return `${prefix}${timestamp}`;
}

export function getInvoicePeriod(startDate) {
  const date = new Date(startDate);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid startDate for period: ${startDate}`);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
