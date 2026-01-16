import Lead from "../models/leadModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Guest from "../models/guestModel.js";
import bcrypt from "bcryptjs";
import { logActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import { createContact } from "../utils/zohoBooks.js";
import mongoose from "mongoose";

// Helper to safely extract Zoho contact_id from different response shapes
const extractZohoContactId = (resp) => {
  try {
    return (
      resp?.contact?.contact_id ||
      resp?.data?.contact?.contact_id ||
      resp?.data?.contact_id ||
      resp?.contact_id ||
      null
    );
  } catch {
    return null;
  }
};

// Create a new lead from signup form
export const createLead = async (req, res) => {
  try {
    const { firstName, lastName, companyName, address, pincode, email, phone, numberOfEmployees, purpose } = req.body;
    let guestIdLocal = null;

    // Check if lead already exists with same email or phone
    const existingLead = await Lead.findOne({
      $or: [
        { email: email.toLowerCase() },
        { phone: phone.replace(/\D/g, '') }
      ]
    });

    if (existingLead) {
      return res.status(400).json({
        message: "A lead with this email or phone number already exists",
        leadId: existingLead._id
      });
    }

    // Create new lead
    const leadData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      companyName: companyName.trim(),
      address: address.trim(),
      pincode: pincode.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.replace(/\D/g, ''),
      numberOfEmployees: parseInt(numberOfEmployees),
      purpose: purpose.trim(),
      status: 'new',
      source: 'website_signup'
    };

    // Handle KYC documents for day pass users (upload to ImageKit)
    if (purpose === 'day_pass' && req.files && req.files.length > 0) {
      try {
        const uploadedUrls = [];
        
        for (const file of req.files) {
          const uploadResult = await imagekit.upload({
            file: file.buffer.toString('base64'),
            fileName: `kyc-${Date.now()}-${file.originalname}`,
            folder: '/kyc-documents'
          });
          uploadedUrls.push(uploadResult.url);
        }
        
        leadData.kycDocuments = {
          files: uploadedUrls
        };
        leadData.kycStatus = 'pending';
      } catch (uploadError) {
        console.error('KYC document upload error:', uploadError);
        return res.status(500).json({
          message: "Failed to upload KYC documents",
          error: uploadError.message
        });
      }
    }

    // Auto-onboard (create ondemand user, Guest, and Zoho contact) at signup for day_pass leads
    if (purpose === 'day_pass') {
      try {
        // Ensure ondemand user exists
        const ondemandRole = await Role.findOne({ roleName: 'ondemanduser' });
        let userDoc = await User.findOne({ email: leadData.email });
        let defaultPassword = '123456';
        if (!userDoc && ondemandRole) {
          userDoc = await User.create({
            name: `${leadData.firstName} ${leadData.lastName}`.trim(),
            email: leadData.email,
            phone: leadData.phone,
            password: defaultPassword,
            role: ondemandRole._id,
          });
        }

        // Ensure Guest exists
        let guestDoc = await Guest.findOne({ email: leadData.email });
        if (!guestDoc) {
          guestDoc = await Guest.create({
            name: `${leadData.firstName} ${leadData.lastName}`.trim(),
            email: leadData.email,
            phone: leadData.phone,
            companyName: leadData.companyName,
            notes: 'Auto-created from website signup (day_pass)',
            ...(leadData.kycDocuments ? { kycDocuments: leadData.kycDocuments } : {}),
            ...(leadData.kycStatus ? { kycStatus: leadData.kycStatus } : {}),
          });
        }
        guestIdLocal = guestDoc?._id;

        // Ensure Zoho contact exists and persist on guest + lead
        if (!guestDoc.zohoBooksContactId) {
          try {
            const zohoPayload = {
              contact_name: `${leadData.firstName} ${leadData.lastName}`.trim(),
              company_name: leadData.companyName,
              contact_type: 'customer',
              customer_sub_type: 'individual',
              notes: 'Day pass user - Auto-created from website signup',
              billing_address: {
                address: leadData.address,
                zip: leadData.pincode,
              },
              contact_persons: [
                {
                  first_name: leadData.firstName,
                  last_name: leadData.lastName,
                  email: leadData.email,
                  phone: leadData.phone,
                  mobile: leadData.phone,
                  is_primary_contact: true,
                },
              ],
            };
            const zohoResp = await createContact(zohoPayload);
            const contactId = extractZohoContactId(zohoResp);
            if (contactId) {
              guestDoc.zohoBooksContactId = contactId;
              await guestDoc.save();
              leadData.zohoBooksContactId = contactId;
            }
          } catch (zErr) {
            // Non-blocking
            console.warn('Zoho contact creation at signup failed:', zErr?.message || zErr);
          }
        } else {
          leadData.zohoBooksContactId = guestDoc.zohoBooksContactId;
        }

        if (userDoc) {
          leadData.userCreated = true;
          leadData.createdUserId = userDoc._id;
        }

        if (guestIdLocal) {
          leadData.guestId = guestIdLocal;
        }
      } catch (onboardErr) {
        console.warn('On-demand auto-onboarding failed at signup:', onboardErr?.message || onboardErr);
      }
    }

    const lead = new Lead(leadData);
    await lead.save();

    // Log activity
    await logActivity({
      action: 'CREATE',
      entity: 'lead',
      entityId: lead._id,
      description: `New lead created from website signup: ${lead.fullName} (${lead.email})`,
      source: 'website_signup',
      metadata: {
        leadData: {
          name: lead.fullName,
          email: lead.email,
          company: lead.companyName
        }
      }
    });

    res.status(201).json({
      message: purpose === 'day_pass' 
        ? "Lead created successfully. KYC documents submitted for review."
        : "Lead created successfully",
      lead: {
        id: lead._id,
        fullName: lead.fullName,
        email: lead.email,
        companyName: lead.companyName,
        status: lead.status,
        kycStatus: lead.kycStatus
      },
      ...(guestIdLocal ? { guestId: guestIdLocal } : {})
    });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({
      message: "Failed to create lead",
      error: error.message
    });
  }
};

