import mongoose from "mongoose";
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
import bcrypt from "bcrypt";
import { getClientPayments } from "./paymentController.js";
import { createContact } from "../utils/zohoBooks.js";
import { sendNotification } from "../utils/notificationHelper.js";
import { logCRUDActivity, logActivity } from "../utils/activityLogger.js";
import { sendClientFeedbackAlertEmail } from "../utils/contractEmailService.js";

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
          const entry = {
            fieldname: f.fieldname,
            originalname: f.originalname,
            mimetype: f.mimetype,
            size: f.size,
            url: result?.url,
            fileId: result?.fileId,
            name: result.name,
            filePath: result.filePath,
          };
          if (!uploadsByField[f.fieldname]) uploadsByField[f.fieldname] = [];
          uploadsByField[f.fieldname].push(entry);
        })
      );
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

    // KYC Documents
    const kycDocuments = Object.keys(uploadsByField).length > 0 ? { files: uploadsByField } : undefined;

    // Merge all sections into payload
    const payload = {
      ...basicInfo,
      ...commercialDetails,
      ...addressDetails,
      contactPersons,
      ...taxDetails,
      ...zohoDetails,
      ...statusDetails,
      ...(kycDocuments ? { kycDocuments } : {}),
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
    try {
      if (client.email) {
        const name = (client.contactPerson || client.companyName || "there").trim();
        const result = await sendNotification({
          to: { email: client.email, clientId: client._id },
          channels: { sms: false, email: true },
          templateKey: 'welcome_email',
          templateVariables: {
            name,
            companyName: process.env.BRAND_NAME || 'Ofis Square'
          },
          title: 'Welcome to Ofis Square',
          metadata: { category: 'onboarding', tags: ['welcome', 'new_client'] },
          source: 'system',
          type: 'transactional'
        });

        if (result?._id) {
          console.log(`Welcome notification queued (email) for ${client.email}`);
        }
      }
    } catch (notifErr) {
      console.error("createClient: Welcome notification failed:", notifErr?.message || notifErr);
    }

    // Activity log: Client created
    await logCRUDActivity(req, 'CREATE', 'Client', client._id, null, {
      companyName: client.companyName,
      contactPerson: client.contactPerson,
      email: client.email,
      ownerUserId: createdOwnerUserId,
      zohoContactId
    });

    return res.status(201).json({ message: "Client created", client, ownerUserId: createdOwnerUserId, ownerUserInfo, zohoContactId });
  } catch (err) {
    console.error("createClient error:", err);
    return res.status(500).json({ error: "Failed to create client" });
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
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    
    const client = await Client.findByIdAndUpdate(id, { $set: payload }, { new: true });
    if (!client) return res.status(404).json({ error: "Client not found" });
    
    // Activity log: tax details updated
    await logCRUDActivity(req, 'UPDATE', 'Client', client._id, null, {
      updatedFields: Object.keys(payload)
    });

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
    const updated = await Client.findByIdAndUpdate(id, { $set: req.body || {} }, { new: true });
    if (!updated) return res.status(404).json({ error: "Client not found" });
    
    // Activity log: client updated (generic)
    await logCRUDActivity(req, 'UPDATE', 'Client', id, null, {
      updatedFields: Object.keys(req.body || {})
    });
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
          file: f.buffer, // Buffer supported by SDK
          fileName: f.originalname || `${Date.now()}_${f.fieldname}`,
          folder,
        });
        const entry = {
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          url: result?.url,
          fileId: result?.fileId,
          name: result.name,
          filePath: result.filePath,
        };
        if (!uploadsByField[f.fieldname]) uploadsByField[f.fieldname] = [];
        uploadsByField[f.fieldname].push(entry);
      })
    );

    // Merge body-provided KYC data and uploaded file URLs
    const mergedKyc = {
      ...(kyc_documents ?? req.body?.kycDocuments ?? {}),
      ...(Object.keys(uploadsByField).length ? { files: uploadsByField } : {}),
    };

    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycDocuments: mergedKyc, kycStatus: "verified" } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Client not found" });
    
    console.log(`KYC documents submitted for client ${id}, status set to verified`);
    // Business event: KYC submitted
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
      .sort({ createdAt: -1 })
      .limit(3)
      .select('invoiceNumber status total createdAt');

    const recentBookings = await MeetingBooking.find({ client: clientId })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate('room', 'name')
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

    const client = await Client.findById(clientId);
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

    const contracts = await Contract.find({ client: clientId })
      .populate('building', 'name address')
      .sort({ createdAt: -1 });

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

    // Only allow approval if contract is sent_to_client or client_feedback_pending
    if (contract.status !== 'sent_to_client' && contract.status !== 'client_feedback_pending') {
      return res.status(400).json({ error: `Cannot approve contract with status: ${contract.status}` });
    }

    // Update contract status to client_approved
    contract.status = 'client_approved';
    contract.clientApprovedAt = new Date();
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

    // Allow feedback if contract is sent_to_client or client_feedback_pending (to update feedback)
    if (contract.status !== 'sent_to_client' && contract.status !== 'client_feedback_pending') {
      return res.status(400).json({ error: `Cannot provide feedback for contract with status: ${contract.status}` });
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

    // Update contract with feedback (keep current status)
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
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Member.countDocuments(query);

    return res.json({
      success: true,
      data: {
        members,
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

    const { firstName, lastName, email, phone, role, password } = req.body || {};
    
    if (!firstName) {
      return res.status(400).json({ error: "firstName is required" });
    }

    let userId = null;

    // Create user automatically if email is provided
    if (email) {
      try {
        // Find member role with specific ID
        const memberRole = await Role.findById("68bfc2b86ecb1276d721bf71");
        
        if (memberRole) {
          const rawPassword = '123456';
          // Remove password encryption - store as plain text
          
          const user = await User.create({
            name: `${firstName} ${lastName || ''}`.trim(),
            email: email,
            password: rawPassword, // Store password without encryption
            phone: phone,
            role: memberRole._id,
            isActive: true
          });

          userId = user._id;
        }
      } catch (userErr) {
        console.log("Failed to create user for member:", userErr.message);
      }
    }

    const member = await Member.create({
      firstName,
      lastName,
      email,
      phone,
      role,
      client: clientId,
      user: userId,
      status: "active"
    });

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

    const { firstName, lastName, email, phone, role, status } = req.body || {};

    const member = await Member.findOneAndUpdate(
      { _id: id, client: clientId }, // Ensure member belongs to this client
      {
        firstName,
        lastName,
        email,
        phone,
        role,
        status
      },
      { new: true, runValidators: true }
    );

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
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

    // Validate all preconditions
    const errors = [];
    
    if (!contract) {
      errors.push("No contract found for this client");
    } else {
      if (contract.status !== "active") {
        errors.push(`Contract status must be 'active' (current: ${contract.status})`);
      }
      if (!contract.fileUrl) {
        errors.push("Contract file URL is missing");
      }
    }

    if (!client.isSecurityPaid) {
      errors.push("Security deposit has not been paid");
    }

    if (client.kycStatus !== "verified") {
      errors.push(`KYC must be verified (current: ${client.kycStatus})`);
    }

    if (!client.kycDocuments) {
      errors.push("KYC documents are missing");
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot approve onboarding. Please complete all requirements.",
        errors
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
