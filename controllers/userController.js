import Users from "../models/userModel.js";

// GET /api/users - Get all users with optional filters
export const getUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 20, search } = req.query;
    
    const filter = {};
    if (role) filter.role = role;
    
    // Add search functionality for name, email, or phone
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const users = await Users.find(filter)
      .populate('role', 'name permissions')
      .select('-password') // Exclude password field
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

// GET /api/users/:id - Get user by ID
export const getUserById = async (req, res) => {
  try {
    const user = await Users.findById(req.params.id)
      .populate('role', 'name permissions')
      .select('-password'); // Exclude password field
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({ success: true, data: user });
  } catch (err) {
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