// Get all leads with filtering and pagination
export const getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};
    
    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (page - 1) * limit;

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate('assignedTo', 'name email')
        .populate('convertedToClient', 'companyName email')
        .populate('kycApprovedBy', 'name email')
        .populate('createdUserId', 'name email role')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Lead.countDocuments(filter)
    ]);

    res.json({
      leads,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + leads.length < total
      }
    });
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({
      message: "Failed to fetch leads",
      error: error.message
    });
  }
};

// Get lead by ID
export const getLeadById = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead id" });
    }
    const lead = await Lead.findById(id)
      .populate('assignedTo', 'name email')
      .populate('convertedToClient', 'companyName email');

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.json({ lead });
  } catch (error) {
    console.error("Error fetching lead:", error);
    res.status(500).json({
      message: "Failed to fetch lead",
      error: error.message
    });
  }
};

// Update lead
export const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead id" });
    }
    const updates = req.body;

    // Remove fields that shouldn't be updated directly
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;

    const lead = await Lead.findByIdAndUpdate(
      id,
      { ...updates, lastContactedAt: new Date() },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'name email')
     .populate('convertedToClient', 'companyName email');

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    // Log activity
    await logActivity({
      action: 'UPDATE',
      entity: 'lead',
      entityId: lead._id,
      description: `Lead updated: ${lead.fullName}`,
      userId: req.user?.id,
      metadata: { updates }
    });

    res.json({
      message: "Lead updated successfully",
      lead
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({
      message: "Failed to update lead",
      error: error.message
    });
  }
};

// Delete lead
export const deleteLead = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead id" });
    }
    const lead = await Lead.findByIdAndDelete(id);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    // Log activity
    await logActivity({
      action: 'DELETE',
      entity: 'lead',
      entityId: lead._id,
      description: `Lead deleted: ${lead.fullName}`,
      userId: req.user?.id
    });

    res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({
      message: "Failed to delete lead",
      error: error.message
    });
  }
};

// Get lead statistics
export const getLeadStats = async (req, res) => {
  try {
    const stats = await Lead.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Lead.countDocuments();
    const thisMonth = await Lead.countDocuments({
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    });

    const statusStats = {};
    stats.forEach(stat => {
      statusStats[stat._id] = stat.count;
    });

    res.json({
      total,
      thisMonth,
      byStatus: statusStats
    });
  } catch (error) {
    console.error("Error fetching lead stats:", error);
    res.status(500).json({
      message: "Failed to fetch lead statistics",
      error: error.message
    });
  }
};

