import mongoose from "mongoose";
import { createObjectCsvStringifier } from 'csv-writer';
import Client from "../models/clientModel.js";
import imagekit from "../utils/imageKit.js";
import Contract from "../models/contractModel.js";
import Invoice from "../models/invoiceModel.js";
import Ticket from "../models/ticketModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Member from "../models/memberModel.js";
import Desk from "../models/deskModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import RFIDCard from "../models/rfidCardModel.js";
import MatrixUser from "../models/matrixUserModel.js";
import ProvisioningJob from "../models/provisioningJobModel.js";
import AccessPoint from "../models/accessPointModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import Building from "../models/buildingModel.js";
import { matrixApi } from "../utils/matrixApi.js";
import bcrypt from "bcrypt";
import { getClientPayments } from "./paymentController.js";
import { createContact, updateContact, getContact, findOrCreateContactFromClient } from "../utils/zohoBooks.js";
import { sendNotification } from "../utils/notificationHelper.js";
import { logCRUDActivity, logActivity } from "../utils/activityLogger.js";
import { sendClientFeedbackAlertEmail } from "../utils/contractEmailService.js";
import DocumentEntity from "../models/documentEntityModel.js";
import { ensureBhaifiForMember } from "./bhaifiController.js";
import { syncMemberToUser } from "../utils/memberSync.js";

export const searchClient = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const client = await Client.findOne({
      email: { $regex: new RegExp(`^${email.trim()}$`, "i") }
    });

    if (!client) {
      return res.json({ success: true, client: null, message: "Client not found" });
    }

    return res.json({ success: true, client });
  } catch (err) {
    console.error("searchClient error:", err);
    return res.status(500).json({ success: false, message: "Failed to search client" });
  }
};

export const exportClients = async (req, res) => {
  try {
    const { search, customerType, kycStatus } = req.query;

    let query = {};

    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      query.$or = [
        { companyName: searchRegex },
        { legalName: searchRegex },
        { contactPerson: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }

    if (customerType) {
      query.$or = [
        { customerSubType: customerType },
        { contactType: customerType }
      ];
    }

    if (kycStatus) {
      query.kycStatus = kycStatus;
    }

    const clients = await Client.find(query).sort({ createdAt: -1 });

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'companyName', title: 'Company Name' },
        { id: 'legalName', title: 'Legal Name' },
        { id: 'contactPerson', title: 'Primary Contact Person' },
        { id: 'email', title: 'Email' },
        { id: 'phone', title: 'Phone' },
        { id: 'website', title: 'Website' },
        { id: 'industry', title: 'Industry' },

        // Billing Address
        { id: 'billingAttention', title: 'Billing Attention' },
        { id: 'billingAddress', title: 'Billing Address' },
        { id: 'billingCity', title: 'Billing City' },
        { id: 'billingState', title: 'Billing State' },
        { id: 'billingZip', title: 'Billing Zip' },
        { id: 'billingCountry', title: 'Billing Country' },

        // Shipping Address
        { id: 'shippingAttention', title: 'Shipping Attention' },
        { id: 'shippingAddress', title: 'Shipping Address' },
        { id: 'shippingCity', title: 'Shipping City' },
        { id: 'shippingState', title: 'Shipping State' },
        { id: 'shippingZip', title: 'Shipping Zip' },
        { id: 'shippingCountry', title: 'Shipping Country' },

        // Tax Info
        { id: 'gstNo', title: 'GST No' },
        { id: 'gstTreatment', title: 'GST Treatment' },
        { id: 'taxRegNo', title: 'Tax Reg No' },
        { id: 'placeOfSupply', title: 'Place of Supply' },

        // Commercial
        { id: 'contactType', title: 'Contact Type' },
        { id: 'customerSubType', title: 'Customer Sub Type' },
        { id: 'paymentTerms', title: 'Payment Terms' },
        { id: 'creditLimit', title: 'Credit Limit' },
        { id: 'isPortalEnabled', title: 'Portal Enabled' },
        { id: 'currencyId', title: 'Currency ID' },
        { id: 'pricebookId', title: 'Pricebook ID' },
        { id: 'notes', title: 'Notes' },

        // Contact Persons
        { id: 'contactPersons', title: 'All Contact Persons' },

        // System Status
        { id: 'status', title: 'Status' },
        { id: 'kycStatus', title: 'KYC Status' },
        { id: 'zohoBooksContactId', title: 'Zoho Contact ID' },
        { id: 'createdAt', title: 'Created At' }
      ]
    });

    const records = clients.map(client => {
      // Format contact persons list
      const contactsList = (client.contactPersons || []).map(cp => {
        const name = [cp.first_name || cp.firstName, cp.last_name || cp.lastName].filter(Boolean).join(' ');
        const details = [
          name,
          cp.email,
          cp.phone || cp.mobile,
          cp.designation ? `(${cp.designation})` : ''
        ].filter(Boolean).join(' - ');
        return details;
      }).join('; ');

      // Primary tax place of supply (from first tax info or fallback)
      const placeOfSupply = client.taxInfoList?.[0]?.place_of_supply || '';

      return {
        companyName: client.companyName || '',
        legalName: client.legalName || '',
        contactPerson: client.contactPerson || '',
        email: client.email || '',
        phone: client.phone || '',
        website: client.website || '',
        industry: client.industry || '',

        // Billing
        billingAttention: client.billingAddress?.attention || '',
        billingAddress: [
          client.billingAddress?.address,
          client.billingAddress?.street2
        ].filter(Boolean).join(', ') || '',
        billingCity: client.billingAddress?.city || '',
        billingState: client.billingAddress?.state || '',
        billingZip: client.billingAddress?.zip || '',
        billingCountry: client.billingAddress?.country || '',

        // Shipping
        shippingAttention: client.shippingAddress?.attention || '',
        shippingAddress: [
          client.shippingAddress?.address,
          client.shippingAddress?.street2
        ].filter(Boolean).join(', ') || '',
        shippingCity: client.shippingAddress?.city || '',
        shippingState: client.shippingAddress?.state || '',
        shippingZip: client.shippingAddress?.zip || '',
        shippingCountry: client.shippingAddress?.country || '',

        // Tax
        gstNo: client.gstNo || '',
        gstTreatment: client.gstTreatment || '',
        taxRegNo: client.taxRegNo || '',
        placeOfSupply: placeOfSupply,

        // Commercial
        contactType: client.contactType || '',
        customerSubType: client.customerSubType || '',
        paymentTerms: client.paymentTerms || '',
        creditLimit: client.creditLimit || '',
        isPortalEnabled: client.isPortalEnabled ? 'Yes' : 'No',
        currencyId: client.currencyId || '',
        pricebookId: client.pricebookId || '',
        notes: client.notes || '',

        // Contacts
        contactPersons: contactsList,

        // Status
        status: client.status || 'active', // 'status' might not be a direct top-level field in model, using 'membershipStatus' or similar if needed, typically 'active' is default
        kycStatus: client.kycStatus || 'none',
        zohoBooksContactId: client.zohoBooksContactId || '',
        createdAt: client.createdAt ? new Date(client.createdAt).toISOString().split('T')[0] : ''
      };
    });

    const header = csvStringifier.getHeaderString();
    const csvRecords = csvStringifier.stringifyRecords(records);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="clients_full_export.csv"');
    res.send(header + csvRecords);

  } catch (err) {
    console.error("exportClients error:", err);
    res.status(500).send("Failed to export clients");
  }
};

