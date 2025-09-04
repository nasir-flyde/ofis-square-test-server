import jwt from "jsonwebtoken";
import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { createJWT } from "../middlewares/createJwt.js";
import mongoose from "mongoose";
import Client from "../models/clientModel.js";

// Client signup: creates both User (role: client) and Client, returns token with clientId
export const clientSignup = async (req, res) => {
  try {
    const { name, email, phone, password, roleId } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: "Name and password are required" });
    }

    if (!email && !phone) {
      return res.status(400).json({ error: "Either email or phone is required" });
    }

    // Check for existing user by email or phone
    const query = {};
    if (email) query.email = email.toLowerCase().trim();
    if (phone) query.phone = phone.trim();

    const existingUser = await Users.findOne({
      $or: Object.keys(query).map(key => ({ [key]: query[key] }))
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists with this email or phone" });
    }

    // Find role by MongoDB _id or default by roleName 'client'
    let role;
    if (roleId) {
      if (!mongoose.Types.ObjectId.isValid(roleId)) {
        return res.status(400).json({ error: "Invalid roleId" });
      }
      role = await Role.findById(roleId);
      if (!role) return res.status(400).json({ error: "Role not found" });
    } else {
      role = await Role.findOne({ roleName: "client" });
      if (!role) return res.status(400).json({ error: "Default role 'client' not found. Please specify roleId." });
    }

    const userPayload = {
      name: name.trim(),
      password: password,
      role: role._id,
    };

    if (email) userPayload.email = email.toLowerCase().trim();
    if (phone) userPayload.phone = phone.trim();

    const user = new Users(userPayload);
    await user.save();

    // Create Client record at signup time only
    const client = await Client.create({
      contactPerson: user.name,
      email: user.email || undefined,
      phone: user.phone || undefined,
      companyDetailsComplete: false,
      kycStatus: "none",
    });

    // Create JWT token
    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      client._id.toString()
    );

    // Return sanitized user
    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role.roleName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.status(201).json({ message: "Client user created", user: safeUser, clientId: client._id, token });
  } catch (err) {
    console.error("clientSignup error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Admin/staff login (same behavior as previous login)
export const adminLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      return res.status(400).json({ error: "Email or phone and password are required" });
    }

    // Find user by email or phone
    const query = email 
      ? { email: email.toLowerCase().trim() } 
      : { phone: phone.trim() };

    const user = await Users.findOne(query);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verify password (plain text as requested)
    const isMatch = user.password === password;
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Get role and check login permission
    const role = await Role.findById(user.role);
    if (!role) {
      return res.status(401).json({ error: "User role not found" });
    }

    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    // Create JWT token with roleName
    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone
    );

    // Return sanitized user
    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role.roleName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error("adminLogin error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Client login: requires role 'client' and existing Client record; includes clientId in JWT
export const clientLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      return res.status(400).json({ error: "Email or phone and password are required" });
    }

    const query = email 
      ? { email: email.toLowerCase().trim() } 
      : { phone: phone.trim() };

    const user = await Users.findOne(query);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = user.password === password;
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const role = await Role.findById(user.role);
    if (!role) return res.status(401).json({ error: "User role not found" });

    if ((role.roleName || "").toLowerCase() !== "client") {
      return res.status(403).json({ error: "Not a client account" });
    }

    // Client must already exist (created at signup)
    const client = await Client.findOne({
      $or: [
        ...(user.email ? [{ email: user.email }] : []),
        ...(user.phone ? [{ phone: user.phone }] : []),
      ],
    });
    if (!client) {
      return res.status(404).json({ error: "Client record not found. Please sign up first." });
    }

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      client._id.toString()
    );

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role.roleName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json({ token, user: safeUser, clientId: client._id });
  } catch (err) {
    console.error("clientLogin error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get current user profile
export const getMe = async (req, res) => {
  try {
    const user = req.user; // Set by auth middleware
    const role = await Role.findById(user.role);

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role?.roleName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json({ user: safeUser });
  } catch (err) {
    console.error("getMe error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