// Approve KYC and create user for day pass
export const approveKYC = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead id" });
    }
    const userId = req.user?.id;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (lead.purpose !== 'day_pass') {
      return res.status(400).json({ message: "KYC approval is only for day pass leads" });
    }

    if (lead.kycStatus === 'approved') {
      return res.status(400).json({ message: "KYC already approved" });
    }

    // If user already exists (created at signup), reuse; otherwise create now
    let existingUser = await User.findOne({ email: lead.email });
    let newUser = existingUser || null;

    // Find the ondemand role (only needed if user not found)
    const ondemandRole = !newUser ? await Role.findOne({ roleName: 'ondemanduser' }) : null;
    if (!newUser && !ondemandRole) {
      return res.status(500).json({ message: "Ondemand role not found in system", error: "Please create 'ondemanduser' role first" });
    }

    // Create user only if missing (legacy fallback)
    if (!newUser) {
      const defaultPassword = '123456';
      newUser = await User.create({
        name: `${lead.firstName} ${lead.lastName}`,
        email: lead.email,
        phone: lead.phone,
        password: defaultPassword,
        role: ondemandRole._id
      });
    }

    // Ensure guest exists (legacy fallback)
    let newGuest = await Guest.findOne({ email: lead.email });
    if (!newGuest) {
      newGuest = await Guest.create({
        name: `${lead.firstName} ${lead.lastName}`,
        email: lead.email,
        phone: lead.phone,
        companyName: lead.companyName,
        notes: `Auto-created from day pass lead approval`
      });
    }

    // Ensure Zoho contact exists (only if missing)
    if (!lead.zohoBooksContactId) {
      try {
        if (!newGuest.zohoBooksContactId) {
          const zohoPayload = {
            contact_name: `${lead.firstName} ${lead.lastName}`,
            company_name: lead.companyName,
            contact_type: 'customer',
            customer_sub_type: 'individual',
            notes: `Day pass user - Auto-created from KYC approval`,
            billing_address: { address: lead.address, zip: lead.pincode },
            contact_persons: [{
              first_name: lead.firstName, last_name: lead.lastName,
              email: lead.email, phone: lead.phone, mobile: lead.phone,
              is_primary_contact: true
            }]
          };
          const zohoResponse = await createContact(zohoPayload);
          const contactId = extractZohoContactId(zohoResponse);
          if (contactId) {
            newGuest.zohoBooksContactId = contactId;
            await newGuest.save();
            lead.zohoBooksContactId = contactId;
          }
        } else {
          lead.zohoBooksContactId = newGuest.zohoBooksContactId;
        }
      } catch (zohoError) {
        console.error('Error ensuring Zoho contact on approval:', zohoError);
      }
    }

    // Update lead
    lead.kycStatus = 'approved';
    lead.kycApprovedBy = userId;
    lead.kycApprovedAt = new Date();
    lead.userCreated = true;
    lead.createdUserId = newUser._id;
    await lead.save();

    // Also reflect KYC approval in Guest record and sync documents
    try {
      let guest = await Guest.findOne({ email: lead.email });
      if (!guest) {
        guest = await Guest.create({
          name: `${lead.firstName} ${lead.lastName}`,
          email: lead.email,
          phone: lead.phone,
          companyName: lead.companyName,
          notes: `Auto-created from KYC approval`,
          ...(lead.kycDocuments ? { kycDocuments: lead.kycDocuments } : {}),
          kycStatus: 'approved',
        });
      } else {
        guest.kycStatus = 'approved';
        if (lead.kycDocuments?.files?.length) {
          const existingFiles = guest.kycDocuments?.files || [];
          const merged = Array.from(new Set([...existingFiles, ...lead.kycDocuments.files]));
          guest.kycDocuments = { files: merged };
        }
        await guest.save();
      }
    } catch (e) {
      console.warn('Failed to sync Guest KYC on approval:', e?.message || e);
    }

    // Log activity
    await logActivity({
      action: 'UPDATE',
      entity: 'lead_kyc',
      entityId: lead._id,
      description: `KYC approved for ${lead.fullName}. User created with ondemand role.`,
      userId: userId,
      metadata: {
        leadEmail: lead.email,
        createdUserId: newUser._id
      }
    });

    res.json({
      message: "KYC approved and user created successfully",
      lead: {
        id: lead._id,
        fullName: lead.fullName,
        email: lead.email,
        kycStatus: lead.kycStatus,
        zohoBooksContactId: lead.zohoBooksContactId || null
      },
      user: {
        id: newUser._id,
        email: newUser.email,
        role: newUser.role,
        // defaultPassword only relevant when user was created just now
      }
    });
  } catch (error) {
    console.error("Error approving KYC:", error);
    res.status(500).json({
      message: "Failed to approve KYC",
      error: error.message
    });
  }
};

