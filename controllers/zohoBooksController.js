import { getZohoTaxes } from "../utils/zohoBooks.js";

export async function getTaxes(req, res) {
  try {
    const data = await getZohoTaxes();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