export const createClient = async (req, res) => {
  try {
    const body = req.body || {};

    // Handle file uploads for KYC documents
    const files = Array.isArray(req.files) ? req.files : [];
    const uploadsByField = {};

    if (files.length > 0) {
      await Promise.all(
        files.map(async (f) => {
          const folder = process.env.IMAGEKIT_KYC_FOLDER || "/ofis-square/kyc";
          const result = await imagekit.upload({
            file: f.buffer,
            fileName: f.originalname || `${Date.now()}_${f.fieldname}`,
            folder,
          });
          // Store only minimal fields as requested
          const entry = {
            fieldname: f.fieldname,
            originalname: f.originalname,
            url: result?.url,
          };
          if (!uploadsByField[f.fieldname]) uploadsByField[f.fieldname] = [];
          uploadsByField[f.fieldname].push(entry);
        })
      );
    }

    try {
      console.log('createClient: files count =', files.length, 'file fields =', Array.isArray(files) ? files.map(f => f.fieldname) : []);
      console.log('createClient: uploadsByField keys =', Object.keys(uploadsByField || {}));
      console.log('createClient: sample body keys (first 20) =', Object.keys(req.body || {}).slice(0, 20));
    } catch (_) { }

    // Build normalized KYC document items from uploaded files
    let kycDocumentItems = [];
    try {
      const entities = await DocumentEntity.find({ isActive: true })
        .select('_id fieldName required')
        .lean();
      const byField = new Map(entities.map(e => [e.fieldName, e]));
      for (const [fieldName, arr] of Object.entries(uploadsByField)) {
        const ent = byField.get(fieldName) || null; // fallback if not defined yet in DocumentEntity
        for (const f of arr) {
          kycDocumentItems.push({
            document: ent ? ent._id : null,
            fieldName,
            fileName: f.originalname,
            url: f.url,
            number: (req.body && req.body[fieldName]) ? req.body[fieldName] : undefined,
            approved: false,
            uploadedAt: new Date(),
          });
        }
      }
      // Fallback: if numbers exist in body for known fields but no files were captured for them, still create items with number-only
      for (const ent of entities) {
        const key = ent.fieldName;
        const val = (req.body && req.body[key]) ? String(req.body[key]).trim() : '';
        const alreadyHasFile = Array.isArray(uploadsByField[key]) && uploadsByField[key].length > 0;
        const alreadyAdded = kycDocumentItems.some(it => it.fieldName === key);
        if (!alreadyHasFile && !alreadyAdded && val) {
          kycDocumentItems.push({
            document: ent._id,
            fieldName: key,
            number: val,
            approved: false,
            uploadedAt: new Date(),
          });
        }
      }
      try { console.log('createClient: built kycDocumentItems count =', kycDocumentItems.length); } catch (_) { }
    } catch (e) {
      console.warn('createClient: failed to map KYC items via DocumentEntity:', e?.message || e);
    }

    // Basic company info
    const basicInfo = {
      companyName: body.companyName ?? body.company_name ?? undefined,
      legalName: body.legalName ?? body.legal_name ?? undefined,
      contactPerson: body.contactPerson ?? body.contact_person ?? undefined,
      // Structured primary contact fields
      primarySalutation: body.primarySalutation ?? body.primary_salutation ?? undefined,
      primaryFirstName: body.primaryFirstName ?? body.primary_first_name ?? body.primary_firstName ?? undefined,
      primaryLastName: body.primaryLastName ?? body.primary_last_name ?? body.primary_lastName ?? undefined,
      email: body.email ? String(body.email).toLowerCase().trim() : undefined,
      phone: body.phone ? String(body.phone).trim() : undefined,
      website: body.website ?? undefined,
      companyAddress: body.companyAddress ?? body.company_address ?? undefined,
      industry: body.industry ?? undefined,
    };

    // Commercial details
    const commercialDetails = {
      contactType: body.contactType ?? body.contact_type ?? "customer",
      customerSubType: body.customerSubType ?? body.customer_sub_type ?? "business",
      creditLimit: body.creditLimit ?? body.credit_limit ?? undefined,
      contactNumber: body.contactNumber ?? body.contact_number ?? undefined,
      isPortalEnabled: body.isPortalEnabled ?? body.is_portal_enabled ?? false,
      paymentTerms: body.paymentTerms ?? body.payment_terms ?? undefined,
      paymentTermsLabel: body.paymentTermsLabel ?? body.payment_terms_label ?? undefined,
      notes: body.notes ?? undefined,
    };

    // Address details - handle nested objects with proper field mapping
    let billingAddress = body.billingAddress ?? body.billing_address ?? undefined;
    let shippingAddress = body.shippingAddress ?? body.shipping_address ?? undefined;

    // Parse if they come as JSON strings (from FormData)
    if (typeof billingAddress === 'string') {
      try { billingAddress = JSON.parse(billingAddress); } catch (e) { billingAddress = undefined; }
    }
    if (typeof shippingAddress === 'string') {
      try { shippingAddress = JSON.parse(shippingAddress); } catch (e) { shippingAddress = undefined; }
    }

    const addressDetails = {
      billingAddress,
      shippingAddress,
    };
    let contactPersons = body.contactPersons ?? body.contact_persons ?? [];
    if (typeof contactPersons === 'string') {
      try {
        contactPersons = JSON.parse(contactPersons);
      } catch (e) {
        contactPersons = [];
      }
    }

    if (Array.isArray(contactPersons)) {
      contactPersons = contactPersons.map(person => ({
        salutation: person.salutation ?? undefined,
        first_name: person.first_name ?? person.firstName ?? undefined,
        last_name: person.last_name ?? person.lastName ?? undefined,
        email: person.email ? String(person.email).toLowerCase().trim() : undefined,
        phone: person.phone ?? undefined,
        mobile: person.mobile ?? undefined,
        designation: person.designation ?? undefined,
        department: person.department ?? undefined,
        is_primary_contact: person.is_primary_contact ?? person.isPrimaryContact ?? false,
        communication_preference: {
          is_sms_enabled: person.communication_preference?.is_sms_enabled ?? person.isSmsEnabled ?? false,
          is_whatsapp_enabled: person.communication_preference?.is_whatsapp_enabled ?? person.isWhatsappEnabled ?? false,
        },
        enable_portal: person.enable_portal ?? person.enablePortal ?? false,
      }));
    }

    // Tax and compliance
    const taxDetails = {
      gstNumber: body.gstNumber ?? body.gst_number ?? undefined, // legacy field
      gstNo: body.gstNo ?? body.gst_no ?? undefined,
      gstTreatment: body.gstTreatment ?? body.gst_treatment ?? undefined,
      isTaxable: body.isTaxable ?? body.is_taxable ?? true,
      taxRegNo: body.taxRegNo ?? body.tax_reg_no ?? undefined,
    };

    // Authority signee (local-only; will be included as contact person in Zoho if different from primary)
    let authoritySignee = body.authoritySignee ?? body.authority_signee ?? undefined;
    if (typeof authoritySignee === 'string') {
      try { authoritySignee = JSON.parse(authoritySignee); } catch (_) { authoritySignee = undefined; }
    }
    const isPrimaryContactauthoritySignee = (typeof body.isPrimaryContactauthoritySignee !== 'undefined')
      ? (body.isPrimaryContactauthoritySignee === true || body.isPrimaryContactauthoritySignee === 'true')
      : (typeof body.is_primary_contact_authority_signee !== 'undefined'
        ? (body.is_primary_contact_authority_signee === true || body.is_primary_contact_authority_signee === 'true')
        : true);

    // Zoho linkage
    const zohoDetails = {
      pricebookId: body.pricebookId ?? body.pricebook_id ?? undefined,
      currencyId: body.currencyId ?? body.currency_id ?? undefined,
      zohoBooksContactId: body.zohoBooksContactId ?? body.zoho_books_contact_id ?? undefined,
    };

    // Status and ownership fields
    const statusDetails = {
      companyDetailsComplete: body.companyDetailsComplete ?? body.company_details_complete ?? true,
      kycStatus: body.kycStatus ?? body.kyc_status ?? (files.length > 0 ? "verified" : "pending"),
      building: body.building ?? body.buildingId ?? undefined,
    };

    // Merge all sections into payload
    const payload = {
      ...basicInfo,
      ...commercialDetails,
      ...addressDetails,
      contactPersons,
      ...taxDetails,
      ...zohoDetails,
      ...statusDetails,
      ...(typeof isPrimaryContactauthoritySignee === 'boolean' ? { isPrimaryContactauthoritySignee } : {}),
      ...(authoritySignee ? { authoritySignee } : {}),
      ...(kycDocumentItems && kycDocumentItems.length ? { kycDocumentItems } : {}),
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const client = await Client.create(payload);
    let createdOwnerUserId = null;
    let ownerUserInfo = undefined;
    let zohoContactId = null;
    try {
      if (client?.email && client?.phone) {
        // Find or create 'client' role (case-insensitive)
        let roleClient = await Role.findOne({ roleName: { $regex: /^client$/i } });
        if (!roleClient) {
          roleClient = await Role.create({ roleName: "client", permissions: [] });
        }

        // Try to find existing user by email or phone
        let user = await User.findOne({
          $or: [
            ...(client.email ? [{ email: client.email }] : []),
            ...(client.phone ? [{ phone: client.phone }] : []),
          ],
        });

        if (!user) {
          // Per requirement: do not hash; set a default plain password
          const name = client.contactPerson?.trim() || client.companyName?.trim() || "Client User";
          user = await User.create({
            role: roleClient._id,
            name,
            email: client.email || undefined,
            phone: client.phone || undefined,
            password: '123456',
          });
        } else if (!user.role) {
          // If user exists without a role, assign client role
          user.role = roleClient._id;
          await user.save();
        }

        client.ownerUser = user._id;
        createdOwnerUserId = user._id;
        await client.save();

        // Also create a primary Member record for this client (owner)
        try {
          const existingOwnerMember = await Member.findOne({
            client: client._id,
            user: user._id,
            role: "owner",
          });

          if (!existingOwnerMember) {
            await Member.create({
              firstName: (client.contactPerson || client.companyName || "Owner").trim(),
              lastName: "",
              email: client.email || undefined,
              phone: client.phone || undefined,
              companyName: client.companyName || undefined,
              role: "owner",
              client: client._id,
              user: user._id,
              status: "active",
            });
          }
        } catch (memberErr) {
          console.error("createClient: failed to create owner member:", memberErr?.message || memberErr);
        }
      } else {
        ownerUserInfo = {
          note: "Owner user not created. Both email and phone are required to create a user.",
          hasEmail: Boolean(client?.email),
          hasPhone: Boolean(client?.phone)
        };
      }
    } catch (userErr) {
      console.error("createClient: failed to auto-create user:", userErr?.message || userErr);
    }
    try {
      if (!client.zohoBooksContactId) {
        // Build Zoho contact_persons: include primary from top-level fields, then additional contacts
        const splitName = (nameStr) => {
          if (!nameStr || typeof nameStr !== 'string') return { first: undefined, last: undefined };
          const parts = nameStr.trim().split(/\s+/);
          if (parts.length === 1) return { first: parts[0], last: undefined };
          return { first: parts[0], last: parts.slice(1).join(' ') };
        };

        const hasPrimaryInAdditional = Array.isArray(client.contactPersons) && client.contactPersons.some(cp => cp?.is_primary_contact);
        const inferred = splitName(client.contactPerson);
        const primaryContact = {
          salutation: client.primarySalutation || undefined,
          first_name: client.primaryFirstName || inferred.first || undefined,
          last_name: client.primaryLastName || inferred.last || undefined,
          email: client.email || undefined,
          phone: client.phone || undefined,
          mobile: client.phone || undefined,
          is_primary_contact: hasPrimaryInAdditional ? false : true,
          enable_portal: client.isPortalEnabled ?? false,
        };

        const additionalContacts = Array.isArray(client.contactPersons)
          ? client.contactPersons.map((cp) => ({
            salutation: cp?.salutation || undefined,
            first_name: cp?.first_name || cp?.firstName || undefined,
            last_name: cp?.last_name || cp?.lastName || undefined,
            email: cp?.email || undefined,
            phone: cp?.phone || undefined,
            mobile: cp?.mobile || cp?.phone || undefined,
            designation: cp?.designation || undefined,
            department: cp?.department || undefined,
            is_primary_contact: cp?.is_primary_contact ?? cp?.isPrimaryContact ?? false,
            enable_portal: cp?.enable_portal ?? cp?.enablePortal ?? false,
          }))
          : [];

        // If primary is NOT the authority signee, append authoritySignee as a non-primary contact
        if (client?.isPrimaryContactauthoritySignee === false && client?.authoritySignee) {
          const a = client.authoritySignee || {};
          const mapped = {
            salutation: a.salutation || undefined,
            first_name: a.firstName || undefined,
            last_name: a.lastName || undefined,
            email: a.email || undefined,
            phone: a.phone || undefined,
            mobile: a.phone || undefined,
            designation: a.designation || undefined,
            department: a.department || undefined,
            is_primary_contact: false,
            enable_portal: false,
          };
          // Only push if it has minimally identifying info
          if (mapped.first_name || mapped.email || mapped.phone) {
            additionalContacts.push(mapped);
          }
        }

        // Ensure only one primary contact (prefer an explicitly marked one in additionalContacts)
        let contactPersonsForZoho = [];
        if (hasPrimaryInAdditional) {
          contactPersonsForZoho = additionalContacts;
        } else {
          // Include primary first, then others
          contactPersonsForZoho = [primaryContact, ...additionalContacts];
        }
        contactPersonsForZoho = contactPersonsForZoho.filter(c => c.first_name || c.email || c.phone);
        let primaryContactSet = false;
        contactPersonsForZoho = contactPersonsForZoho.map((contact, index) => {
          const cleanContact = {};
          Object.keys(contact).forEach(key => {
            if (contact[key] !== undefined && contact[key] !== null && contact[key] !== '') {
              if (key === 'is_primary_contact') {
                // Only include is_primary_contact: true for the primary contact
                // Completely omit the field for all other contacts
                if (contact[key] === true && !primaryContactSet) {
                  cleanContact[key] = true;
                  primaryContactSet = true;
                }
                // Skip this field entirely if false or already set primary
              } else if (key === 'enable_portal') {
                cleanContact[key] = Boolean(contact[key]);
              } else {
                cleanContact[key] = contact[key];
              }
            }
          });
          return cleanContact;
        });

        // Ensure at least one contact has is_primary_contact: true
        if (!primaryContactSet && contactPersonsForZoho.length > 0) {
          contactPersonsForZoho[0].is_primary_contact = true;
        }

        const primaryNameForZoho = [
          (client.primaryFirstName || '').trim(),
          (client.primaryLastName || '').trim()
        ].filter(Boolean).join(' ').trim();

        const zohoPayload = {
          contact_name: client.companyName || primaryNameForZoho || "Unknown",
          company_name: client.companyName,
          email: client.email,
          phone: client.phone,
          website: client.website,
          contact_type: client.contactType || "customer",
          is_customer: true,
          customer_sub_type: client.customerSubType || "business",
          payment_terms: client.paymentTerms,
          payment_terms_label: client.paymentTermsLabel,
          notes: client.notes,
          billing_address: client.billingAddress,
          shipping_address: client.shippingAddress,
          ...(client.gstNo ? { gst_no: client.gstNo } : {}),
          ...(client.gstTreatment ? { gst_treatment: client.gstTreatment } : {}),
          ...((body?.placeOfContact || body?.place_of_contact) ? { place_of_contact: body.placeOfContact || body.place_of_contact } : {}),
          contact_persons: contactPersonsForZoho
        };

        Object.keys(zohoPayload).forEach(key => {
          if (zohoPayload[key] === undefined || zohoPayload[key] === null || zohoPayload[key] === '') {
            delete zohoPayload[key];
          }
        });

        console.log("createClient: Creating Zoho contact for client:", client._id);
        const zohoResponse = await createContact(zohoPayload);

        if (zohoResponse?.contact?.contact_id) {
          client.zohoBooksContactId = zohoResponse.contact.contact_id;
          await client.save();
          zohoContactId = zohoResponse.contact.contact_id;
          console.log("createClient: Successfully created Zoho contact:", zohoContactId);
        }
      } else {
        zohoContactId = client.zohoBooksContactId;
      }
    } catch (zohoErr) {
      console.error(
        "createClient: Zoho Books contact sync failed:",
        zohoErr?.message || zohoErr,
        "status:", zohoErr?.status,
        "response:", JSON.stringify(zohoErr?.response || {}, null, 2)
      );
    }

    // Activity log: Client created
    await logCRUDActivity(req, 'CREATE', 'Client', client._id, null, {
      companyName: client.companyName,
      contactPerson: client.contactPerson,
      email: client.email,
      ownerUserId: createdOwnerUserId,
      zohoContactId
    });

    // Send onboarding notification
    try {
      const memberName = `${basicInfo.primarySalutation || ''} ${basicInfo.primaryFirstName || ''} ${basicInfo.primaryLastName || ''}`.trim();
      await sendNotification({
        to: {
          email: basicInfo.email,
          phone: basicInfo.phone,
          clientId: client._id
        },
        channels: { sms: !!basicInfo.phone, email: !!basicInfo.email },
        templateKey: 'onboarding_initiated',
        templateVariables: {
          greeting: basicInfo.companyName,
          companyName: basicInfo.companyName,
          memberName: memberName || basicInfo.contactPerson || 'Member',
          ctaLink: "https://office-square.vercel.app/",
          ctaText: "access portal"
        },
        title: 'Welcome to Ofis Square',
        source: 'system',
        type: 'transactional'
      });
      console.log(`Onboarding notification sent to ${basicInfo.email}`);
    } catch (notificationErr) {
      console.warn("Failed to send onboarding notification:", notificationErr.message);
    }

    return res.status(201).json({ message: "Client created", client, ownerUserId: createdOwnerUserId, ownerUserInfo, zohoContactId });
  } catch (err) {
    console.error("createClient error:", err);
    return res.status(500).json({ error: "Failed to create client" });
  }
};

export const getClientLegalUsers = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ success: false, message: "Invalid client context" });
    }

    // Find the role document for "Client Legal Team" (case-insensitive)
    const role = await Role.findOne({ roleName: { $regex: /^client legal team$/i } }).select('_id roleName');
    if (!role?._id) {
      return res.json({ success: true, data: [] });
    }

    // Find users assigned to this client and role
    const users = await User.find({ role: role._id, clientId })
      .select('_id name email phone role clientId createdAt')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: users });
  } catch (err) {
    console.error('getClientLegalUsers error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch client legal users' });
  }
};