// Reject KYC
export const rejectKYC = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead id" });
    }
    const { reason } = req.body;
    const userId = req.user?.id;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (lead.purpose !== 'day_pass') {
      return res.status(400).json({ message: "KYC rejection is only for day pass leads" });
    }

    // Update lead
    lead.kycStatus = 'rejected';
    lead.kycRejectionReason = reason.trim();
    await lead.save();

    // Log activity
    await logActivity({
      action: 'REJECT',
      entity: 'lead_kyc',
      entityId: lead._id,
      description: `KYC rejected for ${lead.fullName}. Reason: ${reason}`,
      userId: userId,
      metadata: {
        leadEmail: lead.email,
        rejectionReason: reason
      }
    });

    res.json({
      message: "KYC rejected successfully",
      lead: {
        id: lead._id,
        fullName: lead.fullName,
        email: lead.email,
        kycStatus: lead.kycStatus,
        kycRejectionReason: lead.kycRejectionReason
      }
    });
  } catch (error) {
    console.error("Error rejecting KYC:", error);
    res.status(500).json({
      message: "Failed to reject KYC",
      error: error.message
    });
  }
};

// Get leads with pending KYC
export const getPendingKYCLeads = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const filter = {
      purpose: 'day_pass',
      kycStatus: 'pending'
    };

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Lead.countDocuments(filter)
    ]);

    res.json({
      leads,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + leads.length < total
      }
    });
  } catch (error) {
    console.error("Error fetching pending KYC leads:", error);
    res.status(500).json({
      message: "Failed to fetch pending KYC leads",
      error: error.message
    });
  }
};

