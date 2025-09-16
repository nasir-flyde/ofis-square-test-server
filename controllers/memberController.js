import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";

// Create a new member
export const createMember = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, companyName, role, client, status } = req.body || {};
    
    if (!firstName) {
      return res.status(400).json({ success: false, message: "firstName is required" });
    }

    // Validate client exists if provided
    if (client) {
      const clientExists = await Client.findById(client);
      if (!clientExists) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
    }

    const member = await Member.create({
      firstName,
      lastName,
      email,
      phone,
      companyName,
      role,
      client,
      status: status || "active"
    });

    return res.status(201).json({ success: true, data: member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getMembers = async (req, res) => {
  try {
    const { client, status, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (client) filter.client = client;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    
    const members = await Member.find(filter)
      .populate('client', 'companyName contactPerson email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Member.countDocuments(filter);

    return res.json({
      success: true,
      data: members,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get member by ID
export const getMemberById = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id).populate('client', 'companyName contactPerson email');
    
    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    return res.json({ success: true, data: member });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Update member
export const updateMember = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, companyName, role, client, status, user } = req.body || {};
    
    // Validate client exists if provided
    if (client) {
      const clientExists = await Client.findById(client);
      if (!clientExists) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
    }

    const member = await Member.findByIdAndUpdate(
      req.params.id,
      {
        firstName,
        lastName,
        email,
        phone,
        companyName,
        role,
        client,
        status,
        user
      },
      { new: true, runValidators: true }
    ).populate('client', 'companyName contactPerson email');

    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    return res.json({ success: true, data: member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Delete member
export const deleteMember = async (req, res) => {
  try {
    const member = await Member.findByIdAndDelete(req.params.id);
    
    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    return res.json({ success: true, message: "Member deleted successfully" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
