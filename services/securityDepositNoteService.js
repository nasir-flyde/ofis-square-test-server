import SecurityDeposit from "../models/securityDepositModel.js";
import Building from "../models/buildingModel.js";
import Payment from "../models/paymentModel.js";
import renderHtmlToPdf from "../utils/pdf/renderHtmlToPdf.js";
import imagekit from "../utils/imageKit.js";

function formatINR(n) {
  const num = Number(n || 0);
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function injectPlaceholders(template, data) {
  return template
    .replace(/{{\s*memberName\s*}}/g, data.memberName || "Member")
    .replace(/{{\s*companyName\s*}}/g, data.companyName || "OFIS SQUARE")
    .replace(/{{\s*amountDeposited\s*}}/g, data.amountDepositedFormatted || "₹0")
    .replace(/{{\s*agreedAmount\s*}}/g, data.agreedAmountFormatted || "₹0")
    .replace(/{{\s*refundTimelineDays\s*}}/g, String(data.refundTimelineDays || ""))
    .replace(/{{\s*paymentMode\s*}}/g, data.paymentMode || "-")
    .replace(/{{\s*dueDate\s*}}/g, data.dueDate || "-")
    .replace(/{{\s*paidDate\s*}}/g, data.paidDate || "-")
    .replace(/{{\s*logoUrl\s*}}/g, data.logoUrl || "")
    .replace(/{{\s*signerName\s*}}/g, data.signerName || "")
    .replace(/{{\s*signerDesignation\s*}}/g, data.signerDesignation || "")
    .replace(/{{\s*signerPhone\s*}}/g, data.signerPhone || "")
    .replace(/{{\s*signerEmail\s*}}/g, data.signerEmail || "")
    .replace(/{{\s*signatureUrl\s*}}/g, data.signatureUrl || "")
    .replace(/{{\s*stampUrl\s*}}/g, data.stampUrl || "");
}

function buildStructuredHtml(settings, ctx) {
  const introWelcomeText = settings?.introWelcomeText || "Welcome to OFIS SQUARE.";
  const depositRequirementText = settings?.depositRequirementText || "A refundable security deposit is required.";
  const paymentInstructionText = settings?.paymentInstructionText || "Please proceed with the payment.";
  const closingSupportText = settings?.closingSupportText || "We look forward to supporting you.";
  const defaultPurposeText = settings?.defaultPurposeText || "To safeguard against damages or dues.";
  const defaultRefundabilityText = settings?.defaultRefundabilityText || "The security deposit is fully refundable subject to adjustments.";

  const additionalRows = (ctx.dynamicValues || []).map(({ label, value }) => {
    if (!label && !value) return "";
    return `<tr><td>${label || ''}</td><td>${value || ''}</td></tr>`;
  }).join("");

  const amountPaidRow = Number(ctx.amountDepositedRaw || 0) > 0
    ? `<tr><td>Amount Paid:</td><td>${ctx.amountDepositedFormatted}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${settings?.headerTitle || 'Security Deposit Notification'}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #222; line-height: 1.6; margin: 0; padding: 0; background: #ffffff; }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 50px; }
    .header { text-align: center; margin-bottom: 40px; }
    .header img { max-height: 80px; margin-bottom: 10px; }
    .content { font-size: 14px; }
    .content p { margin: 0 0 16px 0; }
    .section-title { font-weight: bold; margin-top: 24px; margin-bottom: 8px; }
    .details-table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
    .details-table td { padding: 8px 0; vertical-align: top; }
    .details-table td:first-child { width: 180px; font-weight: bold; }
    .footer { margin-top: 40px; font-size: 14px; }
    .signature { margin-top: 24px; }
    /* Added for signature + stamp images */
    .signature-block { margin-top: 24px; position: relative; min-height: 140px; }
    .signature-img { position: absolute; left: 0; top: 0; height: 80px; }
    .stamp-img { position: absolute; right: 0; bottom: 0; height: 120px; opacity: 0.9; }
    .signer-text { position: absolute; left: 0; top: 90px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${ctx.logoUrl}" alt="${ctx.companyName} Logo" />
    </div>
    <div class="content">
      <p>Dear <strong>${ctx.memberName}</strong>,</p>
      <p>${introWelcomeText}</p>
      <p>${depositRequirementText}</p>

      <div class="section-title">Security Deposit Details</div>
      <table class="details-table">
        <tr><td>Deposit Amount:</td><td>${ctx.agreedAmountFormatted}</td></tr>
        <tr><td>Purpose:</td><td>${defaultPurposeText}</td></tr>
        <tr><td>Refundability:</td><td>${defaultRefundabilityText}</td></tr>
        <tr><td>Refund Timeline:</td><td>The security deposit will be refunded within ${ctx.refundTimelineDays} days from the date of membership closure and handover of the workspace, after necessary verification.</td></tr>
        ${amountPaidRow}
      </table>

      <div class="section-title">Payment Details</div>
      <table class="details-table">
        <tr><td>Mode of Payment:</td><td>${ctx.paymentMode || settings?.paymentModesPlaceholder || '-'}</td></tr>
        <tr><td>Due Date:</td><td>${ctx.dueDate || '-'}</td></tr>
        ${ctx.paidDate ? `<tr><td>Paid On:</td><td>${ctx.paidDate}</td></tr>` : ''}
      </table>

      ${additionalRows ? `<div class="section-title">Additional Details</div>
      <table class="details-table">${additionalRows}</table>` : ''}

      <p>${paymentInstructionText}</p>
      <p>${closingSupportText}</p>
    </div>

    <div class="footer">
      <p>Warm regards,</p>
      <div class="signature-block">
        ${ctx.signatureUrl ? `<img class="signature-img" src="${ctx.signatureUrl}" alt="Signature" />` : ''}
        ${ctx.stampUrl ? `<img class="stamp-img" src="${ctx.stampUrl}" alt="Stamp" />` : ''}
        <div class="signer-text">
          <p>
            <strong>${ctx.signerName || ''}</strong><br />
            ${ctx.signerDesignation || ''}<br />
            <strong>${ctx.companyName}</strong><br />
            Phone: ${ctx.signerPhone || ''}<br />
            Email: ${ctx.signerEmail || ''}
          </p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function generateSecurityDepositNote(depositId, { signer = {}, dynamicValues = [], force = false, stampUrl, signatureUrl } = {}) {
  const dep = await SecurityDeposit.findById(depositId)
    .populate('client')
    .populate('contract')
    .populate('invoice_id', 'invoice_number date due_date total amount_paid');
  if (!dep) throw new Error('SecurityDeposit not found');
  if (dep.sdNoteUrl && !force) return { url: dep.sdNoteUrl, deposit: dep };

  let building = null;
  if (dep.building) {
    building = await Building.findById(dep.building);
  }
  const settings = building?.sdNoteSettings || {};

  // Determine payment mode and dates from latest payment on this invoice
  let paymentMode = undefined;
  let latestPaidDate = dep.paid_date ? new Date(dep.paid_date) : null;
  try {
    if (dep.invoice_id) {
      const latestPayment = await Payment.findOne({ invoice: dep.invoice_id._id || dep.invoice_id })
        .sort({ paymentDate: -1, createdAt: -1 })
        .select('type paymentDate');
      if (latestPayment) {
        paymentMode = latestPayment.type || paymentMode;
        if (!latestPaidDate && latestPayment.paymentDate) latestPaidDate = new Date(latestPayment.paymentDate);
      }
    }
  } catch (_) {}

  const companyName = settings.companyName || 'OFIS SQUARE';
  const logoUrl = settings.logoUrl || 'https://ik.imagekit.io/8znjbhgdh/black%20logo.png';

  const memberName = dep.client?.contactPerson || dep.client?.companyName || 'Member';
  const agreedAmountFormatted = formatINR(dep.agreed_amount);
  const amountDepositedFormatted = formatINR(dep.amount_paid);
  const refundTimelineDays = settings.refundTimelineDays || 15;
  const dueDateStr = dep.due_date ? new Date(dep.due_date).toISOString().split('T')[0] : '';
  const paidDateStr = latestPaidDate ? latestPaidDate.toISOString().split('T')[0] : '';

  // Defaults for signature and stamp (can be overridden via settings or function params)
  const defaultSignatureUrl = 'https://ik.imagekit.io/8znjbhgdh/Gemini_Generated_Image_nounkwnounkwnoun.png';
  const defaultStampUrl = 'https://ik.imagekit.io/8znjbhgdh/Gemini_Generated_Image_y7ualy7ualy7ualy%20(1).png';

  const ctx = {
    memberName,
    companyName,
    logoUrl,
    refundTimelineDays,
    agreedAmountFormatted,
    amountDepositedFormatted,
    amountDepositedRaw: dep.amount_paid,
    paymentMode,
    dueDate: dueDateStr,
    paidDate: paidDateStr,
    signerName: signer?.name || signer?.fullName || signer?.email || '',
    signerDesignation: signer?.designation || settings?.footerDefaults?.designation || 'Team',
    signerPhone: signer?.phone || settings?.footerDefaults?.phone || '',
    signerEmail: signer?.email || settings?.footerDefaults?.email || '',
    signatureUrl: signatureUrl || settings.signatureUrl || defaultSignatureUrl,
    stampUrl: stampUrl || settings.stampUrl || defaultStampUrl,
    dynamicValues: [ ...(settings.dynamicDefaults || []), ...(dynamicValues || []) ]
  };

  let html;
  const rawTemplate = (settings?.htmlTemplate || '').trim();
  const isHtmlOverrideValid = (
    settings?.templateType === 'html' &&
    rawTemplate &&
    rawTemplate.length > 100 &&
    !/PASTE_YOUR_HTML_WITH_PLACEHOLDERS_HERE/i.test(rawTemplate)
  );

  if (isHtmlOverrideValid) {
    html = injectPlaceholders(rawTemplate, {
      ...ctx,
      amountDeposited: dep.amount_paid,
      agreedAmount: dep.agreed_amount,
    });
  } else {
    html = buildStructuredHtml(settings, ctx);
  }

  const pdfBuffer = await renderHtmlToPdf(html);
  const fileName = `SD_NOTE_${String(dep._id)}_${Date.now()}.pdf`;
  const uploadResult = await imagekit.upload({
    file: pdfBuffer.toString('base64'),
    fileName,
    folder: "/security-deposits",
    useUniqueFileName: true,
    isPrivateFile: false,
  });

  dep.sdNoteUrl = uploadResult?.url || uploadResult?.filePath || dep.sdNoteUrl;
  dep.sdNoteGeneratedAt = new Date();
  dep.sdNoteMeta = {
    placeholders: ctx,
    buildingId: dep.building || null,
    invoiceId: dep.invoice_id?._id || dep.invoice_id || null,
    upload: {
      fileId: uploadResult?.fileId,
      name: uploadResult?.name,
      url: uploadResult?.url,
      filePath: uploadResult?.filePath,
      size: uploadResult?.size,
    }
  };
  await dep.save();

  return { url: dep.sdNoteUrl, deposit: dep };
}

export default {
  generateSecurityDepositNote,
};
