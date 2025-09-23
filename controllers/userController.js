import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Building from "../models/buildingModel.js";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

// GET /api/users - Get all users with optional filters
export const getUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 20, search } = req.query;
    
    const filter = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const users = await Users.find(filter)
      .populate('role', 'roleName permissions')
      .populate('buildingId', 'name address')
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Users.countDocuments(filter);

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

export const getUserById = async (req, res) => {
  try {
    const user = await Users.findById(req.params.id)
      .populate('role', 'roleName permissions')
      .populate('buildingId', 'name address')
      .select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, buildingId } = req.body;

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
    const existingUser = await Users.findOne({
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
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password: hashedPassword,
      role
    };

    // Add buildingId for community users
    if (roleDoc.roleName === "community" && buildingId) {
      userData.buildingId = buildingId;
    }

    const newUser = new Users(userData);
    const savedUser = await newUser.save();
    
    // Populate role and building, exclude password
    const populatedUser = await Users.findById(savedUser._id)
      .populate('role', 'roleName permissions')
      .populate('buildingId', 'name address')
      .select('-password');

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: populatedUser
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
    const userId = req.params.id;

    // Check if user exists
    const existingUser = await Users.findById(userId);
    if (!existingUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Check for duplicate email/phone (excluding current user)
    if (email || phone) {
      const duplicateQuery = {
        _id: { $ne: userId },
        $or: []
      };
      
      if (email) duplicateQuery.$or.push({ email: email.toLowerCase().trim() });
      if (phone) duplicateQuery.$or.push({ phone: phone.trim() });
      
      if (duplicateQuery.$or.length > 0) {
        const duplicate = await Users.findOne(duplicateQuery);
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
    const updatedUser = await Users.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).populate('role', 'roleName permissions').populate('buildingId', 'name address').select('-password');

    return res.json({
      success: true,
      message: "User updated successfully",
      data: updatedUser
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
    const user = await Users.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await Users.findByIdAndDelete(req.params.id);

    return res.json({ 
      success: true, 
      message: "User deleted successfully",
      deletedUserId: req.params.id 
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
export const getStaffUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    // Find the Role document for 'community' (staff users are now community users)
    const communityRole = await Role.findOne({ roleName: 'community' }).select('_id');
    if (!communityRole) {
      return res.status(404).json({ success: false, message: "Role 'community' not found" });
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

    const users = await Users.find(filter)
      .populate('role', 'roleName permissions')
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit);

    const total = await Users.countDocuments(filter);

    return res.json({
      success: true,
      data: users,
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