export const upsertBasicDetails = async (req, res) => {
  try {
    const clientId = req.clientId;
    const payload = {
      companyName: req.body?.company_name?.trim() || req.body?.companyName?.trim(),
      legalName: req.body?.legalName?.trim(),
      contactPerson: req.body?.contact_person?.trim() || req.body?.contactPerson?.trim(),
      email: req.body?.email?.toLowerCase().trim(),
      phone: req.body?.phone?.trim(),
      website: req.body?.website?.trim(),
      companyAddress: req.body?.companyAddress?.trim(),
      industry: req.body?.industry?.trim(),
      companyDetailsComplete: true,
      gstNumber: (req.body?.gstNumber || req.body?.gst_number)?.trim(),
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    if (!clientId) {
      const created = await Client.create(payload);
      // Activity log: Client created via basic details
      await logCRUDActivity(req, 'CREATE', 'Client', created._id, null, {
        companyName: created.companyName,
        contactPerson: created.contactPerson,
        email: created.email,
      });
      return res.status(201).json({ message: "Client created from basic details", client: created });
    }
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: "Invalid client id in token" });
    }

    const client = await Client.findByIdAndUpdate(clientId, { $set: payload }, { new: true });
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Activity log: basic details updated
    await logCRUDActivity(req, 'UPDATE', 'Client', client._id, null, {
      updatedFields: Object.keys(payload)
    });
    return res.json({ message: "Client basic details updated", client });
  } catch (err) {
    console.error("upsertBasicDetails error:", err);
    return res.status(500).json({ error: "Failed to save client details" });
  }
};

// Update commercial details
export const updateCommercialDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = {
      contactType: req.body?.contactType,
      customerSubType: req.body?.customerSubType,
      creditLimit: req.body?.creditLimit,
      contactNumber: req.body?.contactNumber,
      isPortalEnabled: req.body?.isPortalEnabled,
      paymentTerms: req.body?.paymentTerms,
      paymentTermsLabel: req.body?.paymentTermsLabel,
      notes: req.body?.notes,
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const client = await Client.findByIdAndUpdate(id, { $set: payload }, { new: true });
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Activity log: commercial details updated
    await logCRUDActivity(req, 'UPDATE', 'Client', client._id, null, {
      updatedFields: Object.keys(payload)
    });

    return res.json({ message: "Commercial details updated", client });
  } catch (err) {
    console.error("updateCommercialDetails error:", err);
    return res.status(500).json({ error: "Failed to update commercial details" });
  }
};

// Update address details
export const updateAddressDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = {
      billingAddress: req.body?.billingAddress,
      shippingAddress: req.body?.shippingAddress,
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const client = await Client.findByIdAndUpdate(id, { $set: payload }, { new: true });
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Activity log: address details updated
    await logCRUDActivity(req, 'UPDATE', 'Client', client._id, null, {
      updatedFields: Object.keys(payload)
    });

    return res.json({ message: "Address details updated", client });
  } catch (err) {
    console.error("updateAddressDetails error:", err);
    return res.status(500).json({ error: "Failed to update address details" });
  }
};

// Update contact persons
export const updateContactPersons = async (req, res) => {
  try {
    const { id } = req.params;
    const { contactPersons } = req.body;

    if (!Array.isArray(contactPersons)) {
      return res.status(400).json({ error: "Contact persons must be an array" });
    }

    const client = await Client.findByIdAndUpdate(
      id,
      { $set: { contactPersons } },
      { new: true }
    );
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Activity log: contact persons updated
    await logCRUDActivity(req, 'UPDATE', 'Client', client._id, null, {
      updatedFields: ['contactPersons'],
      count: Array.isArray(contactPersons) ? contactPersons.length : 0
    });

    return res.json({ message: "Contact persons updated", client });
  } catch (err) {
    console.error("updateContactPersons error:", err);
    return res.status(500).json({ error: "Failed to update contact persons" });
  }
};

// Update tax details
export const updateTaxDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = {
      gstNo: req.body?.gstNo,
      gstTreatment: req.body?.gstTreatment,
      isTaxable: req.body?.isTaxable,
      taxRegNo: req.body?.taxRegNo,
      // accept place of supply for Zoho sync
      placeOfContact: req.body?.placeOfContact ?? req.body?.place_of_contact,
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const client = await Client.findByIdAndUpdate(id, { $set: payload }, { new: true });
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Activity log: tax details updated
    await logCRUDActivity(req, 'UPDATE', 'Client', client._id, null, {
      updatedFields: Object.keys(payload)
    });

    // If client is linked to Zoho, push tax details to Zoho contact as well
    try {
      if (client.zohoBooksContactId) {
        const zohoTaxPayload = {};
        const topGstNo = (typeof client.gstNo === 'string' && client.gstNo.trim()) ? client.gstNo.trim() : undefined;
        const topGstTreatment = (typeof client.gstTreatment === 'string' && client.gstTreatment.trim()) ? client.gstTreatment.trim() : undefined;
        const incomingPlace = typeof payload.placeOfContact === 'string' && payload.placeOfContact.trim() ? payload.placeOfContact.trim() : (typeof req.body?.place_of_contact === 'string' && req.body.place_of_contact.trim() ? req.body.place_of_contact.trim() : undefined);

        if (topGstNo) zohoTaxPayload.gst_no = topGstNo;
        if (topGstTreatment) zohoTaxPayload.gst_treatment = topGstTreatment;

        // Pull existing contact to merge tax_info_list
        let existingContact = null;
        try { existingContact = await getContact(client.zohoBooksContactId); } catch (_) { }
        const existingList = Array.isArray(existingContact?.tax_info_list)
          ? existingContact.tax_info_list.map((t) => ({
            tax_info_id: t?.tax_info_id || undefined,
            tax_registration_no: (t?.tax_registration_no || '').toString().trim(),
            place_of_supply: (t?.place_of_supply || '').toString().trim(),
            is_primary: Boolean(t?.is_primary)
          })).filter(x => x.tax_registration_no && x.place_of_supply)
          : [];

        // Normalize incoming additional GST registrations
        const incomingList = Array.isArray(req.body?.tax_info_list)
          ? req.body.tax_info_list
          : (Array.isArray(req.body?.taxInfoList) ? req.body.taxInfoList : []);
        const addList = (Array.isArray(incomingList) ? incomingList : [])
          .map((it) => ({
            tax_info_id: undefined,
            tax_registration_no: (it?.tax_registration_no || it?.gst_no || it?.gstNo || '').toString().trim(),
            place_of_supply: (it?.place_of_supply || it?.place_of_contact || it?.placeOfContact || '').toString().trim(),
            is_primary: false,
          }))
          .filter((it) => it.tax_registration_no && it.place_of_supply);

        // Ensure top-level gst_no exists in list (as primary) with a place
        const existingPrimary = existingList.find(t => t.is_primary) || null;
        const inferredPrimaryPlace = incomingPlace || existingPrimary?.place_of_supply || existingContact?.place_of_contact || existingList.find(t => t.tax_registration_no === topGstNo)?.place_of_supply || undefined;
        const primaryEntry = topGstNo ? { tax_info_id: undefined, tax_registration_no: topGstNo, place_of_supply: inferredPrimaryPlace || '', is_primary: true } : null;

        // Build merged list with de-duplication (by reg + place)
        const byKey = new Map();
        const put = (item) => {
          if (!item || !item.tax_registration_no || !item.place_of_supply) return;
          const key = `${item.tax_registration_no}::${item.place_of_supply}`;
          const prev = byKey.get(key) || {};
          // Preserve tax_info_id if already known
          const tax_info_id = item.tax_info_id || prev.tax_info_id;
          byKey.set(key, { ...prev, ...item, tax_info_id, is_primary: Boolean(item.is_primary) });
        };
        existingList.forEach(put);
        addList.forEach(put);
        if (primaryEntry && primaryEntry.place_of_supply) put(primaryEntry);

        let merged = Array.from(byKey.values());
        // Decide primary: prefer topGstNo+place, else keep Zoho's primary
        let primaryKey = null;
        if (primaryEntry && primaryEntry.place_of_supply) {
          primaryKey = `${primaryEntry.tax_registration_no}::${primaryEntry.place_of_supply}`;
        } else if (existingPrimary) {
          primaryKey = `${existingPrimary.tax_registration_no}::${existingPrimary.place_of_supply}`;
        }
        merged = merged.map((it) => ({ ...it, is_primary: (primaryKey && `${it.tax_registration_no}::${it.place_of_supply}` === primaryKey) }));

        // If none marked primary yet but we have at least one, set the first as primary
        if (!merged.some(m => m.is_primary) && merged.length > 0) merged[0].is_primary = true;

        // Backfill top-level fields from primary selection if missing
        const selectedPrimary = merged.find(m => m.is_primary) || null;
        if (selectedPrimary) {
          if (!zohoTaxPayload.gst_no) zohoTaxPayload.gst_no = selectedPrimary.tax_registration_no;
          if (selectedPrimary.place_of_supply) zohoTaxPayload.place_of_contact = selectedPrimary.place_of_supply;
        } else if (incomingPlace) {
          zohoTaxPayload.place_of_contact = incomingPlace;
        }

        if (Object.keys(zohoTaxPayload).length > 0) {
          // Enforce Zoho's common string length validations (< 100 chars per string field)
          const clamp = (s) => (typeof s === 'string' ? s.slice(0, 100) : s);
          if (typeof zohoTaxPayload.gst_no === 'string') zohoTaxPayload.gst_no = clamp(zohoTaxPayload.gst_no);
          if (typeof zohoTaxPayload.gst_treatment === 'string') zohoTaxPayload.gst_treatment = clamp(zohoTaxPayload.gst_treatment);
          if (typeof zohoTaxPayload.place_of_contact === 'string') zohoTaxPayload.place_of_contact = clamp(zohoTaxPayload.place_of_contact);
          const finalList = merged.map(({ tax_info_id, tax_registration_no, place_of_supply, is_primary }) => ({
            ...(tax_info_id ? { tax_info_id } : {}),
            tax_registration_no: clamp(tax_registration_no || ''),
            place_of_supply: clamp(place_of_supply || ''),
            // Optional: set is_primary explicitly for the chosen primary
            ...(is_primary ? { is_primary: true } : {}),
          }));
          // FINAL DECISION: Do NOT push tax_info_list to Zoho as it causes validaton errors (code 15).
          // We only push top-level gst fields.
          // zohoTaxPayload.tax_info_list = finalList; 

          // Attempt update with base fields only. 
          try {
            const zohoRes = await updateContact(client.zohoBooksContactId, zohoTaxPayload);
            try { console.log('updateTaxDetails: pushed Zoho tax fields (base only):', JSON.stringify(zohoTaxPayload)); } catch (_) { }
            client.taxInfoList = finalList;
            await client.save();
            return res.json({ message: "Tax details updated (base synced to Zoho). Multiple GSTs stored locally.", client, zoho: zohoRes });
          } catch (e) {
            console.warn('updateTaxDetails: base tax update failed:', e?.message || e);
            // Even if Zoho update fails, we persist locally
            client.taxInfoList = finalList;
            await client.save();
            return res.json({ message: "Tax details updated locally. Zoho sync failed.", client, error: e?.message });
          }
        }
      }
    } catch (zErr) {
      console.warn('updateTaxDetails: Zoho contact tax sync failed:', zErr?.message || zErr);
      // Continue without failing the request
    }

    return res.json({ message: "Tax details updated", client });
  } catch (err) {
    console.error("updateTaxDetails error:", err);
    return res.status(500).json({ error: "Failed to update tax details" });
  }
};

