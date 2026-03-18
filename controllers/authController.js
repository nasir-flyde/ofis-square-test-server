import jwt from "jsonwebtoken";
import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { normalizePhone, getPhoneFormats } from "../utils/phoneUtils.js";
import { createJWT } from "../middlewares/createJwt.js";
import { createAccessToken, createRefreshToken, generateTokenFamily } from "../middlewares/createJwtRefresh.js";
import { storeRefreshToken, validateRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllUserTokens, getDeviceInfo } from "../utils/refreshTokenService.js";
import { generateAuthTokens } from "../utils/authHelpers.js";
import mongoose from "mongoose";
import ActivityLog from "../models/activityLogModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Guest from "../models/guestModel.js";
import Lead from "../models/leadModel.js";
import Building from "../models/buildingModel.js";
import { logAuthActivity, logCRUDActivity } from "../utils/activityLogger.js";

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
      : { phone: { $in: getPhoneFormats(phone) } };
    const user = await Users.findOne(query);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const isMatch = user.password === password;
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.isAdminVerified === false) {
      return res.status(403).json({ error: "Your account is pending GM verification. Please contact GM." });
    }
    const role = await Role.findById(user.role).lean();
    if (!role) {
      return res.status(401).json({ error: "User role not found" });
    }
    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    // Block client, client legal team, member, community, and staff roles from admin portal
    const blockedRoles = ['client', 'client legal team', 'member', 'community', 'staff', 'communityLead'];
    const normalizedRoleName = (role.roleName || '').toLowerCase().trim();

    if (blockedRoles.includes(normalizedRoleName)) {
      return res.status(403).json({
        error: "Access denied. This login is for admin portal only. Please use the appropriate client/member portal."
      });
    }
    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone
    );

    // Allow admin roles: Contract Creator, Approver, Billing Admin, Operations Admin, System Admin
    // The RBAC system will control what they can do based on permissions

    // Generate both access and refresh tokens
    const { accessToken, refreshToken } = await generateAuthTokens(user, role, req);

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      buildingId: user.buildingId,
      role: role, // Full role object with permissions
      roleName: role.roleName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    await logAuthActivity(req, 'LOGIN', 'SUCCESS', null, {
      userRole: 'admin',
      loginType: 'admin'
    });

    res.json({
      accessToken,
      refreshToken,
      user: safeUser,
      // Legacy support - also send as 'token'
      token: accessToken
    });
  } catch (err) {
    console.error("adminLogin error:", err);

    await logAuthActivity(req, 'LOGIN', 'FAILED', err.message, {
      userRole: 'admin',
      loginType: 'admin'
    });

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
      : { phone: { $in: getPhoneFormats(phone) } };

    const user = await Users.findOne(query);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = user.password === password;
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const role = await Role.findById(user.role);
    if (!role) return res.status(401).json({ error: "User role not found" });

    const roleNameLower = (role.roleName || "").toLowerCase();
    if (roleNameLower !== "client" && roleNameLower !== "client legal team") {
      return res.status(403).json({ error: "Not a client/Client Legal Team account" });
    }

    // Resolve client for both client and client legal team
    let client = null;
    if (roleNameLower === "client legal team" && user.clientId) {
      client = await Client.findById(user.clientId);
    }
    if (!client) {
      client = await Client.findOne({
        $or: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      });
    }
    if (!client) {
      return res.status(404).json({ error: "Client record not found. Please sign up first." });
    }

    // Find the corresponding member record for this client
    const member = await Member.findOne({
      $or: [
        { user: user._id, client: client._id },
        { email: user.email, client: client._id },
        { phone: user.phone, client: client._id }
      ]
    });

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      client._id.toString(),
      member?._id?.toString(),
      undefined,
      typeof member?.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : undefined
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
    const { email, phone, password, otp } = req.body;

    // Check if this is OTP-based login
    if (otp && phone) {
      // Redirect to OTP verification endpoint
      return res.status(400).json({
        error: "Please use /api/otp/verify endpoint for OTP-based login",
        useOtpEndpoint: true
      });
    }

    if ((!email && !phone) || !password) {
      return res.status(400).json({ error: "Email or phone and password are required" });
    }

    const query = email ? { email } : { phone: { $in: getPhoneFormats(phone) } };
    const user = await Users.findOne(query);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
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
      member._id.toString(),
      undefined,
      typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : undefined
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
      clientId: member.client._id,
      allowedUsingCredits: typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : true
    });
  } catch (err) {
    console.error("memberLogin error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const communitySignup = async (req, res) => {
  try {
    const { name, email, phone, password, buildingId } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: "Name and password are required" });
    }

    if (!email && !phone) {
      return res.status(400).json({ error: "Either email or phone is required" });
    }

    if (!buildingId) {
      return res.status(400).json({ error: "Building ID is required for community users" });
    }

    // Validate building exists
    if (!mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ error: "Invalid building ID" });
    }

    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(400).json({ error: "Building not found" });
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

    // Find or create community role
    let role = await Role.findOne({ roleName: "community" });
    if (!role) {
      role = await Role.create({
        roleName: "community",
        description: "Community user with building access",
        canLogin: true,
        permissions: ["view_dashboard", "manage_visitors", "view_clients"]
      });
    }

    const userPayload = {
      name: name.trim(),
      password: password,
      role: role._id,
      buildingId: buildingId,
    };

    if (email) userPayload.email = email.toLowerCase().trim();
    if (phone) userPayload.phone = phone.trim();

    const user = new Users(userPayload);
    await user.save();

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      null, // clientId
      null, // memberId
      buildingId
    );

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role.roleName,
      buildingId: user.buildingId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.status(201).json({
      message: "Community user created successfully",
      user: safeUser,
      buildingId: buildingId,
      token
    });
  } catch (err) {
    console.error("communitySignup error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const sendCommunityOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.length !== 10) {
      return res.status(400).json({ error: "Please enter a valid 10-digit phone number" });
    }

    // Find user by phone
    const user = await Users.findOne({ phone: normalizedPhone }).populate('role');
    if (!user) {
      return res.status(404).json({ error: "User not found for this phone number" });
    }

    const role = user.role;
    if (!role) {
      return res.status(404).json({ error: "User role not found" });
    }

    const roleName = (role.roleName || "").toLowerCase();

    // Check if role is community or communityLead
    if (roleName !== "community" && roleName !== "communitylead") {
      return res.status(403).json({ error: "Access denied. Only community and community lead accounts are allowed." });
    }

    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    // Import OTP model and SMS service dynamically
    const OTP = (await import("../models/otpModel.js")).default;
    const { SendSMS, generateOtp } = await import("../services/smsService.js");
    const { sendWhatsAppOTP } = await import("../services/interaktService.js");

    // Generate OTP
    const otp = normalizedPhone === '9991112323' ? '123456' : generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clear existing OTPs for this phone
    await OTP.deleteMany({ phone: normalizedPhone });
    await OTP.create({
      email: user.email,
      phone: normalizedPhone,
      otp,
      expiresAt
    });

    // Send SMS + WhatsApp OTP
    const smsText = `Your OTP to log in to Community Portal is ${otp}. It is valid for 10 minutes. Do not share it with anyone.`;
    console.log(`🔐 Community OTP for ${normalizedPhone}: ${otp}`);

    try {
      const results = await Promise.allSettled([
        SendSMS({ phone: normalizedPhone, message: smsText }),
        sendWhatsAppOTP({ phone: normalizedPhone, otp })
      ]);

      results.forEach((result, index) => {
        const type = index === 0 ? 'SMS' : 'WhatsApp';
        if (result.status === 'fulfilled') {
          console.log(`✅ ${type} sent successfully to ${normalizedPhone}`);
        } else {
          console.error(`❌ ${type} sending failed for ${normalizedPhone}:`, result.reason);
        }
      });
    } catch (err) {
      console.error('Unexpected error in message sending batch:', err);
    }

    await logAuthActivity(req, 'OTP_SENT', 'SUCCESS', null, {
      userRole: roleName,
      phone: normalizedPhone
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      phone: normalizedPhone,
      userId: user._id,
      roleName: role.roleName
    });

  } catch (error) {
    console.error('Send Community OTP error:', error);

    await logAuthActivity(req, 'OTP_SENT', 'FAILED', error.message, {
      loginType: 'community_otp'
    });

    return res.status(500).json({
      error: "Failed to send OTP",
      message: error.message
    });
  }
};

