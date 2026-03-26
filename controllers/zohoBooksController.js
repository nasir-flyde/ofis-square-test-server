import { getZohoTaxes, searchContacts, getZohoLocations, getZohoChartOfAccounts } from "../utils/zohoBooks.js";

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
    const contact = contacts.length > 0 ? contacts[0] : null;

    return res.json({
      success: true,
      contact,
      contacts
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function getLocations(req, res) {
  try {
    const locations = await getZohoLocations();
    return res.json({ success: true, data: locations });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function getChartOfAccounts(req, res) {
  try {
    const accounts = await getZohoChartOfAccounts(req.query);
    return res.json({ success: true, data: accounts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
