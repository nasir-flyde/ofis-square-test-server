import SecurityDeposit from "../models/securityDepositModel.js";
import Building from "../models/buildingModel.js";
import Payment from "../models/paymentModel.js";
import BankDetails from "../models/bankDetailsModel.js";
import renderHtmlToPdf from "../utils/pdf/renderHtmlToPdf.js";
import imagekit from "../utils/imageKit.js";
import { numberToWords } from "../utils/numberToWords.js";

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
  // New simplified template based on user request
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Deposit Release Request - OfisSquare</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Times New Roman', Times, serif;
            background-color: #f5f5f5;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }

        .header {
            background-color: white;
            padding: 20px 30px;
            border-bottom: 3px solid #ff6633;
        }

        .logo-section {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .logo-img {
            max-width: 150px;
            height: auto;
        }

        .content {
            padding: 30px 40px;
            line-height: 1.6;
        }

        .to-section {
            margin-bottom: 20px;
        }

        .to-label {
            font-weight: bold;
            font-size: 13px;
        }

        .company-name {
            font-weight: bold;
            font-size: 14px;
            margin: 5px 0;
        }

        .address {
            font-size: 12px;
            color: #333;
            margin-bottom: 15px;
        }

        .subject {
            font-weight: bold;
            font-size: 13px;
            margin: 20px 0;
        }

        .salutation {
            font-size: 13px;
            margin: 15px 0;
        }

        .body-text {
            font-size: 13px;
            margin: 15px 0;
            text-align: justify;
        }

        .highlight {
            font-weight: bold;
        }

        .bank-details {
            border: 2px solid #000;
            margin: 20px 0;
            font-size: 14px;
            display: table;
            width: auto;
            border-collapse: collapse;
        }

        .bank-details div {
            display: table-row;
        }

        .bank-details span {
            display: table-cell;
            padding: 8px 12px;
            border: 1px solid #000;
        }

        .bank-details .label {
            font-weight: normal;
            background-color: white;
        }

        .bank-details .value {
            font-weight: bold;
            background-color: white;
        }

        .signature-section {
            margin-top: 30px;
        }

        .signature-text {
            font-size: 12px;
            margin: 10px 0;
        }

        .signatory-name {
            font-weight: bold;
            font-size: 13px;
            margin-top: 20px;
        }

        .signatory-details {
            font-size: 10px;
            color: #333;
            margin: 2px 0;
        }

        .auth-label {
            font-weight: bold;
            font-size: 12px;
            margin-top: 15px;
        }

        .footer {
            background-color: #f8f8f8;
            padding: 20px 40px;
            border-top: 3px solid #ff6633;
            font-size: 10px;
            color: #333;
            text-align: center;
        }

        .footer-company {
            font-weight: bold;
            font-size: 12px;
            margin-bottom: 5px;
        }

        .footer-details {
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-section">
                <div>
                </div>
                <div>
                    <img src="${ctx.logoUrl}" alt="${ctx.companyName} Logo" class="logo-img">
                </div>
            </div>
        </div>

        <div class="content">
            <div class="to-section">
                <div class="to-label">To,</div>
                <div class="company-name">${ctx.memberName}</div>
                <div class="address">
                    ${ctx.clientAddress || 'Address not available'}
                </div>
            </div>

            <div class="subject">
                Subject: - Request to release security deposit ${ctx.memberName}
            </div>

            <div class="salutation">Dear Sir/Mam</div>

            <div class="body-text">
                In terms of Contract, which is to be executed on <span class="highlight">${ctx.contractDateFormatted}</span> with your Entity for 
                <span class="highlight">${ctx.cabinName}</span>, ${ctx.buildingAddress || 'Ofis Square'}.
            </div>

            <div class="body-text">
                We would like to request you to release security deposit of <span class="highlight">${ctx.agreedAmountFormatted}/- (Rupees ${ctx.agreedAmountWords} Only)</span>
            </div>

            <div class="body-text">
                Kindly find our bank account details as under for transferring the same: -
            </div>

            <div class="bank-details">
                <div>
                    <span class="label">Bank Name:</span>
                    <span class="value">${ctx.bankDetails?.bankName || 'PUNJAB NATIONAL BANK'}</span>
                </div>
                <div>
                    <span class="label">Account Holder:</span>
                    <span class="value">${ctx.bankDetails?.accountHolderName || ctx.companyName}</span>
                </div>
                <div>
                    <span class="label">Account Number:</span>
                    <span class="value">${ctx.bankDetails?.accountNumber || '-'}</span>
                </div>
                <div>
                    <span class="label">IFSC Code:</span>
                    <span class="value">${ctx.bankDetails?.ifscCode || '-'}</span>
                </div>
            </div>

            <div class="body-text">
                Please send us a confirmation post transfer of security deposit.
            </div>

            <div class="signature-section">
                <div class="signature-text">For ${ctx.companyName}</div>
                
                 ${ctx.signatureUrl ? `<img src="${ctx.signatureUrl}" style="height: 60px; margin-top: 10px;" alt="Signature" />` : ''}

                <div class="signatory-name">${ctx.signerName}</div>
                <div class="signatory-details">Digitally signed by ${ctx.signerName}</div>

                <div class="auth-label">Authorized Signatory</div>
            </div>
        </div>

        <div class="footer">
            <div class="footer-company">${ctx.companyName}</div>
            <div class="footer-details">
                ${ctx.companyAddress || 'Noida, Uttar Pradesh'}<br>
                ${ctx.companyPhone || ''} | ${ctx.companyEmail || ''}
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
    .populate('building')
    .populate('cabin')
    .populate('invoice_id', 'invoice_number date due_date total amount_paid');
  if (!dep) throw new Error('SecurityDeposit not found');
  if (dep.sdNoteUrl && !force) return { url: dep.sdNoteUrl, deposit: dep };

  if (dep.sdNoteUrl && !force) return { url: dep.sdNoteUrl, deposit: dep };

  let building = dep.building || null;
  if (!building && dep.building?._id) building = dep.building;
  if (dep.contract && dep.contract.building) building = dep.contract.building;

  // Ensure fully populated building if we only have ID
  if (building && !building.name) {
    building = await Building.findById(building._id || building);
  }

  const settings = building?.sdNoteSettings || {};

  // Fetch Bank Details (assuming single record or specific logic, here taking first)
  const bankDetails = await BankDetails.findOne();

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
  } catch (_) { }

  const companyName = settings.companyName || 'OFIS SPACES PRIVATE LIMITED';
  const logoUrl = settings.logoUrl || 'https://ik.imagekit.io/8znjbhgdh/black%20logo.png';

  const memberName = dep.client?.companyName || dep.client?.contactPerson || 'Member';
  // Construct client address
  const clientAddrObj = dep.client?.billingAddress || {};
  const clientAddress = [
    clientAddrObj.street1, clientAddrObj.street2,
    clientAddrObj.city, clientAddrObj.state,
    clientAddrObj.zip_code, 'India'
  ].filter(Boolean).join(', ');

  const agreedAmountFormatted = formatINR(dep.agreed_amount);
  const agreedAmountWords = numberToWords(dep.agreed_amount);
  const amountDepositedFormatted = formatINR(dep.amount_paid);

  const refundTimelineDays = settings.refundTimelineDays || 15;
  const dueDateStr = dep.due_date ? new Date(dep.due_date).toISOString().split('T')[0] : '';
  const paidDateStr = latestPaidDate ? latestPaidDate.toISOString().split('T')[0] : '';

  // Cabin Name / Building Address
  const cabinName = dep.cabin?.number ? `Cabin No. ${dep.cabin.number}` : (dep.contract?.cabin?.number ? `Cabin No. ${dep.contract.cabin.number}` : 'Designated Space');
  const buildingAddress = building?.address ? `${building.name}, ${building.address}` : 'Ofis Square';

  const contractDateFormatted = dep.createdAt ? new Date(dep.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  // Defaults for signature and stamp (can be overridden via settings or function params)
  const defaultSignatureUrl = 'https://ik.imagekit.io/8znjbhgdh/Gemini_Generated_Image_nounkwnounkwnoun.png';

  const ctx = {
    memberName,
    clientAddress,
    companyName,
    companyAddress: settings.companyAddress || '212, Second Floor, Tower A-1, Ofis Square, AUDA Plot No. 3, Sector-62, Noida, Gautam Buddha Nagar, Uttar Pradesh- 201301',
    companyPhone: settings.companyPhone || '+91-8287909488',
    companyEmail: settings.companyEmail || 'hello@ofisspaces.com',
    logoUrl,
    refundTimelineDays,
    agreedAmountFormatted,
    agreedAmountWords,
    amountDepositedFormatted,
    amountDepositedRaw: dep.amount_paid,
    paymentMode,
    dueDate: dueDateStr,
    paidDate: paidDateStr,
    signerName: signer?.name || signer?.fullName || 'MAHENDER ADHIKARI',
    signerDesignation: signer?.designation || settings?.footerDefaults?.designation || 'Authorized Signatory',
    signerPhone: signer?.phone || settings?.footerDefaults?.phone || '',
    signerEmail: signer?.email || settings?.footerDefaults?.email || '',
    signatureUrl: signatureUrl || settings.signatureUrl || defaultSignatureUrl,
    stampUrl: stampUrl || settings.stampUrl,
    dynamicValues: [...(settings.dynamicDefaults || []), ...(dynamicValues || [])],

    // New context fields
    cabinName,
    buildingAddress,
    contractDateFormatted,
    bankDetails: bankDetails ? {
      bankName: bankDetails.bankName,
      accountHolderName: bankDetails.accountHolderName,
      accountNumber: bankDetails.accountNumber,
      ifscCode: bankDetails.ifscCode
    } : null
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