export const getClients = async (_req, res) => {
  try {
    const clients = await Client.aggregate([
      {
        $lookup: {
          from: "clientcreditwallets",
          localField: "_id",
          foreignField: "client",
          as: "wallet"
        }
      },
      {
        $lookup: {
          from: "credittransactions",
          localField: "_id",
          foreignField: "client",
          as: "transactions"
        }
      },
      {
        $lookup: {
          from: "contracts",
          localField: "_id",
          foreignField: "client",
          as: "contracts"
        }
      },
      {
        $lookup: {
          from: "cabins",
          localField: "_id",
          foreignField: "allocatedTo",
          as: "allocatedCabins"
        }
      },
      {
        $addFields: {
          wallet: { $arrayElemAt: ["$wallet", 0] },
          totalCredits: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$transactions",
                    cond: { $eq: ["$$this.type", "grant"] }
                  }
                },
                as: "transaction",
                in: "$$transaction.credits"
              }
            }
          },
          hasActiveContract: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$contracts",
                    cond: { $eq: ["$$this.status", "active"] }
                  }
                }
              },
              0
            ]
          },
          hasCabin: {
            $gt: [{ $size: "$allocatedCabins" }, 0]
          }
        }
      },
      {
        $sort: { createdAt: -1 }
      }
    ]);

    return res.json({ success: true, data: clients });
  } catch (err) {
    console.error("getClients error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
};

export const getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    return res.json(client);
  } catch (err) {
    console.error("getClientById error:", err);
    return res.status(500).json({ error: "Failed to fetch client" });
  }
};

export const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    // Start with shallow copy of body and normalize fields
    const payload = { ...(req.body || {}) };

    // Normalize companyAddress - schema expects a String
    let companyAddress = payload.companyAddress ?? payload.company_address;
    if (companyAddress !== undefined) {
      if (typeof companyAddress === 'object' && companyAddress !== null) {
        // Compose a readable single-line address string from known fields
        const parts = [];
        const ca = companyAddress;
        // Support common keys
        const candidates = [
          ca.attention,
          ca.address,
          ca.street,
          ca.street1,
          ca.street2,
          ca.city,
          ca.state,
          ca.state_code,
          ca.zip,
          ca.postalCode,
          ca.country,
        ];
        candidates.forEach((p) => {
          if (p !== undefined && p !== null && String(p).trim() !== '') parts.push(String(p).trim());
        });
        payload.companyAddress = parts.join(', ') || undefined;
      } else if (typeof companyAddress === 'string') {
        payload.companyAddress = companyAddress;
      } else {
        // Unknown type; drop to avoid cast errors
        payload.companyAddress = undefined;
      }
      delete payload.company_address;
    }

    // Normalize billing/shipping address: may arrive as JSON strings
    if (typeof payload.billingAddress === 'string') {
      try { payload.billingAddress = JSON.parse(payload.billingAddress); } catch (_) { delete payload.billingAddress; }
    }
    if (typeof payload.shippingAddress === 'string') {
      try { payload.shippingAddress = JSON.parse(payload.shippingAddress); } catch (_) { delete payload.shippingAddress; }
    }

    // Normalize contactPersons if provided as JSON string
    if (typeof payload.contactPersons === 'string') {
      try { payload.contactPersons = JSON.parse(payload.contactPersons); } catch (_) { delete payload.contactPersons; }
    }

    // Normalize parkingSpaces: accept nested object or top-level fields
    if (typeof payload.parkingSpaces === 'string') {
      try { payload.parkingSpaces = JSON.parse(payload.parkingSpaces); } catch (_) { delete payload.parkingSpaces; }
    }
    const hasTopLevelTwo = Object.prototype.hasOwnProperty.call(payload, 'noOf2WheelerParking');
    const hasTopLevelFour = Object.prototype.hasOwnProperty.call(payload, 'noOf4WheelerParking');
    if (hasTopLevelTwo || hasTopLevelFour) {
      payload.parkingSpaces = {
        ...(payload.parkingSpaces || {}),
        noOf2WheelerParking: hasTopLevelTwo
          ? Number(payload.noOf2WheelerParking)
          : Number(payload.parkingSpaces?.noOf2WheelerParking),
        noOf4WheelerParking: hasTopLevelFour
          ? Number(payload.noOf4WheelerParking)
          : Number(payload.parkingSpaces?.noOf4WheelerParking),
      };
    }
    if (payload.parkingSpaces && typeof payload.parkingSpaces === 'object') {
      const two = Number(payload.parkingSpaces.noOf2WheelerParking);
      const four = Number(payload.parkingSpaces.noOf4WheelerParking);
      payload.parkingSpaces.noOf2WheelerParking = Number.isFinite(two) && two >= 0 ? two : 0;
      payload.parkingSpaces.noOf4WheelerParking = Number.isFinite(four) && four >= 0 ? four : 0;
    }
    // Clean up any top-level aliases to avoid unintended schema casting
    delete payload.noOf2WheelerParking;
    delete payload.noOf4WheelerParking;

    // Remove undefined to avoid unintentionally unsetting fields
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    // Fetch existing to compute diffs for parking-specific logs
    const existingClient = await Client.findById(id).select('parkingSpaces');

    const updated = await Client.findByIdAndUpdate(id, { $set: payload }, { new: true });
    if (!updated) return res.status(404).json({ error: "Client not found" });

    // Activity log: client updated (generic)
    await logCRUDActivity(req, 'UPDATE', 'Client', id, null, {
      updatedFields: Object.keys(payload)
    });

    // Parking-specific logs by type (two-wheeler / four-wheeler)
    try {
      if (payload.parkingSpaces) {
        const oldTwo = Number(existingClient?.parkingSpaces?.noOf2WheelerParking) || 0;
        const newTwo = Number(updated?.parkingSpaces?.noOf2WheelerParking) || 0;
        if (oldTwo !== newTwo) {
          await logActivity({
            req,
            action: 'UPDATE',
            entity: 'Client',
            entityId: updated._id,
            description: 'Parking updated (Two-wheeler)',
            metadata: {
              category: 'parking',
              parkingType: 'two_wheeler',
              oldValue: oldTwo,
              newValue: newTwo,
              source: 'client_edit',
            },
          });
        }
        const oldFour = Number(existingClient?.parkingSpaces?.noOf4WheelerParking) || 0;
        const newFour = Number(updated?.parkingSpaces?.noOf4WheelerParking) || 0;
        if (oldFour !== newFour) {
          await logActivity({
            req,
            action: 'UPDATE',
            entity: 'Client',
            entityId: updated._id,
            description: 'Parking updated (Four-wheeler)',
            metadata: {
              category: 'parking',
              parkingType: 'four_wheeler',
              oldValue: oldFour,
              newValue: newFour,
              source: 'client_edit',
            },
          });
        }
      }
    } catch (logErr) {
      console.warn('updateClient: parking logs failed:', logErr?.message || logErr);
    }
    return res.json({ message: "Client updated", client: updated });
  } catch (err) {
    console.error("updateClient error:", err);
    return res.status(500).json({ error: "Failed to update client" });
  }
};

export const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Client.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Client not found" });

    // Activity log: client deleted
    await logCRUDActivity(req, 'DELETE', 'Client', id, null, {
      companyName: deleted?.companyName,
      contactPerson: deleted?.contactPerson
    });
    return res.json({ message: "Client deleted" });
  } catch (err) {
    console.error("deleteClient error:", err);
    return res.status(500).json({ error: "Failed to delete client" });
  }
};

export const syncClientToZoho = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    let zohoId = client.zohoBooksContactId;

    // If no Zoho ID, try to find or create
    if (!zohoId) {
      zohoId = await findOrCreateContactFromClient(client);
      if (zohoId) {
        client.zohoBooksContactId = zohoId;
        await client.save();
      }
    }

    if (!zohoId) {
      return res.status(400).json({ error: "Could not establish a Zoho Contact ID for this client. Please ensure client has a valid email." });
    }

    // Pull latest data from Zoho to sync back to local DB
    try {
      const zohoContact = await getContact(zohoId);
      if (zohoContact) {
        console.log(`[ZohoSync] Pulling latest data from Zoho for client ${id}`);

        // Update local client with Zoho data
        if (zohoContact.gst_no) client.gstNo = zohoContact.gst_no;
        if (zohoContact.gst_treatment) client.gstTreatment = zohoContact.gst_treatment;
        if (zohoContact.tax_reg_no) client.taxRegNo = zohoContact.tax_reg_no;

        if (Array.isArray(zohoContact.tax_info_list)) {
          client.taxInfoList = zohoContact.tax_info_list.map(t => ({
            tax_info_id: t.tax_info_id,
            tax_registration_no: t.tax_registration_no,
            place_of_supply: t.place_of_supply,
            is_primary: t.is_primary,
            legal_name: t.legal_name,
            trader_name: t.trader_name
          }));
        }

        // Update contact persons if needed (optional, but good for consistency)
        if (Array.isArray(zohoContact.contact_persons) && zohoContact.contact_persons.length > 0) {
          // You might want a more sophisticated merge here, but for now let's keep it simple
          // client.contactPersons = ... 
        }

        await client.save();
      }
    } catch (pullErr) {
      console.warn(`[ZohoSync] Failed to pull latest data from Zoho for client ${id}:`, pullErr.message);
    }

    // Prepare payload from local client data
    const contactPerson = client.contactPerson || "";
    const payload = {
      contact_name: client.companyName || contactPerson || "Unknown",
      company_name: client.companyName || contactPerson || "Unknown",
      email: client.email,
      phone: client.phone,
      mobile: client.phone,
      contact_type: client.contactType || "customer",
      customer_sub_type: client.customerSubType || "business",
      website: client.website || "",
      notes: client.notes || "",
      legal_name: client.legalName || "",
      payment_terms: client.paymentTerms || 0,
      pan_no: client.panNo || "",
      gst_no: client.gstNo || "",
      gst_treatment: client.gstTreatment || (client.gstNo ? "business_gst" : "consumer"),
      credit_limit: client.creditLimit || 0,
      is_portal_enabled: client.isPortalEnabled || false,
      place_of_contact: client.billingAddress?.state_code || client.billingAddress?.state || "",
      billing_address: client.billingAddress ? {
        attention: client.billingAddress.attention || contactPerson || "",
        address: client.billingAddress.address || "",
        street2: client.billingAddress.street2 || "",
        city: client.billingAddress.city || "",
        state: client.billingAddress.state || "",
        zip: client.billingAddress.zip || "",
        country: client.billingAddress.country || "INDIA",
        phone: client.phone || ""
      } : {
        attention: contactPerson,
        country: "INDIA"
      },
      shipping_address: client.shippingAddress ? {
        attention: client.shippingAddress.attention || contactPerson || "",
        address: client.shippingAddress.address || "",
        street2: client.shippingAddress.street2 || "",
        city: client.shippingAddress.city || "",
        state: client.shippingAddress.state || "",
        zip: client.shippingAddress.zip || "",
        country: client.shippingAddress.country || "INDIA",
        phone: client.phone || ""
      } : (client.billingAddress ? {
        attention: client.billingAddress.attention || contactPerson || "",
        address: client.billingAddress.address || "",
        street2: client.billingAddress.street2 || "",
        city: client.billingAddress.city || "",
        state: client.billingAddress.state || "",
        zip: client.billingAddress.zip || "",
        country: client.billingAddress.country || "INDIA",
        phone: client.phone || ""
      } : {
        attention: contactPerson,
        country: "INDIA"
      }),
      contact_persons: client.contactPersons?.map(cp => ({
        salutation: cp.salutation || "",
        first_name: cp.first_name || cp.firstName || "",
        last_name: cp.last_name || cp.lastName || "",
        email: cp.email || "",
        phone: cp.phone || "",
        mobile: cp.phone || "",
        designation: cp.designation || "",
        department: cp.department || "",
        is_primary_contact: Boolean(cp.is_primary_contact || cp.isPrimaryContact),
        enable_portal: Boolean(cp.enable_portal || cp.isPortalEnabled)
      })) || []
    };

    // If client has taxInfoList (multiple GSTs), include them
    // REMOVED as per user request to avoid Zoho error code 15
    /*
    if (client.taxInfoList && client.taxInfoList.length > 0) {
      payload.tax_info_list = client.taxInfoList.map(t => ({
        tax_registration_no: t.tax_registration_no,
        place_of_supply: t.place_of_supply,
        is_primary: t.is_primary
      }));
    }
    */

    console.log(`[ZohoSync] Syncing client ${id} (${client.companyName}) to Zoho ID: ${zohoId}`);
    // console.log("[ZohoSync] Payload:", JSON.stringify(payload, null, 2));

    const result = await updateContact(zohoId, payload);

    // Log activity
    await logCRUDActivity(req, 'SYNC_ZOHO', 'Client', id, null, {
      zohoId,
      companyName: client.companyName
    });

    return res.json({ success: true, message: "Client synced to Zoho successfully", data: result });
  } catch (err) {
    console.error("syncClientToZoho error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to sync client to Zoho" });
  }
};