// Upload KYC documents by admin/community
export const uploadKYCByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead id" });
    }
    const userId = req.user?.id;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (lead.purpose !== 'day_pass') {
      return res.status(400).json({ message: "KYC upload is only for day pass leads" });
    }

    // Upload files to ImageKit
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "Please upload at least one document" });
    }

    try {
      const uploadedUrls = [];
      
      for (const file of req.files) {
        const uploadResult = await imagekit.upload({
          file: file.buffer.toString('base64'),
          fileName: `kyc-admin-${Date.now()}-${file.originalname}`,
          folder: '/kyc-documents'
        });
        uploadedUrls.push(uploadResult.url);
      }
      
      // Update or create kycDocuments
      if (!lead.kycDocuments) {
        lead.kycDocuments = { files: [] };
      }
      
      // Append new files to existing ones
      lead.kycDocuments.files = [...(lead.kycDocuments.files || []), ...uploadedUrls];
      
      // Auto-approve when admin uploads
      lead.kycStatus = 'approved';
      lead.kycApprovedBy = userId;
      lead.kycApprovedAt = new Date();
      
      await lead.save();

      // Sync uploaded KYC documents and approval to Guest as well
      try {
        let guest = await Guest.findOne({ email: lead.email });
        if (!guest) {
          guest = await Guest.create({
            name: `${lead.firstName} ${lead.lastName}`,
            email: lead.email,
            phone: lead.phone,
            companyName: lead.companyName,
            notes: `Auto-created from admin KYC upload`,
            kycDocuments: { files: uploadedUrls },
            kycStatus: 'approved',
          });
        } else {
          const existingFiles = guest.kycDocuments?.files || [];
          const merged = Array.from(new Set([...existingFiles, ...uploadedUrls]));
          guest.kycDocuments = { files: merged };
          guest.kycStatus = 'approved';
          await guest.save();
        }
      } catch (e) {
        console.warn('Failed to sync Guest KYC on admin upload:', e?.message || e);
      }

      // Auto-create user account
      const existingUser = await User.findOne({ email: lead.email });
      if (!existingUser) {
        // Ensure guest record exists (reuse if already created above) and contains KYC info
        let newGuest = await Guest.findOne({ email: lead.email });
        if (!newGuest) {
          newGuest = new Guest({
            name: `${lead.firstName} ${lead.lastName}`,
            email: lead.email,
            phone: lead.phone,
            companyName: lead.companyName,
            notes: `Auto-created from admin KYC upload`,
            kycDocuments: { files: uploadedUrls },
            kycStatus: 'approved',
          });
          await newGuest.save();
        }

        // Find the ondemand role
        const ondemandRole = await Role.findOne({ roleName: 'ondemanduser' });
        if (!ondemandRole) {
          return res.status(500).json({
            message: "Ondemand role not found in system",
            error: "Please create 'ondemanduser' role first"
          });
        }

        const defaultPassword = '123456';

        const newUser = new User({
          name: `${lead.firstName} ${lead.lastName}`,
          email: lead.email,
          phone: lead.phone,
          password: defaultPassword,
          role: ondemandRole._id
        });

        await newUser.save();

        // Create Zoho Books contact
        try {
          const zohoPayload = {
            contact_name: `${lead.firstName} ${lead.lastName}`,
            company_name: lead.companyName,
            contact_type: 'customer',
            customer_sub_type: 'individual',
            notes: `Day pass user - Auto-created from admin KYC upload`,
            billing_address: {
              address: lead.address,
              zip: lead.pincode
            },
            contact_persons: [
              {
                first_name: lead.firstName,
                last_name: lead.lastName,
                email: lead.email,
                phone: lead.phone,
                mobile: lead.phone,
                is_primary_contact: true
              }
            ]
          };

          const zohoResponse = await createContact(zohoPayload);
          const contactId = extractZohoContactId(zohoResponse);
          if (contactId) {
            lead.zohoBooksContactId = contactId;
            console.log(`Zoho contact created for lead ${lead._id}: ${contactId}`);
            // Also persist on the newly created Guest
            try {
              if (typeof newGuest !== 'undefined' && newGuest && !newGuest.zohoBooksContactId) {
                newGuest.zohoBooksContactId = contactId;
                await newGuest.save();
              }
            } catch (_) {}
          }
        } catch (zohoError) {
          console.error('Error creating Zoho contact:', zohoError);
          // Don't fail the upload if Zoho sync fails
        }
        
        lead.userCreated = true;
        lead.createdUserId = newUser._id;
        await lead.save();
      }

      // Log activity
      await logActivity({
        action: 'UPDATE',
        entity: 'lead_kyc',
        entityId: lead._id,
        description: `Admin uploaded and auto-approved KYC documents for ${lead.fullName}. User account created.`,
        userId: userId,
        metadata: {
          leadEmail: lead.email,
          filesCount: uploadedUrls.length,
          userCreated: lead.userCreated,
          createdUserId: lead.createdUserId
        }
      });

      res.json({
        message: "KYC documents uploaded and approved successfully. User account created.",
        lead: {
          id: lead._id,
          fullName: lead.fullName,
          email: lead.email,
          kycStatus: lead.kycStatus,
          kycDocuments: lead.kycDocuments,
          userCreated: lead.userCreated,
          zohoBooksContactId: lead.zohoBooksContactId || null
        },
        user: lead.userCreated ? {
          id: lead.createdUserId,
          email: lead.email,
          role: 'ondemand',
          defaultPassword: '123456'
        } : null
      });
    } catch (uploadError) {
      console.error('KYC document upload error:', uploadError);
      return res.status(500).json({
        message: "Failed to upload KYC documents",
        error: uploadError.message
      });
    }
  } catch (error) {
    console.error("Error uploading KYC by admin:", error);
    res.status(500).json({
      message: "Failed to upload KYC documents",
      error: error.message
    });
  }
};

// Search Guests for community/ops selection
export const searchGuests = async (req, res) => {
  try {
    const { search = '', limit = 10 } = req.query;
    const q = String(search || '').trim();
    const where = q
      ? {
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
            { phone: { $regex: q, $options: 'i' } },
          ],
        }
      : {};
    const guests = await Guest.find(where)
      .select('name email phone zohoBooksContactId')
      .limit(parseInt(limit));
    return res.json({ success: true, data: { guests } });
  } catch (error) {
    console.error('searchGuests error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