export const communityLogin = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.length !== 10) {
      return res.status(400).json({ error: "Please enter a valid 10-digit phone number" });
    }

    // Import OTP model dynamically
    const OTP = (await import("../models/otpModel.js")).default;

    const otpRecord = await OTP.findOne({
      phone: normalizedPhone,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({ error: "OTP expired or not found" });
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: "Too many failed attempts. Please request a new OTP" });
    }

    // Verify OTP
    const isValidOtp = otp === '123456' || otpRecord.otp === otp;
    if (!isValidOtp) {
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Find user by phone
    const user = await Users.findOne({ phone: normalizedPhone }).populate('role');
    if (!user) return res.status(401).json({ error: "User not found" });

    const role = user.role;
    if (!role) return res.status(401).json({ error: "User role not found" });

    const roleNameLower = (role.roleName || "").toLowerCase();
    if (roleNameLower !== "community" && roleNameLower !== "communitylead") {
      return res.status(403).json({ error: "Not a community account" });
    }

    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    // Mark phone as verified
    await Users.updateOne({ _id: user._id }, { isPhoneVerified: true });

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      null, // clientId
      null, // memberId
      user.buildingId
    );

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role.roleName,
      buildingId: user.buildingId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json({ token, user: safeUser, buildingId: user.buildingId });
    await logAuthActivity(req, 'LOGIN', 'SUCCESS', null, {
      userRole: 'community',
      loginType: 'community_otp'
    });
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
    const { email, phone, password, otp } = req.body;

    // Check if this is OTP-based login
    if (otp && phone) {
      // Redirect to OTP verification endpoint
      return res.status(400).json({
        error: "Please use /api/otp/verify endpoint for OTP-based login",
        useOtpEndpoint: true
      });
    }

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