// // Delete client member
// export const deleteClientMember = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const member = await Member.findByIdAndDelete(id);
//     if (!member) return res.status(404).json({ error: "Member not found" });

//     // Activity log: member deleted
//     await logCRUDActivity(req, 'DELETE', 'Member', id, null, {
//       name: `${member.firstName} ${member.lastName || ''}`.trim()
//     });

//     return res.json({ message: "Member deleted" });
//   } catch (err) {
//     console.error("deleteClientMember error:", err);
//     return res.status(500).json({ error: "Failed to delete member" });
//   }
// };

// Get client-assigned RFID cards
export const getClientRfidCards = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const cards = await RFIDCard.find({ clientId })
      .populate({ path: 'currentMemberId', select: 'firstName lastName email' })
      .populate({ path: 'buildingId', select: 'name' })
      .lean();

    return res.json({ success: true, data: cards });
  } catch (err) {
    console.error("getClientRfidCards error:", err);
    return res.status(500).json({ error: "Failed to fetch RFID cards" });
  }
};

// Submit KYC documents: set kycDocuments and kycStatus=pending
export const submitKycDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const { kyc_documents } = req.body || {};

    // Upload incoming files to ImageKit and collect URLs by field
    const files = Array.isArray(req.files) ? req.files : [];
    const uploadsByField = {};
    await Promise.all(
      files.map(async (f) => {
        const folder = process.env.IMAGEKIT_KYC_FOLDER || "/ofis-square/kyc";
        const result = await imagekit.upload({
          file: f.buffer,
          fileName: f.originalname || `${Date.now()}_${f.fieldname}`,
          folder,
        });
        const entry = {
          fieldname: f.fieldname,
          originalname: f.originalname,
          url: result?.url,
        };
        if (!uploadsByField[f.fieldname]) uploadsByField[f.fieldname] = [];
        uploadsByField[f.fieldname].push(entry);
      })
    );

    // Load all active document entities (entityType denotes group like Individual/Proprietorship)
    const docEntities = await DocumentEntity.find({ isActive: true })
      .select("_id fieldName entityType required")
      .lean();
    const docByField = new Map(docEntities.map((d) => [d.fieldName, d]));

    // Build normalized items from uploaded files. For any fieldName, also take number from req.body[fieldName] if present
    const newItems = [];
    for (const [fieldName, arr] of Object.entries(uploadsByField)) {
      const ent = docByField.get(fieldName) || null;
      for (const f of arr) {
        newItems.push({
          document: ent ? ent._id : null,
          fieldName,
          fileName: f.originalname,
          url: f.url,
          number: req.body?.[fieldName] || undefined,
          approved: false,
          uploadedAt: new Date(),
        });
      }
    }

    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycStatus: "verified" }, $push: { kycDocumentItems: { $each: newItems } } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Client not found" });

    console.log(`KYC documents submitted for client ${id}, status set to verified`);
    await logBusinessEvent({
      req,
      action: 'KYC_SUBMITTED',
      entity: 'Client',
      entityId: id,
      details: {
        filesUploaded: Object.values(uploadsByField || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0),
      }
    });
    return res.json({
      message: "KYC documents submitted successfully. Awaiting verification.",
      client: updated,
      nextStep: "verification"
    });
  } catch (err) {
    console.error("submitKycDocuments error:", err);
    return res.status(500).json({ error: "Failed to submit KYC documents" });
  }
};

export const verifyKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { buildingId, capacity = 4, monthlyRent } = req.body || {};

    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Update KYC status to verified
    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycStatus: "verified" } },
      { new: true }
    );

    // After KYC verification, automatically create a draft contract
    let contractId = null;
    try {
      const Contract = (await import("../models/contractModel.js")).default;
      const Building = (await import("../models/buildingModel.js")).default;

      // Get default building if not specified
      let targetBuildingId = buildingId;
      if (!targetBuildingId && updated.building) {
        targetBuildingId = updated.building;
      }
      if (!targetBuildingId) {
        // Get first active building as fallback
        const defaultBuilding = await Building.findOne({ status: "active" });
        targetBuildingId = defaultBuilding?._id;
      }

      if (targetBuildingId) {
        const building = await Building.findById(targetBuildingId);
        const calculatedRent = monthlyRent || (building?.pricing ? building.pricing * capacity : 15000);

        const contract = await Contract.create({
          client: id,
          building: targetBuildingId,
          startDate: new Date(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          capacity: capacity,
          monthlyRent: calculatedRent,
          status: "draft",
          fileUrl: "placeholder",
        });

        contractId = contract._id;

        // Update client with building reference
        await Client.findByIdAndUpdate(id, { building: targetBuildingId });

        console.log(`Auto-created contract ${contractId} for verified client ${id}`);

        // Business event: contract draft created post KYC verification
        await logBusinessEvent({
          req,
          action: 'CONTRACT_DRAFT_CREATED',
          entity: 'Contract',
          entityId: contractId,
          related: [{ entity: 'Client', id }],
          details: { building: targetBuildingId, capacity, monthlyRent: calculatedRent }
        });
      }
    } catch (e) {
      console.error("verifyKyc: failed to create contract:", e);
      // Don't fail KYC verification if contract creation fails
    }

    // Business event: KYC verified
    await logBusinessEvent({
      req,
      action: 'KYC_VERIFIED',
      entity: 'Client',
      entityId: id,
      details: { contractId }
    });

    return res.json({
      message: "KYC verified successfully",
      client: updated,
      contractId,
      nextStep: contractId ? "contract_review" : "manual_contract_creation"
    });
  } catch (err) {
    console.error("verifyKyc error:", err);
    return res.status(500).json({ error: "Failed to verify KYC" });
  }
};

export const rejectKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycStatus: "rejected", ...(reason && { kycRejectionReason: reason }) } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Client not found" });

    // Business event: KYC rejected
    await logBusinessEvent({
      req,
      action: 'KYC_REJECTED',
      entity: 'Client',
      entityId: id,
      details: { reason }
    });

    return res.json({ message: "KYC rejected", client: updated });
  } catch (err) {
    console.error("rejectKyc error:", err);
    return res.status(500).json({ error: "Failed to reject KYC" });
  }
};

// Client Dashboard API - Get dashboard stats and recent activity
export const getClientDashboard = async (req, res) => {
  try {
    const clientId = req.clientId; // from clientMiddleware
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    // Get client info
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Get active bookings count (meeting bookings use status: booked | cancelled | completed)
    const activeBookings = await MeetingBooking.countDocuments({
      client: clientId,
      status: { $in: ["booked"] }
    });

    // Get pending invoices count
    const pendingInvoices = await Invoice.countDocuments({
      client: clientId,
      status: { $in: ["issued", "overdue"] }
    });

    // Get open tickets count (tickets are associated by client)
    const openTickets = await Ticket.countDocuments({
      client: clientId,
      status: { $in: ["open", "inprogress", "pending"] }
    });

    // Get recent activity (last 10 items)
    const recentInvoices = await Invoice.find({ client: clientId })
      .populate('building', 'name')
      .populate('cabin', 'number')
      .sort({ createdAt: -1 })
      .limit(3)
      .select('invoiceNumber status total createdAt');

    const recentBookings = await MeetingBooking.find({ client: clientId })
      .populate('room', 'name')
      .sort({ createdAt: -1 })
      .limit(3)
      .select('room status start end createdAt');

    const recentTickets = await Ticket.find({ client: clientId })
      .sort({ createdAt: -1 })
      .limit(2)
      .select('subject status priority createdAt');

    // Format recent activity
    const recentActivity = [];

    recentInvoices.forEach(invoice => {
      recentActivity.push({
        type: 'invoice',
        title: `Invoice ${invoice.invoiceNumber} ${invoice.status}`,
        description: `Amount: ₹${invoice.total}`,
        timestamp: invoice.createdAt,
        status: invoice.status
      });
    });

    recentBookings.forEach(booking => {
      recentActivity.push({
        type: 'booking',
        title: `Meeting room booking ${booking.status}`,
        description: `Room: ${booking.room?.name || 'N/A'}`,
        timestamp: booking.createdAt,
        status: booking.status
      });
    });

    recentTickets.forEach(ticket => {
      recentActivity.push({
        type: 'ticket',
        title: `Support ticket: ${ticket.subject}`,
        description: `Priority: ${ticket.priority}`,
        timestamp: ticket.createdAt,
        status: ticket.status
      });
    });

    // Sort by timestamp and limit to 5 most recent
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedActivity = recentActivity.slice(0, 5);

    const dashboardData = {
      stats: {
        activeBookings,
        pendingInvoices,
        openTickets
      },
      recentActivity: limitedActivity,
      client: {
        companyName: client.companyName,
        contactPerson: client.contactPerson,
        email: client.email,
        kycStatus: client.kycStatus
      }
    };

    return res.json({ success: true, data: dashboardData });
  } catch (err) {
    console.error("getClientDashboard error:", err);
    return res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};

// Get client profile with cabin, invoice, and contract details
export const getClientProfile = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const client = await Client.findById(clientId).select('-ownerUser -kycDocuments');
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Get allocated cabin details
    const allocatedCabin = await mongoose.model('Cabin').findOne({ allocatedTo: clientId })
      .populate('building', 'name address')
      .populate('contract', 'startDate endDate monthlyRent status');

    // Get recent invoices (last 5)
    const recentInvoices = await Invoice.find({ client: clientId })
      .populate('building', 'name')
      .populate('cabin', 'number')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get active contracts
    const contracts = await Contract.find({ client: clientId })
      .populate('building', 'name address')
      .sort({ createdAt: -1 });

    const profileData = {
      ...client.toObject(),
      allocatedCabin,
      recentInvoices,
      contracts
    };

    return res.json({ success: true, data: profileData });
  } catch (err) {
    console.error("getClientProfile error:", err);
    return res.status(500).json({ error: "Failed to fetch client profile" });
  }
};

// Get client bookings
export const getClientBookings = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const bookings = await MeetingBooking.find(query)
      .populate('room', 'name capacity')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await MeetingBooking.countDocuments(query);

    return res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getClientBookings error:", err);
    return res.status(500).json({ error: "Failed to fetch client bookings" });
  }
};

