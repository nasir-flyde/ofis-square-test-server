import puppeteer from "puppeteer";

export async function renderHtmlToPdf(html, options = {}) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let page;
  try {
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: options.format || "A4",
      printBackground: true,
      margin: options.margin || {
        top: "20mm",
        right: "15mm",
        bottom: "20mm",
        left: "15mm",
      },
    });

    // Normalize to Buffer across various return types
    if (Buffer.isBuffer(pdf)) return pdf;

    // Uint8Array or other TypedArray
    if (pdf instanceof Uint8Array) {
      return Buffer.from(pdf);
    }

    // Generic ArrayBuffer view (e.g., Uint8Array/TypedArray) or has underlying buffer
    if (pdf && pdf.buffer && ArrayBuffer.isView(pdf)) {
      try { return Buffer.from(pdf.buffer); } catch (_) {}
    }

    // Raw ArrayBuffer
    if (pdf instanceof ArrayBuffer) {
      return Buffer.from(pdf);
    }

    // Common object shape: { data: <Uint8Array|number[]> }
    if (pdf && typeof pdf === 'object' && pdf.data) {
      try { return Buffer.from(pdf.data); } catch (_) {}
    }

    // String (rare)
    if (typeof pdf === "string") {
      try { return Buffer.from(pdf, "binary"); } catch (_) {}
      try { return Buffer.from(pdf, "utf8"); } catch (_) {}
    }

    throw new Error(`Unexpected PDF type: ${typeof pdf}`);
  } finally {
    try { if (page) await page.close(); } catch (_) {}
    try { await browser.close(); } catch (_) {}
  }
}

export default renderHtmlToPdf;