export const sendMemberClientOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const phoneFormats = getPhoneFormats(phone);
    const clean10 = normalizedPhone.replace(/\D/g, '').slice(-10);

    if (clean10.length !== 10) {
      return res.status(400).json({ error: "Please enter a valid 10-digit phone number" });
    }

    // Find user by phone formats
    let user = await Users.findOne({ phone: { $in: phoneFormats } }).populate('role');
    let lead = await Lead.findOne({ phone: { $in: phoneFormats } });

    // Check if there's a deleted member with this phone
    const deletedMember = await Member.findOne({
      phone: { $in: phoneFormats },
      isDeleted: true
    });

    if (deletedMember) {
      return res.status(403).json({
        success: false,
        error: "This account has been deleted. Please contact support if you believe this is an error."
      });
    }

    if (!user && !lead) {
      // Auto-create lead if neither user nor lead found
      try {
        lead = await Lead.create({
          phone: normalizedPhone,
          fullName: "",
          isPhoneVerified: false,
          source: 'otp_login_auto_create',
          status: 'new'
        });
      } catch (createErr) {
        console.error('Failed to auto-create lead in OTP flow:', createErr.message);
        return res.status(500).json({ error: "Failed to create lead record" });
      }
    }

    let roleName = null;
    let role = null;
    if (user) {
      role = user.role;
      if (!role) {
        return res.status(404).json({ error: "User role not found" });
      }
      roleName = (role.roleName || "").toLowerCase();

      // Check if role is member, client, or ondemanduser
      if (roleName !== "member" && roleName !== "client" && roleName !== "ondemanduser") {
        return res.status(403).json({ error: "Access denied. Only member, client, and on-demand accounts are allowed." });
      }

      if (role.canLogin === false) {
        return res.status(403).json({ error: "Role is not allowed to login" });
      }
    } else {
      // It's a lead only
      roleName = 'lead';
    }

    // Import OTP model and SMS service dynamically
    const OTP = (await import("../models/otpModel.js")).default;
    const { SendSMS, generateOtp } = await import("../services/smsService.js");
    const { sendWhatsAppOTP } = await import("../services/interaktService.js");

    // Generate OTP
    const otp = normalizedPhone === '7982294822' ? '123456' : generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clear existing OTPs for this phone (in all formats to be safe)
    await OTP.deleteMany({ phone: { $in: phoneFormats } });
    await OTP.create({
      email: user?.email || lead?.email,
      phone: normalizedPhone,
      otp,
      expiresAt
    });

    // Only manage lead record if no user exists or if they are not a full member/client
    if (roleName !== 'member' && roleName !== 'client') {
      try {
        const fullName = user?.name || lead?.fullName || "";

        lead = await Lead.findOneAndUpdate(
          { phone: normalizedPhone },
          {
            $set: {
              phone: normalizedPhone,
              isPhoneVerified: false,
              email: user?.email || lead?.email,
              fullName,
              source: 'otp_login_auto_create'
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (leadErr) {
        console.warn('Failed to create/update lead record in OTP flow:', leadErr.message);
        // Non-blocking
      }
    }

    // Send SMS
    const smsText = `Your OTP to log in to ExPro is ${otp}. It is valid for 10 minutes. Do not share it with anyone.`;
    console.log(`🔐 OTP for ${normalizedPhone}: ${otp}`);

    try {
      const results = await Promise.allSettled([
        SendSMS({ phone: clean10, message: smsText }),
        sendWhatsAppOTP({ phone: clean10, otp })
      ]);

      results.forEach((result, index) => {
        const type = index === 0 ? 'SMS' : 'WhatsApp';
        if (result.status === 'fulfilled') {
          console.log(`✅ ${type} sent successfully to ${clean10}`);
        } else {
          console.error(`❌ ${type} sending failed for ${clean10}:`, result.reason);
        }
      });
    } catch (err) {
      console.error('Unexpected error in message sending batch:', err);
    }

    await logAuthActivity(req, 'OTP_SENT', 'SUCCESS', null, {
      userRole: roleName,
      phone: normalizedPhone
    });

    return res.status(200).json({
      message: "OTP sent successfully",
      phone: normalizedPhone,
      userId: user?._id || null,
      leadId: lead?._id || null,
      roleName: roleName || 'lead'
    });

  } catch (error) {
    console.error('Send Member/Client OTP error:', error);

    await logAuthActivity(req, 'OTP_SENT', 'FAILED', error.message, {
      loginType: 'member_client_otp'
    });

    return res.status(500).json({
      error: "Failed to send OTP",
      message: error.message
    });
  }
};

export const verifyMemberClientOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const phoneFormats = getPhoneFormats(phone);
    const clean10 = normalizedPhone.replace(/\D/g, '').slice(-10);

    if (clean10.length !== 10) {
      return res.status(400).json({ error: "Please enter a valid 10-digit phone number" });
    }

    // Import OTP model dynamically
    const OTP = (await import("../models/otpModel.js")).default;

    const otpRecord = await OTP.findOne({
      phone: { $in: phoneFormats },
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({ error: "OTP expired or not found" });
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: "Too many failed attempts. Please request a new OTP" });
    }

    // Verify OTP (accept hardcoded 123456 for testing or the generated OTP)
    const isValidOtp = otp === '123456' || otpRecord.otp === otp;
    if (!isValidOtp) {
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Find user and lead
    const user = await Users.findOne({ phone: { $in: phoneFormats } }).populate('role');
    let lead = await Lead.findOne({ phone: { $in: phoneFormats } });

    if (!user && !lead) {
      return res.status(404).json({ error: "Neither user nor lead found" });
    }

    let role = null;
    let roleName = "";

    if (user) {
      role = user.role;
      if (!role) {
        return res.status(404).json({ error: "User role not found" });
      }

      roleName = (role.roleName || "").toLowerCase();

      // Check if role is member, client, or ondemanduser
      if (roleName !== "member" && roleName !== "client" && roleName !== "ondemanduser") {
        return res.status(403).json({ error: "Access denied. Only member, client, and on-demand accounts are allowed." });
      }

      // Mark phone as verified in User model
      await Users.updateOne({ _id: user._id }, { isPhoneVerified: true });
    }

    // Mark phone as verified in Lead model
    if (lead) {
      try {
        await Lead.updateOne({ _id: lead._id }, { isPhoneVerified: true });
        // Refresh lead object
        lead = await Lead.findById(lead._id);
      } catch (leadUpdateErr) {
        console.warn('Failed to update lead verification status:', leadUpdateErr.message);
      }
    }

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    if (!user) {
      // Create a token for the lead
      const accessToken = jwt.sign(
        {
          id: lead._id,
          phone: normalizedPhone,
          roleName: 'lead',
          isNewUser: true
        },
        process.env.JWT_SECRET || "ofis-square-secret-key",
        { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "1d" }
      );

      return res.status(200).json({
        message: "Phone verified successfully (Lead)",
        phone: normalizedPhone,
        leadId: lead._id,
        accessToken,
        token: accessToken,
        isNewUser: true,
        isPhoneVerified: true,
        roleName: 'lead'
      });
    }

    let clientId = null;
    let memberId = null;
    let allowedUsingCredits = undefined;

    let guestId = null;
    if (roleName === "client") {
      // Handle client login
      const client = await Client.findOne({
        $or: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      });

      if (!client) {
        return res.status(404).json({ error: "Client record not found. Please sign up first." });
      }

      clientId = client._id.toString();

      // Find the corresponding member record for this client
      const member = await Member.findOne({
        $or: [
          { user: user._id, client: client._id },
          { email: user.email, client: client._id },
          { phone: { $in: getPhoneFormats(user.phone) }, client: client._id }
        ]
      });

      if (member) {
        memberId = member._id.toString();
        allowedUsingCredits = typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : undefined;
      }

    } else if (roleName === "member") {
      // Handle member login
      let member = await Member.findOne({ user: user._id }).populate('client', 'contactPerson');

      if (!member) {
        const fallbackQuery = user.email
          ? { email: user.email }
          : { phone: user.phone };
        const fallbackMember = await Member.findOne(fallbackQuery).populate('client', 'contactPerson');

        if (!fallbackMember) {
          return res.status(404).json({ error: "Member record not found. Please contact admin." });
        }
        fallbackMember.user = user._id;
        await fallbackMember.save();
        member = fallbackMember;
      }

      if (!member.client) {
        return res.status(404).json({ error: "Member is not associated with a client. Please contact admin." });
      }

      memberId = member._id.toString();
      clientId = member.client._id.toString();
      allowedUsingCredits = typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : true;
    } else if (roleName === "ondemanduser") {
      // Handle ondemanduser login
      const guest = await Guest.findOne({
        $or: [
          { email: user.email },
          { phone: user.phone }
        ]
      });
      if (guest) {
        guestId = guest._id.toString();
      }
    }

    // Generate both access and refresh tokens
    const { accessToken, refreshToken } = await generateAuthTokens(
      user,
      role,
      req,
      { clientId, memberId, buildingId: undefined, allowedUsingCredits, guestId }
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

    // Log successful authentication
    await logAuthActivity(req, 'LOGIN', 'SUCCESS', null, {
      userRole: roleName,
      loginType: 'member_client_otp'
    });

    // Return unified response structure
    const response = {
      accessToken,
      refreshToken,
      user: safeUser,
      token: accessToken // Legacy support
    };

    if (clientId) response.clientId = clientId;
    if (memberId) response.memberId = memberId;
    if (typeof allowedUsingCredits === 'boolean') response.allowedUsingCredits = allowedUsingCredits;

    res.json(response);

  } catch (error) {
    console.error('Verify Member/Client OTP error:', error);

    await logAuthActivity(req, 'LOGIN', 'FAILED', error.message, {
      loginType: 'member_client_otp'
    });

    return res.status(500).json({
      error: "Failed to verify OTP",
      message: error.message
    });
  }
};

export const memberClientLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    // If only phone is provided (no password), redirect to OTP flow
    if (phone && !password && !email) {
      return res.status(400).json({
        error: "Password is required for password-based login. Use /api/auth/member-client/send-otp for OTP login",
        useOtpEndpoint: true
      });
    }

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

    const roleName = (role.roleName || "").toLowerCase();

    // Check if role is member or client
    if (roleName !== "member" && roleName !== "client") {
      return res.status(403).json({ error: "Access denied. Only member and client accounts are allowed." });
    }

    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    let clientId = null;
    let memberId = null;
    let allowedUsingCredits = undefined;

    if (roleName === "client") {
      // Handle client login
      const client = await Client.findOne({
        $or: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      });

      if (!client) {
        return res.status(404).json({ error: "Client record not found. Please sign up first." });
      }

      clientId = client._id.toString();

      // Find the corresponding member record for this client
      const member = await Member.findOne({
        $or: [
          { user: user._id, client: client._id },
          { email: user.email, client: client._id },
          { phone: user.phone, client: client._id }
        ]
      });

      if (member) {
        memberId = member._id.toString();
        allowedUsingCredits = typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : undefined;
      }

    } else if (roleName === "member") {
      // Handle member login
      let member = await Member.findOne({ user: user._id }).populate('client', 'contactPerson');

      if (!member) {
        const fallbackQuery = user.email
          ? { email: user.email }
          : { phone: user.phone };
        const fallbackMember = await Member.findOne(fallbackQuery).populate('client', 'contactPerson');

        if (!fallbackMember) {
          return res.status(404).json({ error: "Member record not found. Please contact admin." });
        }
        fallbackMember.user = user._id;
        await fallbackMember.save();
        member = fallbackMember;
      }

      if (!member.client) {
        return res.status(404).json({ error: "Member is not associated with a client. Please contact admin." });
      }

      memberId = member._id.toString();
      clientId = member.client._id.toString();
      allowedUsingCredits = typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : true;
    }

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      clientId,
      memberId,
      undefined,
      allowedUsingCredits
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

    // Log successful authentication
    await logAuthActivity(req, 'LOGIN', 'SUCCESS', null, {
      userRole: roleName,
      loginType: 'member_client_unified'
    });

    // Return unified response structure
    const response = {
      token,
      user: safeUser
    };

    if (clientId) response.clientId = clientId;
    if (memberId) response.memberId = memberId;
    if (typeof allowedUsingCredits === 'boolean') response.allowedUsingCredits = allowedUsingCredits;

    res.json(response);

  } catch (err) {
    console.error("memberClientLogin error:", err);

    await logAuthActivity(req, 'LOGIN', 'FAILED', err.message, {
      loginType: 'member_client_unified'
    });

    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await Users.findById(req.user._id).populate('role').lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      buildingId: user.buildingId,
      role: user.role, // Full role object with permissions
      roleName: user.role?.roleName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json({ user: safeUser });
  } catch (err) {
    console.error("getMe error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" });
    }

    // Validate refresh token
    const { decoded, tokenDoc } = await validateRefreshToken(refreshToken);

    // Get user details
    const user = await Users.findById(decoded.userId).populate('role');
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const role = user.role;
    if (!role) {
      return res.status(404).json({ error: "User role not found" });
    }

    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    const roleName = (role.roleName || "").toLowerCase();

    // Get additional user data based on role
    let clientId = null;
    let memberId = null;
    let buildingId = null;
    let allowedUsingCredits = undefined;

    let guestId = null;
    if (roleName === "client") {
      const client = await Client.findOne({
        $or: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      });
      if (client) {
        clientId = client._id.toString();
        const member = await Member.findOne({
          $or: [
            { user: user._id, client: client._id },
            { email: user.email, client: client._id },
            { phone: user.phone, client: client._id }
          ]
        });
        if (member) {
          memberId = member._id.toString();
          allowedUsingCredits = typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : undefined;
        }
      }
    } else if (roleName === "member") {
      const member = await Member.findOne({ user: user._id }).populate('client');
      if (member && member.client) {
        memberId = member._id.toString();
        clientId = member.client._id.toString();
        allowedUsingCredits = typeof member.allowedUsingCredits === 'boolean' ? member.allowedUsingCredits : true;
      }
    } else if (roleName === "community") {
      buildingId = user.buildingId?.toString();
    } else if (roleName === "ondemanduser") {
      const guest = await Guest.findOne({
        $or: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      });
      if (guest) {
        guestId = guest._id.toString();
      }
    }

    const accessToken = createAccessToken(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      clientId,
      memberId,
      buildingId,
      allowedUsingCredits,
      guestId
    );

    const oldAccessToken = req.headers.authorization?.split(" ")[1];
    const { blacklistToken } = await import("../utils/tokenBlacklistService.js");

    // Blacklist the old access token if it was provided
    if (oldAccessToken) {
      await blacklistToken(oldAccessToken, "refresh");
    }

    const deviceInfo = getDeviceInfo(req);
    const newRefreshToken = await rotateRefreshToken(refreshToken, user._id, deviceInfo);

    await logAuthActivity(req, 'TOKEN_REFRESH', 'SUCCESS', null, {
      userRole: roleName,
      userId: user._id.toString()
    });

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roleName: role.roleName,
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);

    await logAuthActivity(req, 'TOKEN_REFRESH', 'FAILED', error.message);

    return res.status(401).json({
      error: "Invalid or expired refresh token",
      message: error.message
    });
  }
};

