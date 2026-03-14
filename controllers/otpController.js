import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";
import Guest from "../models/guestModel.js";
import OTP from "../models/otpModel.js";
import { SendSMS, generateOtp } from "../services/smsService.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

// Send OTP for any role-based login
export const sendOtpForLogin = async (req, res) => {
  try {
    const { phone, name, email } = req.body;
    
    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.length !== 10) {
      return res.status(400).json({ success: false, message: "Please enter a valid 10-digit phone number" });
    }

    // Find user by phone (do not auto-create)
    const user = await User.findOne({ phone: normalizedPhone }).populate('role');
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found for this phone number" });
    }
    const existedBefore = true;

    // Check if user can login
    if (user.role && user.role.canLogin === false) {
      return res.status(403).json({ success: false, message: "Account is not allowed to login" });
    }

    const needsDetails = !user.name || (user.email || '').endsWith('@temp.com');

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clear existing OTPs for this phone
    await OTP.deleteMany({ phone: normalizedPhone });
    await OTP.create({ 
      email: user.email, 
      phone: normalizedPhone, 
      otp, 
      expiresAt 
    });

    // Send SMS and always log OTP for testing
    const smsText = `Your OTP to log in to ExPro is ${otp}. It is valid for 10 minutes. Do not share it with anyone.`;
    console.log(`🔐 OTP for ${normalizedPhone}: ${otp}`);
    
    try {
      await SendSMS({ phone: normalizedPhone, message: smsText });
      console.log('SMS submitted to gateway');
    } catch (err) {
      console.error('SMS sending failed:', err);
      console.log('SMS delivery failed, but OTP is logged above for testing');
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      phone: normalizedPhone,
      userId: user._id,
      roleName: user.role?.roleName,
      isNewUser: false,
      needsDetails
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to send OTP", 
      error: error.message 
    });
  }
};

// Verify OTP and login
export const verifyOtpAndLogin = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: "Phone and OTP are required" });
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    const otpRecord = await OTP.findOne({ 
      phone: normalizedPhone,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({ success: false, message: "OTP expired or not found" });
    }
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ success: false, message: "Too many failed attempts. Please request a new OTP" });
    }

    // Verify OTP
    if (otpRecord.otp !== otp) {
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // Find user and populate role
    const user = await User.findOne({ phone: normalizedPhone }).populate('role');
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Mark phone as verified
    await User.updateOne({ _id: user._id }, { isPhoneVerified: true });

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate JWT based on role
    let tokenPayload = {
      id: user._id,
      phone: user.phone,
      roleName: user.role?.roleName || 'client'
    };

    let memberAllowedUsingCredits;
    if (user.role?.roleName === 'member') {
      const member = await Member.findOne({ user: user._id }).populate('client');
      if (member) {
        tokenPayload.memberId = member._id;
        tokenPayload.clientId = member.client?._id;
        memberAllowedUsingCredits = typeof member.allowedUsingCredits === 'boolean' 
          ? member.allowedUsingCredits 
          : true;
      }
    } else if (user.role?.roleName === 'client') {
      const client = await Client.findOne({ ownerUser: user._id });
      if (client) {
        tokenPayload.clientId = client._id;
      }
    } else if (user.role?.roleName === 'ondemanduser') {
      const guest = await Guest.findOne({
        $or: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      });
      if (guest) {
        tokenPayload.guestId = guest._id;
      }
    } else if (user.role?.roleName === 'community') {
      // include buildingId in token
      if (user.buildingId) tokenPayload.buildingId = user.buildingId;
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET || "ofis-square-secret-key", {
      expiresIn: "7d"
    });

    // Build safeUser object aligned with other auth endpoints
    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role?._id || user.role,
      roleName: user.role?.roleName,
      ...(user.role?.roleName === 'community' ? { buildingId: user.buildingId } : {}),
      ...(user.role?.roleName === 'member' && typeof memberAllowedUsingCredits !== 'undefined' 
        ? { allowedUsingCredits: memberAllowedUsingCredits } 
        : {}),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    // Build response object similar to specific role logins while keeping success for compatibility
    const responseData = {
      success: true,
      message: "Login successful",
      token,
      user: safeUser,
      loginType: user.role?.roleName || 'client'
    };

    // Add role-specific IDs to match respective login formats
    if (tokenPayload.memberId) responseData.memberId = tokenPayload.memberId;
    if (tokenPayload.clientId) responseData.clientId = tokenPayload.clientId;
    if (tokenPayload.guestId) responseData.guestId = tokenPayload.guestId;
    if (user.role?.roleName === 'community' && user.buildingId) responseData.buildingId = user.buildingId;
    if (user.role?.roleName === 'member' && typeof memberAllowedUsingCredits !== 'undefined') {
      responseData.allowedUsingCredits = memberAllowedUsingCredits;
    }

    return res.status(200).json(responseData);

  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to verify OTP", 
      error: error.message 
    });
  }
};

// Resend OTP
export const resendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    const normalizedPhone = phone.replace(/\D/g, '');

    // Check if user exists
    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Generate new OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Clear existing OTPs and create new one
    await OTP.deleteMany({ phone: normalizedPhone });
    await OTP.create({ 
      email: user.email, 
      phone: normalizedPhone, 
      otp, 
      expiresAt 
    });

    // Send SMS
    try {
      const smsText = `Your OTP to log in to ExPro is ${otp}. It is valid for 10 minutes. Do not share it with anyone.`;
      await SendSMS({ phone: normalizedPhone, message: smsText });
    } catch (err) {
      console.error('SMS sending failed:', err);
      await OTP.deleteMany({ phone: normalizedPhone });
      return res.status(500).json({ success: false, message: "Failed to send OTP via SMS" });
    }

    return res.status(200).json({
      success: true,
      message: "OTP resent successfully",
      phone: normalizedPhone
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to resend OTP", 
      error: error.message 
    });
  }
};
