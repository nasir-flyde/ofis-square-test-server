import Lead from "../models/leadModel.js";
import { logActivity } from "../utils/activityLogger.js";

// Create a new lead from signup form
export const createLead = async (req, res) => {
  try {
    const { firstName, lastName, companyName, address, pincode, email, phone } = req.body;

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
      status: 'new',
      source: 'website_signup'
    };

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
      message: "Lead created successfully",
      lead: {
        id: lead._id,
        fullName: lead.fullName,
        email: lead.email,
        companyName: lead.companyName,
        status: lead.status
      }
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
    const lead = await Lead.findById(req.params.id)
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
    const lead = await Lead.findByIdAndDelete(req.params.id);

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