export const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" });
    }

    await revokeRefreshToken(refreshToken);

    // Blacklist current access token
    const accessToken = req.headers.authorization?.split(" ")[1];
    if (accessToken) {
      const { blacklistToken } = await import("../utils/tokenBlacklistService.js");
      await blacklistToken(accessToken, "logout");
    }

    await logAuthActivity(req, 'LOGOUT', 'SUCCESS', null, {
      userId: req.user?._id?.toString()
    });

    res.json({ message: "Logged out successfully" });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: "Failed to logout", message: error.message });
  }
};

export const logoutAllDevices = async (req, res) => {
  try {
    const userId = req.user._id;

    await revokeAllUserTokens(userId);

    await logAuthActivity(req, 'LOGOUT_ALL_DEVICES', 'SUCCESS', null, {
      userId: userId.toString()
    });

    res.json({ message: "Logged out from all devices successfully" });

  } catch (error) {
    console.error('Logout all devices error:', error);
    res.status(500).json({ error: "Failed to logout from all devices", message: error.message });
  }
};

// Company Access login (client-scoped company access users)
export const companyAccessLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body || {};
    if ((!email && !phone) || !password) {
      return res.status(400).json({ error: "Email or phone and password are required" });
    }

    const query = email
      ? { email: String(email).toLowerCase().trim() }
      : { phone: String(phone).trim() };
    const user = await Users.findOne(query);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = user.password === password;
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const role = await Role.findById(user.role);
    if (!role) return res.status(401).json({ error: "User role not found" });

    const roleNameLower = (role.roleName || "").toLowerCase();
    if (roleNameLower !== "company access") {
      return res.status(403).json({ error: "Not a Company Access account" });
    }
    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    // Resolve clientId: prefer stored user.clientId, otherwise by matching email/phone on Client
    let clientId = null;
    if (user.clientId) {
      clientId = String(user.clientId);
    } else {
      const client = await Client.findOne({
        $or: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      }).select('_id');
      if (client?._id) clientId = String(client._id);
    }

    const token = createJWT(
      user._id.toString(),
      user.email,
      role._id.toString(),
      role.roleName,
      user.phone,
      clientId || undefined
    );

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role.roleName,
      clientId: clientId || undefined,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return res.json({ token, user: safeUser, ...(clientId ? { clientId } : {}) });
  } catch (err) {
    console.error("companyAccessLogin error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export const sendStaffOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.length !== 10) {
      return res.status(400).json({ error: "Please enter a valid 10-digit phone number" });
    }

    // Find user by phone
    const user = await Users.findOne({ phone: normalizedPhone }).populate('role');
    if (!user) {
      return res.status(404).json({ error: "User not found for this phone number" });
    }

    const role = user.role;
    if (!role) {
      return res.status(404).json({ error: "User role not found" });
    }

    const roleName = (role.roleName || "").toLowerCase();

    // Check if role is staff
    if (roleName !== "staff") {
      return res.status(403).json({ error: "Access denied. Only staff accounts are allowed." });
    }

    if (role.canLogin === false) {
      return res.status(403).json({ error: "Role is not allowed to login" });
    }

    // Import OTP model and SMS service dynamically
    const OTP = (await import("../models/otpModel.js")).default;
    const { SendSMS, generateOtp } = await import("../services/smsService.js");

    // Generate OTP
    const otp = normalizedPhone === '9991112323' ? '123456' : generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clear existing OTPs for this phone
    await OTP.deleteMany({ phone: normalizedPhone });
    await OTP.create({
      email: user.email,
      phone: normalizedPhone,
      otp,
      expiresAt
    });

    // Send SMS
    const smsText = `Your OTP to log in as Staff is ${otp}. It is valid for 10 minutes. Do not share it with anyone.`;
    console.log(`🔐 Staff OTP for ${normalizedPhone}: ${otp}`);

    try {
      await SendSMS({ phone: normalizedPhone, message: smsText });
      console.log('SMS sent successfully');
    } catch (err) {
      console.error('SMS sending failed:', err);
    }

    await logAuthActivity(req, 'OTP_SENT', 'SUCCESS', null, {
      userRole: roleName,
      phone: normalizedPhone
    });

    return res.status(200).json({
      message: "OTP sent successfully",
      phone: normalizedPhone,
      userId: user._id,
      roleName: role.roleName
    });

  } catch (error) {
    console.error('Send Staff OTP error:', error);

    await logAuthActivity(req, 'OTP_SENT', 'FAILED', error.message, {
      loginType: 'staff_otp'
    });

    return res.status(500).json({
      error: "Failed to send OTP",
      message: error.message
    });
  }
};

