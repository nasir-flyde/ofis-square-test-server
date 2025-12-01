import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Building from "../models/buildingModel.js";
import bcrypt from "bcryptjs";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import mongoose from "mongoose";

export const getUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 20, search, excludeMember } = req.query;
    
    const filter = {};
    
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    if (excludeMember === 'true' && !role) {
      try {
        const memberRole = await Role.findOne({ roleName: 'member' }).select('_id');
        if (memberRole?._id) {
          filter.role = { $ne: memberRole._id };
        }
      } catch (e) {
      }
    }

    const skip = (page - 1) * limit;
    const users = await User.find(filter)
      .populate('role', 'roleName permissions')
      .populate('buildingId', 'name address')
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    // Manual logging removed - handled by middleware for non-GET requests only

    return res.json({
      success: true,
      data: users,
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

// POST /api/users/client-legal - Create a client-scoped Legal Team user
export const createClientLegalUser = async (req, res) => {
  try {
    const { clientId, name, email, phone, password } = req.body;

    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ success: false, message: "Valid clientId is required" });
    }
    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({ success: false, message: "name, password and either email or phone are required" });
    }

    // Ensure role exists or create it
    let role = await Role.findOne({ roleName: "Client Legal Team" });
    if (!role) {
      role = await Role.create({
        roleName: "Client Legal Team",
        description: "Client-side legal user with contract feedback access",
        canLogin: true,
        permissions: []
      });
    }

    // Check duplicates
    const duplicate = await User.findOne({
      $or: [
        ...(email ? [{ email: email.toLowerCase().trim() }] : []),
        ...(phone ? [{ phone: phone.trim() }] : []),
      ]
    });
    if (duplicate) {
      return res.status(400).json({ success: false, message: "User with this email or phone already exists" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = await User.create({
      name: name.trim(),
      email: email ? email.toLowerCase().trim() : undefined,
      phone: phone ? phone.trim() : undefined,
      password: hashedPassword,
      role: role._id,
      clientId,
    });

    await logCRUDActivity(req, 'CREATE', 'User', user._id, null, {
      userName: user.name,
      email: user.email,
      roleId: role._id,
      clientId
    });

    const safe = user.toObject();
    delete safe.password;
    return res.status(201).json({ success: true, message: 'Client Legal Team user created', data: safe });
  } catch (err) {
    console.error('createClientLegalUser error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('role', 'roleName permissions')
      .populate('buildingId', 'name address')
      .select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Manual logging removed - handled by middleware for non-GET requests only

    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, buildingId, isActive } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !password || !role) {
      return res.status(400).json({ 
        success: false, 
        message: "All fields are required" 
      });
    }

    // Get role information to check if it's a community user
    const roleDoc = await Role.findById(role);
    if (!roleDoc) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid role" 
      });
    }

    // If it's a community user, buildingId is required
    if (roleDoc.roleName === "community") {
      if (!buildingId) {
        return res.status(400).json({ 
          success: false, 
          message: "Building ID is required for community users" 
        });
      }

      // Validate building exists
      if (!mongoose.Types.ObjectId.isValid(buildingId)) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid building ID" 
        });
      }

      const building = await Building.findById(buildingId);
      if (!building) {
        return res.status(400).json({ 
          success: false, 
          message: "Building not found" 
        });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: "User with this email or phone already exists" 
      });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create new user
    const user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role: role,
      isActive: isActive !== undefined ? isActive : true
    });

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'User', user._id, null, {
      userName: name,
      email,
      roleId: role
    });

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: userResponse
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: "User with this email or phone already exists" 
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/users/:id - Update user
export const updateUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, buildingId } = req.body;
    const id = req.params.id;

    // Check if user exists
    const existingUser = await User.findById(id);
    if (!existingUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Check for duplicate email/phone (excluding current user)
    if (email || phone) {
      const duplicateQuery = {
        _id: { $ne: id },
        $or: []
      };
      
      if (email) duplicateQuery.$or.push({ email: email.toLowerCase().trim() });
      if (phone) duplicateQuery.$or.push({ phone: phone.trim() });
      
      if (duplicateQuery.$or.length > 0) {
        const duplicate = await User.findOne(duplicateQuery);
        if (duplicate) {
          return res.status(400).json({ 
            success: false, 
            message: "User with this email or phone already exists" 
          });
        }
      }
    }

    // Validate buildingId for community users if role is being updated
    if (role) {
      const roleDoc = await Role.findById(role);
      if (roleDoc && roleDoc.roleName === "community") {
        if (!buildingId) {
          return res.status(400).json({ 
            success: false, 
            message: "Building ID is required for community users" 
          });
        }

        if (!mongoose.Types.ObjectId.isValid(buildingId)) {
          return res.status(400).json({ 
            success: false, 
            message: "Invalid building ID" 
          });
        }

        const building = await Building.findById(buildingId);
        if (!building) {
          return res.status(400).json({ 
            success: false, 
            message: "Building not found" 
          });
        }
      }
    }

    // Prepare update data
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (email) updateData.email = email.toLowerCase().trim();
    if (phone) updateData.phone = phone.trim();
    if (role) updateData.role = role;
    if (buildingId) updateData.buildingId = buildingId;

    // Hash password if provided
    if (password && password.trim()) {
      const saltRounds = 10;
      updateData.password = await bcrypt.hash(password.trim(), saltRounds);
    }

    // Update user
    const oldUser = await User.findById(id);
    const user = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('role', 'roleName description')
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'User', id, {
      before: oldUser ? { ...oldUser.toObject(), password: '[HIDDEN]' } : null,
      after: { ...user.toObject(), password: '[HIDDEN]' },
      fields: Object.keys(updateData)
    }, {
      userName: user.name,
      updatedFields: Object.keys(updateData)
    });

    return res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: "User with this email or phone already exists" 
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/users/:id - Delete user
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'DELETE', 'User', user._id, null, {
      userName: user.name,
      email: user.email
    });

    return res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getStaffUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    // Find the Role document for 'community' (staff users are now community users)
    const communityRole = await Role.findOne({ roleName: 'staff' }).select('_id');
    if (!communityRole) {
      return res.status(404).json({ success: false, message: "Role 'staff' not found" });
    }

    const filter = { role: communityRole._id };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const parsedLimit = parseInt(limit);
    const parsedPage = parseInt(page);
    const skip = (parsedPage - 1) * parsedLimit;

    const users = await User.find(filter)
      .populate('role', 'roleName description')
      .select('-password')
      .sort({ createdAt: -1 });
    const total = await User.countDocuments(filter);

    return res.json({
      success: true,
      data: users,
      count: users.length,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getInternalUsers = async (req, res) => {
  try {
    // Fetch roles: legal_team, finance_junior, finance_senior, system_admin
    const internalRoles = await Role.find({
      roleName: { $in: ['Legal Team', 'Finance Junior', 'Finance Senior', 'System Admin'] }
    }).select('_id roleName');

    if (!internalRoles || internalRoles.length === 0) {
      return res.json({
        success: true,
        users: []
      });
    }

    const roleIds = internalRoles.map(r => r._id);

    // Fetch users with these roles
    const users = await User.find({ role: { $in: roleIds } })
      .populate('role', 'roleName')
      .select('_id name email role')
      .sort({ name: 1 });

    return res.json({
      success: true,
      users: users.map(u => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role?.roleName || 'Unknown'
      }))
    });
  } catch (err) {
    console.error('getInternalUsers error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};