// Get client invoices
export const getClientInvoices = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const invoices = await Invoice.find(query)
      .populate('building', 'name')
      .populate('cabin', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Invoice.countDocuments(query);

    return res.json({
      success: true,
      data: {
        invoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getClientInvoices error:", err);
    return res.status(500).json({ error: "Failed to fetch client invoices" });
  }
};

// Get client contracts
export const getClientContracts = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    // Fetch all contracts for the client, including draft contracts
    const contracts = await Contract.find({ client: clientId })
      .populate('building', 'name address')
      .sort({ createdAt: -1 });

    // Explicitly ensure draft contracts are accessible to clients
    // The frontend will handle display filtering based on status

    return res.json({ success: true, data: contracts });
  } catch (err) {
    console.error("getClientContracts error:", err);
    return res.status(500).json({ error: "Failed to fetch client contracts" });
  }
};

// Approve client contract
export const approveClientContract = async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.clientId;

    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    // Verify contract belongs to this client
    if (contract.client.toString() !== clientId) {
      return res.status(403).json({ error: "Unauthorized: Contract does not belong to this client" });
    }

    // Allow approval if contract is draft, sent_to_client, or client_feedback_pending
    const validStatuses = ['draft', 'sent_to_client', 'client_feedback_pending', 'sent_for_signature'];
    if (!validStatuses.includes(contract.status)) {
      return res.status(400).json({ error: `Cannot approve contract with status: ${contract.status}. Valid statuses: ${validStatuses.join(', ')}` });
    }

    // Update contract status to client_approved
    contract.status = 'client_approved';
    contract.clientApprovedAt = new Date();
    contract.clientapproved = true; // Set the client approval flag to true

    await contract.save();

    await logActivity({
      req,
      action: 'CONTRACT_APPROVED',
      entity: 'Contract',
      entityId: contract._id,
      description: `Client approved contract ${contract._id}`,
      metadata: {
        clientId,
        contractId: contract._id,
        approvedBy: 'client'
      }
    });

    return res.json({
      success: true,
      message: "Contract approved successfully",
      data: contract
    });
  } catch (err) {
    console.error("approveClientContract error:", err);
    return res.status(500).json({ error: "Failed to approve contract" });
  }
};

// Send a contract to the client's legal team for review
export const sendContractToLegalTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.clientId;

    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ error: "Contract not found" });

    // Ensure the contract belongs to this client
    if (contract.client.toString() !== clientId) {
      return res.status(403).json({ error: "Unauthorized: Contract does not belong to this client" });
    }

    // Do not resend if already sent to client or contract is active
    if (contract.status === 'sent_to_client') {
      return res.status(400).json({ error: "Contract is already sent to client legal team" });
    }
    if (contract.status === 'active') {
      return res.status(400).json({ error: "Cannot send active contract to legal team" });
    }

    // Allowed states to transition from
    const allowed = ['draft', 'client_feedback_pending', 'sent_for_signature', 'pending_signature'];
    if (!allowed.includes(contract.status)) {
      return res.status(400).json({ error: `Cannot send contract in status '${contract.status}' to legal team` });
    }

    // Transition to sent_to_client for review by client legal team
    contract.status = 'sent_to_client';
    contract.sentToClientAt = new Date();

    // Optional: Append a comment entry (audit trail)
    if (!Array.isArray(contract.comments)) contract.comments = [];
    contract.comments.push({
      type: 'internal',
      message: 'Contract sent to client legal team for review',
      at: new Date(),
    });

    await contract.save();

    await logActivity({
      req,
      action: 'CONTRACT_SENT_TO_CLIENT',
      entity: 'Contract',
      entityId: contract._id,
      description: `Client sent contract ${contract._id} to legal team`,
      metadata: { clientId, contractId: contract._id }
    });

    return res.json({ success: true, message: 'Contract sent to client legal team', data: contract });
  } catch (err) {
    console.error("sendContractToLegalTeam error:", err);
    return res.status(500).json({ error: "Failed to send contract to legal team" });
  }
};

// Submit client contract feedback
export const submitClientContractFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const feedback = req.body?.feedback || req.body;
    const clientId = req.clientId;

    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    if (!feedback || (typeof feedback === 'string' && !feedback.trim())) {
      return res.status(400).json({ error: "Feedback is required" });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    // Verify contract belongs to this client
    if (contract.client.toString() !== clientId) {
      return res.status(403).json({ error: "Unauthorized: Contract does not belong to this client" });
    }

    // Allow feedback if contract is draft, sent_to_client, client_feedback_pending, or sent_for_signature
    const validStatuses = ['draft', 'sent_to_client', 'client_feedback_pending', 'sent_for_signature'];
    if (!validStatuses.includes(contract.status)) {
      return res.status(400).json({ error: `Cannot provide feedback for contract with status: ${contract.status}. Valid statuses: ${validStatuses.join(', ')}` });
    }

    // Handle file uploads if present
    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      const imagekit = (await import('../utils/imageKit.js')).default;
      for (const file of req.files) {
        try {
          const fileName = `client_feedback_${id}_${Date.now()}_${file.originalname}`;
          const uploadResponse = await imagekit.upload({
            file: file.buffer,
            fileName: fileName,
            folder: "/contracts/client-feedback"
          });

          uploadedFiles.push({
            fileName: file.originalname,
            fileUrl: uploadResponse.url,
            uploadedAt: new Date()
          });
        } catch (uploadErr) {
          console.error("File upload error:", uploadErr);
          // Continue with other files even if one fails
        }
      }
    }

    // Update contract with feedback
    contract.clientFeedback = feedback;
    contract.clientFeedbackAt = new Date();

    // Add uploaded files to feedback attachments
    if (uploadedFiles.length > 0) {
      if (!contract.clientFeedbackAttachments) {
        contract.clientFeedbackAttachments = [];
      }
      contract.clientFeedbackAttachments.push(...uploadedFiles);
    }

    // Add to comments array
    if (!contract.comments) contract.comments = [];
    const attachmentInfo = uploadedFiles.length > 0
      ? ` (${uploadedFiles.length} attachment${uploadedFiles.length > 1 ? 's' : ''})`
      : '';
    contract.comments.push({
      type: 'client',
      message: `Client feedback: ${feedback}${attachmentInfo}`,
      at: new Date()
    });

    // Custom flow reset: on client feedback, roll back to Legal stage
    // Clear send/sign flags and force a fresh legal upload
    contract.iscontractsentforsignature = false;
    contract.adminapproved = false;
    contract.clientapproved = false;
    contract.isclientsigned = false;
    // contract.fileUrl = null;
    contract.legalUploadedAt = null;
    contract.legalUploadedBy = null;
    contract.legalUploadNotes = null;
    contract.status = 'client_feedback_pending';

    // Maintain an audit trail in clientFeedbackHistory
    try {
      if (!Array.isArray(contract.clientFeedbackHistory)) contract.clientFeedbackHistory = [];
      contract.clientFeedbackHistory.push({ text: feedback, submittedAt: new Date(), submittedBy: clientId });
    } catch { }

    await contract.save();

    await logActivity({
      req,
      action: 'CONTRACT_UPDATED',
      entity: 'Contract',
      entityId: contract._id,
      description: `Client provided feedback on contract ${contract._id}`,
      metadata: {
        clientId,
        contractId: contract._id,
        feedback,
        feedbackType: 'client_feedback'
      }
    });

    // Send notification to legal team - wrapped in try/catch to prevent blocking
    try {
      await sendNotification({
        to: {
          clientId: clientId
        },
        channels: { email: true, sms: false },
        content: {
          smsText: `Client has provided feedback on contract ${contract._id}`,
          emailSubject: 'Client Contract Feedback',
          emailHtml: `<p>Client has provided feedback on contract ${contract._id}</p><p>Feedback: ${feedback}</p>`,
          emailText: `Client has provided feedback on contract ${contract._id}. Feedback: ${feedback}`
        },
        title: 'Client Contract Feedback',
        metadata: {
          category: 'contract',
          contractId: contract._id,
          clientId
        },
        source: 'client_portal',
        type: 'contract_feedback'
      });
    } catch (notifError) {
      console.warn('Failed to send notification:', notifError.message);
    }

    // Send email to Sales, Legal team, and Admins
    const populatedContract = await Contract.findById(contract._id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    await sendClientFeedbackAlertEmail(populatedContract, feedback);

    return res.json({
      success: true,
      message: "Feedback submitted successfully",
      data: contract
    });
  } catch (err) {
    console.error("submitClientContractFeedback error:", err);
    return res.status(500).json({ error: "Failed to submit feedback" });
  }
};

// Get client tickets
export const getClientTickets = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const tickets = await Ticket.find(query)
      .populate('building', 'name')
      .populate('cabin', 'name')
      .populate('assignedTo', 'name')
      .populate('createdBy', 'firstName lastName email phone')
      .populate('category.categoryId', 'name description subCategories')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Ticket.countDocuments(query);

    return res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (err) {
    console.error('getClientTickets error:', err);
    return res.status(500).json({ error: 'Failed to fetch client tickets' });
  }
};

// Create client ticket
export const createClientTicket = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { subject, description, priority = "low", category, images } = req.body || {};

    if (!subject || !description) {
      return res.status(400).json({ error: "Subject and description are required" });
    }

    // Get building ID from client table
    const client = await Client.findById(clientId).select("building");
    if (!client || !client.building) {
      return res.status(400).json({ error: "Client building not found. Please contact admin." });
    }

    // Create ticket with client reference and building from client table
    const ticket = await Ticket.create({
      subject,
      description,
      priority,
      category,
      images: images || [],
      client: clientId,
      building: client.building,
      createdBy: null,
      status: "open"
    });

    return res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    console.error("createClientTicket error:", err);
    return res.status(500).json({ error: "Failed to create ticket" });
  }
};