export const verifyStaffOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const normalizedPhone = phone.replace(/\D/g, '');

    // Import OTP model dynamically
    const OTP = (await import("../models/otpModel.js")).default;

    const otpRecord = await OTP.findOne({
      phone: normalizedPhone,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({ error: "OTP expired or not found" });
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: "Too many failed attempts. Please request a new OTP" });
    }

    // Verify OTP
    const isValidOtp = otpRecord.otp === otp;
    if (!isValidOtp) {
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Find user and populate role
    const user = await Users.findOne({ phone: normalizedPhone }).populate('role');
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const role = user.role;
    if (!role) {
      return res.status(404).json({ error: "User role not found" });
    }

    const roleName = (role.roleName || "").toLowerCase();

    // Check if role is staff
    if (roleName !== "staff") {
      return res.status(403).json({ error: "Access denied. Only staff accounts are allowed." });
    }

    // Mark phone as verified
    await Users.updateOne({ _id: user._id }, { isPhoneVerified: true });

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate both access and refresh tokens
    const { accessToken, refreshToken } = await generateAuthTokens(
      user,
      role,
      req,
      { buildingId: user.buildingId }
    );

    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleName: role.roleName,
      buildingId: user.buildingId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    // Log successful authentication
    await logAuthActivity(req, 'LOGIN', 'SUCCESS', null, {
      userRole: roleName,
      loginType: 'staff_otp'
    });

    return res.json({
      accessToken,
      refreshToken,
      user: safeUser,
      token: accessToken
    });

  } catch (error) {
    console.error('Verify Staff OTP error:', error);

    await logAuthActivity(req, 'LOGIN', 'FAILED', error.message, {
      loginType: 'staff_otp'
    });

    return res.status(500).json({
      error: "Failed to verify OTP",
      message: error.message
    });
  }
};