import Member from "../models/memberModel.js";
import Building from "../models/buildingModel.js";
import Cabin from "../models/cabinModel.js";
import Client from "../models/clientModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

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

    let createdUserId = null;

    // Create User record if email is provided
    if (email) {
      try {
        // Find or create default "member" role
        let memberRole = await Role.findOne({ roleName: "member" });
        if (!memberRole) {
          memberRole = await Role.create({
            roleName: "member",
            description: "Default member role with basic access",
            canLogin: true,
            permissions: ["member:read", "member:profile"]
          });
        }
        const defaultPassword = "123456";

        const userData = {
          name: `${firstName} ${lastName || ''}`.trim(),
          email: email,
          phone: phone || `temp_${Date.now()}`,
          password: defaultPassword,
          role: memberRole._id
        };

        const createdUser = await User.create(userData);
        createdUserId = createdUser._id;

        console.log(`Created user for member: ${email} with default password: ${defaultPassword}`);
      } catch (userErr) {
        console.warn("Failed to create user for member:", userErr.message);
        // Continue with member creation even if user creation fails
      }
    }

    const name = `${firstName} ${lastName || ''}`.trim();
    const clientId = client || null;
    const buildingId = null;
    const cabinId = null;

    const member = await Member.create({
      firstName,
      lastName,
      email,
      phone,
      companyName,
      role,
      client: clientId,
      desk: null, // Will be assigned later when desk is allocated
      status: 'active',
      user: createdUserId
    });

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'Member', member._id, null, {
      memberName: name,
      email,
      clientId,
      buildingId,
      cabinId
    });

    res.status(201).json({
      success: true,
      message: 'Member created successfully',
      data: member
    });
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
      .populate('client', 'companyName contactPerson')
      .populate('desk', 'number floor building')
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: members,
      count: members.length
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get member by ID
export const getMemberById = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id)
      .populate('client', 'companyName contactPerson')
      .populate('desk', 'number floor building')
      .populate('user', 'name email');
    
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
    const id = req.params.id;
    const updateData = req.body || {};

    const oldMember = await Member.findById(id);
    const member = await Member.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('client', 'companyName contactPerson')
      .populate('desk', 'number floor building')
      .populate('user', 'name email');

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Member', id, {
      before: oldMember?.toObject(),
      after: member.toObject(),
      fields: Object.keys(updateData)
    }, {
      memberName: member.name,
      updatedFields: Object.keys(updateData)
    });

    res.json({
      success: true,
      message: 'Member updated successfully',
      data: member
    });
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
    const id = req.params.id;
    const member = await Member.findByIdAndDelete(id);

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'DELETE', 'Member', id, null, {
      memberName: member.name,
      email: member.email
    });

    res.json({
      success: true,
      message: 'Member deleted successfully'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