// Get client members
export const getClientMembers = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const members = await Member.find(query)
      .populate('desk', 'number status building cabin')
      .populate('user', 'name email')
      .populate({
        path: 'matrixUser',
        populate: {
          path: 'cards',
          select: 'cardUid'
        }
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Member.countDocuments(query);

    // Map members to include rfid data at top level for UI
    const mappedMembers = members.map(member => {
      const memberObj = member.toObject();
      const card = memberObj.matrixUser?.cards?.[0];
      return {
        ...memberObj,
        rfidCardId: card?._id || null,
        rfidUuid: card?.cardUid || null,
        isCardCredentialVerified: memberObj.matrixUser?.isCardCredentialVerified || false
      };
    });

    return res.json({
      success: true,
      data: {
        members: mappedMembers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getClientMembers error:", err);
    return res.status(500).json({ error: "Failed to fetch client members" });
  }
};

// Create member for client
export const createClientMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { firstName, lastName, email, phone, role, password, cardId } = req.body || {};

    if (!firstName) {
      return res.status(400).json({ error: "firstName is required" });
    }

    let userId = null;

    let roleName = role;
    if (mongoose.Types.ObjectId.isValid(role)) {
      const roleDoc = await Role.findById(role);
      if (roleDoc) {
        roleName = roleDoc.roleName;
      }
    }

    // Create user automatically if email and role are provided
    if (email && role) {
      try {
        const rawPassword = '123456';

        const user = await User.create({
          name: `${firstName} ${lastName || ''}`.trim(),
          email: email,
          password: rawPassword,
          phone: phone,
          role: role, // Use the provided role ID directly
          isActive: true
        });

        userId = user._id;
      } catch (userErr) {
        console.log("Failed to create user for member:", userErr.message);
      }
    }

    const member = await Member.create({
      firstName,
      lastName,
      email,
      phone,
      role: roleName, // Store roleName string in Member
      client: clientId,
      user: userId,
      status: "active"
    });

    // Handle RFID card assignment if provided
    if (cardId) {
      console.log(`createClientMember: cardId ${cardId} provided, starting assignment flow.`);
      try {
        const card = await RFIDCard.findById(cardId);
        if (card) {
          console.log(`createClientMember: found RFID card with UID ${card.cardUid}`);
          // Identify/Normalize Matrix User ID (e.g. 91 prefixed phone)
          let externalUserId = null;
          if (phone) {
            let p = String(phone).replace(/\D/g, "");
            p = p.replace(/^0+/, "");
            const last10 = p.length > 10 ? p.slice(-10) : p;
            if (last10.length === 10) externalUserId = `91${last10}`;
            console.log(`createClientMember: normalized phone ${phone} to externalUserId ${externalUserId}`);
          }

          if (externalUserId) {
            // Find or create MatrixUser
            let mUser = await MatrixUser.findOne({ externalUserId });
            if (!mUser) {
              console.log(`createClientMember: creating new MatrixUser for ${externalUserId}`);
              mUser = await MatrixUser.create({
                name: `${firstName} ${lastName || ''}`.trim(),
                phone: phone,
                email: email,
                externalUserId: externalUserId,
                memberId: member._id,
                clientId: clientId,
                status: 'active'
              });
            } else {
              console.log(`createClientMember: found existing MatrixUser ${mUser._id} for ${externalUserId}`);
            }

            // Link card to MatrixUser
            console.log(`createClientMember: adding card ${cardId} to MatrixUser ${mUser._id}`);
            await MatrixUser.findByIdAndUpdate(mUser._id, {
              $addToSet: { cards: cardId }
            });

            // Update card ownership
            console.log(`createClientMember: updating RFID card ${cardId} status to ACTIVE and setting currentMemberId`);
            await RFIDCard.findByIdAndUpdate(cardId, {
              currentMemberId: member._id,
              clientId: clientId,
              status: "ACTIVE",
              activatedAt: new Date()
            });

            // 1. Direct Matrix API User Creation
            console.log(`createClientMember: calling matrixApi.createUser for ${externalUserId}`);
            try {
              await matrixApi.createUser({
                id: externalUserId,
                name: `${firstName} ${lastName || ''}`.trim(),
                email: email || undefined,
                phone: phone || undefined,
                status: "active"
              });
            } catch (apiErr) {
              console.error("createClientMember: Matrix createUser failed:", apiErr.message);
              // We continue even if API fails, as it might already exist or job will retry
            }

            // 2. Automatic Device Assignment based on building policy
            try {
              const clientDoc = await Client.findById(clientId).select("building").lean();
              const buildingId = clientDoc?.building;
              if (buildingId) {
                // Find default policy for building
                const policy = await AccessPolicy.findOne({
                  buildingId,
                  isDefaultForBuilding: true,
                  status: "active"
                }).lean();

                if (policy && policy.accessPointIds?.length) {
                  console.log(`createClientMember: found default policy ${policy._id}, assigning devices...`);
                  const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } }).select("deviceBindings").lean();

                  const deviceObjIds = [];
                  for (const ap of accessPoints) {
                    for (const b of ap.deviceBindings || []) {
                      if (b.vendor === "MATRIX_COSEC" && b.deviceId) {
                        deviceObjIds.push(b.deviceId);
                      }
                    }
                  }

                  const uniqueDeviceObjIds = [...new Set(deviceObjIds.map(id => String(id)))];
                  if (uniqueDeviceObjIds.length) {
                    const devices = await MatrixDevice.find({ _id: { $in: uniqueDeviceObjIds } }).select("device_id").lean();
                    let assignedCount = 0;
                    for (const d of devices) {
                      if (d.device_id) {
                        try {
                          const resAssign = await matrixApi.assignUserToDevice({ device_id: d.device_id, externalUserId });
                          if (resAssign?.ok) assignedCount++;
                        } catch (e) {
                          console.error(`createClientMember: failed to assign device ${d.device_id}:`, e.message);
                        }
                      }
                    }

                    if (assignedCount > 0) {
                      await MatrixUser.findByIdAndUpdate(mUser._id, {
                        $set: { isDeviceAssigned: true, isEnrolled: true, policyId: policy._id }
                      });
                      console.log(`createClientMember: assigned ${assignedCount} devices to user.`);
                    }
                  }
                } else {
                  console.warn(`createClientMember: no default policy found for building ${buildingId}`);
                }
              }
            } catch (policyErr) {
              console.error("createClientMember: device assignment flow failed:", policyErr.message);
            }

            // 3. Direct Card Credential Setting
            console.log(`createClientMember: setting card credential ${card.cardUid} for ${externalUserId}`);
            try {
              await matrixApi.setCardCredential({ externalUserId, data: card.cardUid });
              await MatrixUser.findByIdAndUpdate(mUser._id, { $set: { isCardCredentialVerified: true } });
            } catch (cardErr) {
              console.error("createClientMember: Matrix setCardCredential failed:", cardErr.message);
            }

            // 4. Final local updates & Job Enqueue
            console.log(`createClientMember: linking MatrixUser ${mUser._id} back to Member ${member._id}`);
            await Member.findByIdAndUpdate(member._id, {
              matrixUser: mUser._id,
              matrixExternalUserId: externalUserId
            });

            // Enqueue provisioning for assignment to Matrix API (as background record/retry)
            console.log(`createClientMember: enqueuing ASSIGN_CARD ProvisioningJob for card ${cardId}`);
            try {
              await ProvisioningJob.create({
                vendor: "MATRIX_COSEC",
                jobType: "ASSIGN_CARD",
                memberId: member._id,
                cardId: card._id,
                payload: { cardUid: card.cardUid, memberId: member._id }
              });
            } catch (jobErr) {
              console.error("createClientMember: failed to enqueue provisioning job:", jobErr.message);
            }

            console.log(`createClientMember: RFID assignment flow completed successfully.`);
          } else {
            console.warn(`createClientMember: could not normalize phone for MatrixUser assignment.`);
          }
        } else {
          console.warn(`createClientMember: RFID card ${cardId} not found in database.`);
        }
      } catch (rfidErr) {
        console.error("createClientMember: failed to assign RFID card:", rfidErr.message);
      }
    }

    // 5. Automated BHAiFi Provisioning (Always attempt for all members)
    console.log(`createClientMember: starting BHAiFi provisioning for member ${member._id}`);
    try {
      const activeContract = await Contract.findOne({
        client: clientId,
        status: "active"
      }).sort({ createdAt: -1 }).select("_id").lean();

      if (activeContract) {
        console.log(`createClientMember: found active contract ${activeContract._id} for BHAiFi sync.`);
      } else {
        console.log(`createClientMember: no active contract found for BHAiFi sync.`);
      }

      const bhaifiDoc = await ensureBhaifiForMember({
        memberId: member._id,
        contractId: activeContract?._id
      });

      if (bhaifiDoc) {
        console.log(`createClientMember: BHAiFi provisioning successful, user: ${bhaifiDoc.userName}`);
        await Member.findByIdAndUpdate(member._id, {
          $set: {
            bhaifiUser: bhaifiDoc._id,
            bhaifiUserName: bhaifiDoc.userName
          }
        });
      }
    } catch (bhaifiErr) {
      console.error("createClientMember: BHAiFi provisioning failed:", bhaifiErr.message);
      // We do not fail the whole request if BHAiFi provisioning fails
    }

    // Send platform access welcome email to the new member (template-based)
    try {
      if (email) {
        const portalLink = process.env.PLATFORM_LOGIN_URL || process.env.PORTAL_URL || 'https://ofis-square.app/login';
        await sendNotification({
          to: { email, clientId },
          channels: { email: true, sms: false },
          templateKey: 'platform_access_welcome',
          templateVariables: { link: portalLink },
          title: 'Platform Access - Welcome',
          metadata: {
            category: 'onboarding',
            tags: ['platform_access', 'welcome']
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (e) {
      console.warn('createClientMember: failed to send platform access email:', e?.message || e);
    }

    return res.status(201).json({ success: true, data: member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("createClientMember error:", err);
    return res.status(500).json({ error: "Failed to create member" });
  }
};

// Update client member
export const updateClientMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { id } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { firstName, lastName, email, phone, role, status, cardId } = req.body || {};

    let roleName = role;
    if (role && mongoose.Types.ObjectId.isValid(role)) {
      const roleDoc = await Role.findById(role);
      if (roleDoc) {
        roleName = roleDoc.roleName;
      }
    }

    const member = await Member.findOneAndUpdate(
      { _id: id, client: clientId }, // Ensure member belongs to this client
      {
        firstName,
        lastName,
        email,
        phone,
        role: roleName, // Store roleName string in Member
        status
      },
      { new: true, runValidators: true }
    );

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    // Handle RFID card assignment if provided
    if (cardId) {
      console.log(`updateClientMember: cardId ${cardId} provided, starting assignment flow.`);
      try {
        const card = await RFIDCard.findById(cardId);
        if (card) {
          console.log(`updateClientMember: found RFID card with UID ${card.cardUid}`);
          // Identify/Normalize Matrix User ID (e.g. 91 prefixed phone)
          let externalUserId = null;
          if (phone || member.phone) {
            let p = String(phone || member.phone).replace(/\D/g, "");
            p = p.replace(/^0+/, "");
            const last10 = p.length > 10 ? p.slice(-10) : p;
            if (last10.length === 10) externalUserId = `91${last10}`;
          }

          if (externalUserId) {
            // Find or create MatrixUser
            let mUser = await MatrixUser.findOne({ externalUserId });
            if (!mUser) {
              mUser = await MatrixUser.create({
                name: `${firstName || member.firstName} ${lastName || member.lastName || ''}`.trim(),
                phone: phone || member.phone,
                email: email || member.email,
                externalUserId: externalUserId,
                memberId: member._id,
                clientId: clientId,
                status: 'active'
              });
            }

            // Link card to MatrixUser
            await MatrixUser.findByIdAndUpdate(mUser._id, {
              $addToSet: { cards: cardId }
            });

            // Update card ownership
            await RFIDCard.findByIdAndUpdate(cardId, {
              currentMemberId: member._id,
              clientId: clientId,
              status: "ACTIVE",
              activatedAt: new Date()
            });

            // 1. Direct Matrix API User Creation/Update
            try {
              await matrixApi.createUser({
                id: externalUserId,
                name: `${firstName || member.firstName} ${lastName || member.lastName || ''}`.trim(),
                email: (email || member.email) || undefined,
                phone: (phone || member.phone) || undefined,
                status: "active"
              });
            } catch (apiErr) {
              console.error("updateClientMember: Matrix createUser failed:", apiErr.message);
            }

            // 2. Direct Card Credential Setting
            try {
              await matrixApi.setCardCredential({ externalUserId, data: card.cardUid });
              await MatrixUser.findByIdAndUpdate(mUser._id, { $set: { isCardCredentialVerified: true } });
            } catch (cardErr) {
              console.error("updateClientMember: Matrix setCardCredential failed:", cardErr.message);
            }

            // 3. Final local updates & Job Enqueue
            await Member.findByIdAndUpdate(member._id, {
              matrixUser: mUser._id,
              matrixExternalUserId: externalUserId
            });

            // Enqueue provisioning job
            try {
              await ProvisioningJob.create({
                vendor: "MATRIX_COSEC",
                jobType: "ASSIGN_CARD",
                memberId: member._id,
                cardId: card._id,
                payload: { cardUid: card.cardUid, memberId: member._id }
              });
            } catch (jobErr) {
              console.error("updateClientMember: failed to enqueue provisioning job:", jobErr.message);
            }
          }
        }
      } catch (rfidErr) {
        console.error("updateClientMember: failed to assign RFID card:", rfidErr.message);
      }
    }

    // Sync to User if exists
    try {
      await syncMemberToUser(id, { firstName, lastName, email, phone, role, status }, req);
    } catch (syncErr) {
      console.warn("Failed to sync client member update to user:", syncErr.message);
    }

    return res.json({ success: true, data: member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("updateClientMember error:", err);
    return res.status(500).json({ error: "Failed to update member" });
  }
};

// Delete client member
export const deleteClientMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { id } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const member = await Member.findOneAndDelete({ _id: id, client: clientId });

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    return res.json({ success: true, message: "Member deleted successfully" });
  } catch (err) {
    console.error("deleteClientMember error:", err);
    return res.status(500).json({ error: "Failed to delete member" });
  }
};

// Get available desks for client's allocated cabin
export const getClientAvailableDesks = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    // Find client's allocated cabin
    const allocatedCabin = await mongoose.model('Cabin').findOne({ allocatedTo: clientId })
      .populate('building', 'name address');

    if (!allocatedCabin) {
      return res.status(404).json({ error: "No cabin allocated to this client" });
    }
    const activeContract = await Contract.findOne({
      client: clientId,
      status: 'active'
    }).sort({ createdAt: -1 });

    const contractCapacity = activeContract?.capacity || 0;
    const allDesks = await Desk.find({ cabin: allocatedCabin._id })
      .populate('building', 'name')
      .populate('cabin', 'number floor')
      .sort({ number: 1 });
    const allocatedDesksCount = await Member.countDocuments({
      client: clientId,
      desk: { $ne: null }
    });

    const availableDesks = allDesks.filter(desk => desk.status === 'available');
    const canAllocateMore = allocatedDesksCount < contractCapacity;
    const remainingCapacity = Math.max(0, contractCapacity - allocatedDesksCount);
    const desksToShow = canAllocateMore ? availableDesks.slice(0, remainingCapacity) : [];

    return res.json({
      success: true,
      data: {
        cabin: allocatedCabin,
        desks: allDesks,
        availableDesks: desksToShow,
        contractCapacity,
        allocatedDesksCount,
        remainingCapacity,
        canAllocateMore
      }
    });
  } catch (err) {
    console.error("getClientAvailableDesks error:", err);
    return res.status(500).json({ error: "Failed to fetch available desks" });
  }
};

// Allocate desk to member
export const allocateDeskToMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { memberId, deskId } = req.body || {};

    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    if (!memberId || !deskId) {
      return res.status(400).json({ error: "memberId and deskId are required" });
    }

    // Get client's active contract to check capacity
    const activeContract = await Contract.findOne({
      client: clientId,
      status: 'active'
    }).sort({ createdAt: -1 });

    if (!activeContract) {
      return res.status(400).json({ error: "No active contract found for this client" });
    }

    const contractCapacity = activeContract.capacity || 0;

    // Count currently allocated desks for this client
    const allocatedDesksCount = await Member.countDocuments({
      client: clientId,
      desk: { $ne: null }
    });

    // Check if allocation would exceed contract capacity
    if (allocatedDesksCount >= contractCapacity) {
      return res.status(400).json({
        error: `Cannot allocate more desks. Contract capacity is ${contractCapacity} and ${allocatedDesksCount} desks are already allocated.`
      });
    }

    // Verify member belongs to this client
    const member = await Member.findOne({ _id: memberId, client: clientId });
    if (!member) {
      return res.status(404).json({ error: "Member not found or does not belong to this client" });
    }

    // Check if member already has a desk
    if (member.desk) {
      return res.status(400).json({ error: "Member already has a desk allocated" });
    }

    // Verify desk exists and is available
    const desk = await Desk.findById(deskId).populate("building cabin");
    if (!desk) {
      return res.status(404).json({ error: "Desk not found" });
    }

    if (desk.status !== "available") {
      return res.status(400).json({ error: "Desk is not available" });
    }

    // Verify desk is in client's allocated cabin
    const allocatedCabin = await mongoose.model('Cabin').findOne({ allocatedTo: clientId });
    if (!allocatedCabin || String(desk.cabin._id) !== String(allocatedCabin._id)) {
      return res.status(403).json({ error: "Desk is not in your allocated cabin" });
    }

    // Update desk status and member desk reference
    desk.status = "occupied";
    desk.allocatedAt = new Date();
    desk.releasedAt = undefined;
    await desk.save();

    // Update member with desk reference
    member.desk = desk._id;
    await member.save();

    return res.json({
      success: true,
      message: "Desk allocated to member successfully",
      data: { member, desk, remainingCapacity: contractCapacity - allocatedDesksCount - 1 }
    });
  } catch (err) {
    console.error("allocateDeskToMember error:", err);
    return res.status(500).json({ error: "Failed to allocate desk to member" });
  }
};

