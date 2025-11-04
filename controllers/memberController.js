import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";

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

<<<<<<< Updated upstream
=======
    let createdUserId = null;
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
      }
    }

    const name = `${firstName} ${lastName || ''}`.trim();
    const clientId = client || null;
    const buildingId = null;
    const cabinId = null;

>>>>>>> Stashed changes
    const member = await Member.create({
      firstName,
      lastName,
      email,
      phone,
      companyName,
      role,
<<<<<<< Updated upstream
      client,
      status: status || "active"
=======
      client: clientId,
      desk: null,
      status: 'active',
      user: createdUserId
>>>>>>> Stashed changes
    });

    return res.status(201).json({ success: true, data: member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get all members with optional filters
export const getMembers = async (req, res) => {
  try {
    const { client, status, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (client) filter.client = client;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    
    const members = await Member.find(filter)
      .populate('client', 'name email')
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

export const getMemberById = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id).populate('client', 'name email');
    
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
    ).populate('client', 'name email');

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
