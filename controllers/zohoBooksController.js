import { getZohoTaxes, searchContacts } from "../utils/zohoBooks.js";

export async function getTaxes(req, res) {
  try {
    const data = await getZohoTaxes();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function searchZohoContacts(req, res) {
  try {
    const { email, company_name, contact_name } = req.query;
    const searchParams = {};
    if (email) searchParams.email = email;
    if (company_name) searchParams.company_name = company_name;
    if (contact_name) searchParams.contact_name = contact_name;

    if (Object.keys(searchParams).length === 0) {
      return res.status(400).json({ success: false, message: "At least one search parameter (email, company_name) is required" });
    }

    const contacts = await searchContacts(searchParams);
    // Return the first match if specific, or list?
    // Frontend expects { success: true, contact: { ... } } if a direct match is found.
    // Let's filter slightly better if email is provided since Zoho search can be fuzzy?
    // Actually Zoho API 'email' search is usually exact.

    const contact = contacts.length > 0 ? contacts[0] : null;

    return res.json({
      success: true,
      contact,
      contacts // Return the full list too just in case
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
