import jwt from "jsonwebtoken";
import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { createJWT } from "../middlewares/createJwt.js";
import mongoose from "mongoose";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Guest from "../models/guestModel.js";
import bcrypt from "bcryptjs";

export const clientSignup = async (req, res) => {
  try {
    const { name, email, phone, password, roleId } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: "Name and password are required" });
    }

    if (!email && !phone) {
      return res.status(400).json({ error: "Either email or phone is required" });
    }
    const query = {};
    if (email) query.email = email.toLowerCase().trim();
    if (phone) query.phone = phone.trim();

    const existingUser = await Users.findOne({
      $or: Object.keys(query).map(key => ({ [key]: query[key] }))
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists with this email or phone" });
    }
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

    const client = await Client.create({
      contactPerson: user.name,
      email: user.email || undefined,
      phone: user.phone || undefined,
      companyDetailsComplete: false,
      kycStatus: "none",
    });
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

    res.status(201).json({ message: "Client user created", user: safeUser, clientId: client._id, token });
  } catch (err) {
    console.error("clientSignup error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const adminLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      return res.status(400).json({ error: "Email or phone and password are required" });
    }
    const query = email 
      ? { email: email.toLowerCase().trim() } 
      : { phone: phone.trim() };
    const user = await Users.findOne(query);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const isMatch = user.password === password;
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const role = await Role.findById(user.role);
    if (!role) {
      return res.status(401).json({ error: "User role not found" });
    }
    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }
    if ((role.roleName || "").toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Not an admin account" });
    }
    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone
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

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error("adminLogin error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

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

export const memberLogin = async (req, res) => {
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

    // Direct password comparison without decryption (since passwords are stored as plain text for members)
    const isMatch = password === user.password;
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const role = await Role.findById(user.role);
    if (!role) return res.status(401).json({ error: "User role not found" });

    if ((role.roleName || "").toLowerCase() !== "member") {
      return res.status(403).json({ error: "Not a member account" });
    }

    let member = await Member.findOne({ user: user._id }).populate('client', 'contactPerson');
    if (!member) {
      const fallbackQuery = user.email 
        ? { email: user.email } 
        : { phone: user.phone };
      const fallbackMember = await Member.findOne(fallbackQuery).populate('client', 'contactPerson');
      
      if (!fallbackMember) {
        return res.status(404).json({ error: "Member record not found. Please contact admin." });
      }
      
      // Update member to link to user for future logins
      fallbackMember.user = user._id;
      await fallbackMember.save();
      member = fallbackMember;
    }

    if (!member.client) {
      return res.status(404).json({ error: "Member is not associated with a client. Please contact admin." });
    }

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      member.client._id.toString(),
      member._id.toString()
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

    res.json({ 
      token, 
      user: safeUser, 
      memberId: member._id,
      clientId: member.client._id 
    });
  } catch (err) {
    console.error("memberLogin error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const communityLogin = async (req, res) => {
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

    if ((role.roleName || "").toLowerCase() !== "community") {
      return res.status(403).json({ error: "Not a community account" });
    }

    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone
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

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error("communityLogin error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const onDemandUserSignup = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: "Name and password are required" });
    }

    if (!email && !phone) {
      return res.status(400).json({ error: "Either email or phone is required" });
    }

    const query = {};
    if (email) query.email = email.toLowerCase().trim();
    if (phone) query.phone = phone.trim();

    const existingUser = await Users.findOne({
      $or: Object.keys(query).map(key => ({ [key]: query[key] }))
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists with this email or phone" });
    }

    // Find or create ondemanduser role
    let role = await Role.findOne({ roleName: "ondemanduser" });
    if (!role) {
      role = await Role.create({
        roleName: "ondemanduser",
        description: "On-demand day pass user",
        canLogin: true,
        permissions: ["purchase_daypass", "manage_own_passes", "invite_visitors"]
      });
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

    // Create guest record for day pass purchases
    const guest = await Guest.create({
      name: user.name,
      email: user.email || undefined,
      phone: user.phone || undefined,
    });

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      guest._id.toString()
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

    res.status(201).json({ 
      message: "OnDemand user created successfully", 
      user: safeUser, 
      guestId: guest._id, 
      token 
    });
  } catch (err) {
    console.error("onDemandUserSignup error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const onDemandUserLogin = async (req, res) => {
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

    if ((role.roleName || "").toLowerCase() !== "ondemanduser") {
      return res.status(403).json({ error: "Not an on-demand user account" });
    }

    // Find associated guest record
    const guest = await Guest.findOne({
      $or: [
        ...(user.email ? [{ email: user.email }] : []),
        ...(user.phone ? [{ phone: user.phone }] : []),
      ],
    });

    if (!guest) {
      return res.status(404).json({ error: "Guest record not found. Please sign up again." });
    }

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      guest._id.toString()
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

    res.json({ token, user: safeUser, guestId: guest._id });
  } catch (err) {
    console.error("onDemandUserLogin error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = req.user; 
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