// Release desk from member
export const releaseDeskFromMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { memberId } = req.body || {};

    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    if (!memberId) {
      return res.status(400).json({ error: "memberId is required" });
    }

    // Verify member belongs to this client and has a desk
    const member = await Member.findOne({ _id: memberId, client: clientId }).populate('desk');
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    if (!member.desk) {
      return res.status(400).json({ error: "Member does not have an allocated desk" });
    }

    const desk = member.desk;

    // Update desk status
    desk.status = "available";
    desk.releasedAt = new Date();
    await desk.save();

    // Remove desk reference from member
    member.desk = null;
    await member.save();

    return res.json({
      success: true,
      message: "Desk released from member successfully",
      data: { member, desk }
    });
  } catch (err) {
    console.error("releaseDeskFromMember error:", err);
    return res.status(500).json({ error: "Failed to release desk from member" });
  }
};

// Get client credit management data
export const getClientCreditManagement = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 20, type, member, startDate, endDate } = req.query;

    // Get client credit wallet
    const wallet = await ClientCreditWallet.findOne({ client: clientId });

    // Build transaction query
    const transactionQuery = { client: clientId };
    if (type && type !== 'all') transactionQuery.type = type;
    if (member && member !== 'all') transactionQuery.member = member;

    if (startDate || endDate) {
      transactionQuery.createdAt = {};
      if (startDate) transactionQuery.createdAt.$gte = new Date(startDate);
      if (endDate) transactionQuery.createdAt.$lte = new Date(endDate);
    }

    // Get transactions with pagination
    const transactions = await CreditTransaction.find(transactionQuery)
      .populate('member', 'firstName lastName email')
      .populate('refId')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const totalTransactions = await CreditTransaction.countDocuments(transactionQuery);

    // Get credit summary by type
    const creditSummary = await CreditTransaction.aggregate([
      { $match: { client: new mongoose.Types.ObjectId(clientId) } },
      {
        $group: {
          _id: '$type',
          totalCredits: { $sum: '$credits' },
          totalValue: { $sum: { $multiply: ['$credits', '$valuePerCredit'] } },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get top spending members
    const topSpenders = await CreditTransaction.aggregate([
      {
        $match: {
          client: new mongoose.Types.ObjectId(clientId),
          type: 'consume',
          member: { $ne: null }
        }
      },
      {
        $group: {
          _id: '$member',
          totalCredits: { $sum: '$credits' },
          totalValue: { $sum: { $multiply: ['$credits', '$valuePerCredit'] } },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { totalCredits: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'members',
          localField: '_id',
          foreignField: '_id',
          as: 'member'
        }
      },
      { $unwind: '$member' }
    ]);

    // Get monthly credit usage trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyTrend = await CreditTransaction.aggregate([
      {
        $match: {
          client: new mongoose.Types.ObjectId(clientId),
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            type: '$type'
          },
          credits: { $sum: '$credits' },
          value: { $sum: { $multiply: ['$credits', '$valuePerCredit'] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    return res.json({
      success: true,
      data: {
        wallet: wallet || { balance: 0, creditValue: 200, currency: 'INR' },
        transactions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: totalTransactions,
          pages: Math.ceil(totalTransactions / Number(limit))
        },
        summary: {
          creditSummary,
          topSpenders,
          monthlyTrend
        }
      }
    });
  } catch (err) {
    console.error("getClientCreditManagement error:", err);
    return res.status(500).json({ error: "Failed to fetch credit management data" });
  }
};

// Get current client profile (for settings page)
export const getCurrentClientProfile = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const client = await Client.findById(clientId).select('-ownerUser -kycDocuments');
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    return res.json({ success: true, data: client });
  } catch (err) {
    console.error("getCurrentClientProfile error:", err);
    return res.status(500).json({ error: "Failed to fetch client profile" });
  }
};

// Update current client profile (for settings page)
export const updateCurrentClientProfile = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const {
      companyName,
      contactPerson,
      email,
      phone,
      companyAddress,
      documentName,
      documentLink
    } = req.body || {};

    // Validate required fields
    if (!companyName || !contactPerson || !email || !phone) {
      return res.status(400).json({
        error: "Company name, contact person, email, and phone are required"
      });
    }

    // Update client profile
    const updatedClient = await Client.findByIdAndUpdate(
      clientId,
      {
        $set: {
          companyName: companyName.trim(),
          contactPerson: contactPerson.trim(),
          email: email.toLowerCase().trim(),
          phone: phone.trim(),
          companyAddress: companyAddress?.trim() || "",
          documentName: documentName?.trim() || "",
          documentLink: documentLink?.trim() || ""
        }
      },
      { new: true, runValidators: true }
    ).select('-ownerUser -kycDocuments');

    if (!updatedClient) {
      return res.status(404).json({ error: "Client not found" });
    }

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: updatedClient
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("updateCurrentClientProfile error:", err);
    return res.status(500).json({ error: "Failed to update client profile" });
  }
};

// Get onboarding status for a client
export const getOnboardingStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    // Find the latest contract for this client
    const contract = await Contract.findOne({ client: id })
      .sort({ createdAt: -1 })
      .select("status fileUrl securityDeposit securityDepositPaidAt");

    const status = {
      clientId: client._id,
      clientName: client.companyName,
      isClientApproved: client.isClientApproved || false,

      // Contract check
      hasContract: !!contract,
      contractId: contract?._id || null,
      contractStatus: contract?.status || null,
      contractFileUrl: contract?.fileUrl || null,

      // Security deposit check
      securityDepositPaid: client.isSecurityPaid || false,
      securityDepositAmount: client.securityDeposit?.amount || contract?.securityDeposit?.amount || 0,
      securityDepositPaidAt: contract?.securityDepositPaidAt || null,

      // KYC check
      kycStatus: client.kycStatus || "none",
      kycDocuments: client.kycDocuments || null,
      hasKycDocuments: !!client.kycDocuments,

      // Overall readiness checks
      checks: {
        hasActiveContract: contract?.status === "active",
        hasContractFile: !!contract?.fileUrl,
        securityDepositPaid: client.isSecurityPaid || false,
        kycVerified: client.kycStatus === "verified",
      }
    };

    // Calculate if all checks pass
    const allChecksPassed =
      status.checks.hasActiveContract &&
      status.checks.hasContractFile &&
      status.checks.securityDepositPaid &&
      status.checks.kycVerified;

    status.readyForAllocation = allChecksPassed;
    status.canApprove = allChecksPassed && !client.isClientApproved;

    return res.json({ success: true, data: status });
  } catch (error) {
    console.error("getOnboardingStatus error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Approve client for onboarding (system admin only)
export const approveOnboarding = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user has System Admin role
    const userRole = req.user?.role?.roleName || req.user?.role?.name;
    if (userRole !== "System Admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only System Admin can approve onboarding."
      });
    }

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    // Check if already approved
    if (client.isClientApproved) {
      return res.status(400).json({
        success: false,
        message: "Client is already approved for onboarding"
      });
    }

    // Find the latest contract with building populated
    const contract = await Contract.findOne({ client: id })
      .sort({ createdAt: -1 })
      .populate('building', 'name address city pricing');

    const status = {
      clientId: client._id,
      clientName: client.companyName,
      isClientApproved: client.isClientApproved || false,

      // Contract check
      hasContract: !!contract,
      contractId: contract?._id || null,
      contractStatus: contract?.status || null,
      contractFileUrl: contract?.fileUrl || null,

      // Security deposit check
      securityDepositPaid: client.isSecurityPaid || false,
      securityDepositAmount: client.securityDeposit?.amount || contract?.securityDeposit?.amount || 0,
      securityDepositPaidAt: contract?.securityDepositPaidAt || null,

      // KYC check
      kycStatus: client.kycStatus || "none",
      kycDocuments: client.kycDocuments || null,
      hasKycDocuments: !!client.kycDocuments,

      // Overall readiness checks
      checks: {
        hasActiveContract: contract?.status === "active",
        hasContractFile: !!contract?.fileUrl,
        securityDepositPaid: client.isSecurityPaid || false,
        kycVerified: client.kycStatus === "verified",
      }
    };

    // Calculate if all checks pass
    const allChecksPassed =
      status.checks.hasActiveContract &&
      status.checks.hasContractFile &&
      status.checks.securityDepositPaid &&
      status.checks.kycVerified;

    if (!allChecksPassed) {
      return res.status(400).json({
        success: false,
        message: "Cannot approve onboarding. Please complete all requirements.",
        errors: Object.keys(status.checks).filter(key => !status.checks[key])
      });
    }

    // All checks passed - approve the client
    client.isClientApproved = true;
    await client.save();

    // Log activity
    await logActivity(req, "ONBOARDING_APPROVED", "Client", client._id, {
      clientName: client.companyName,
      contractId: contract._id,
      approvedBy: req.user?._id
    });

    return res.json({
      success: true,
      message: "Client approved for onboarding successfully",
      data: {
        clientId: client._id,
        isClientApproved: true,
        contractId: contract._id,
        buildingId: contract.building._id,
        building: contract.building
      }
    });
  } catch (error) {
    console.error("approveOnboarding error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
