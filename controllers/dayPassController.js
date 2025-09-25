import DayPass from "../models/dayPassModel.js";
import DayPassBundle from "../models/dayPassBundleModel.js";
import Building from "../models/buildingModel.js";
import Guest from "../models/guestModel.js";
import Visitor from "../models/visitorModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Contract from "../models/contractModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import Payment from "../models/paymentModel.js";
import { logBookingActivity, logPaymentActivity, logErrorActivity } from "../utils/activityLogger.js";
import crypto from "crypto";
import mongoose from "mongoose";

// Create single day pass (not from bundle)
export const createSingleDayPass = async (req, res) => {
  try {
    const { customerId, memberId, buildingId, notes, bookingFor, visitDate } = req.body;

    if (!customerId || !buildingId) {
      return res.status(400).json({ 
        error: "Customer ID and Building ID are required" 
      });
    }

    // Validate new required fields
    if (!bookingFor || !['self', 'other'].includes(bookingFor)) {
      return res.status(400).json({ 
        error: "bookingFor must be 'self' or 'other'" 
      });
    }

    // Only require visitDate for "self" bookings
    if (bookingFor === "self" && !visitDate) {
      return res.status(400).json({ 
        error: "visitDate is required for self bookings" 
      });
    }

    let parsedVisitDate = null;
    if (visitDate) {
      parsedVisitDate = new Date(visitDate);
      if (isNaN(parsedVisitDate.getTime())) {
        return res.status(400).json({ 
          error: "Invalid visitDate format" 
        });
      }
    }

    // Verify customer exists - could be Guest, Member, or Client
    let customer = null;
    let customerType = 'guest';
    
    // First try to find as Guest
    customer = await Guest.findById(customerId);
    
    // If not found as Guest, try as Member
    if (!customer) {
      const Member = (await import('../models/memberModel.js')).default;
      customer = await Member.findById(customerId);
      if (customer) {
        customerType = 'member';
      }
    }
    
    // If still not found, try as Client
    if (!customer) {
      const Client = (await import('../models/clientModel.js')).default;
      customer = await Client.findById(customerId);
      if (customer) {
        customerType = 'client';
      }
    }
    
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Verify building exists and get pricing
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }

    if (!building.openSpacePricing) {
      return res.status(400).json({ 
        error: "Day pass pricing not configured for this building" 
      });
    }

    const price = building.openSpacePricing;
    const taxAmount = Math.round(price * 0.18); // 18% GST
    const totalAmount = price + taxAmount;

    // Set booking date (today) and expiry at end of day
    const bookingDate = new Date();
    const expiresAt = new Date();
    // Normalize bookingDate to start of day for consistency
    bookingDate.setHours(0, 0, 0, 0);
    expiresAt.setHours(23, 59, 59, 999);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create day pass with payment_pending status
      const dayPass = new DayPass({
        customer: customerId,
        member: customerType === 'member' ? customerId : (memberId || null),
        building: buildingId,
        bundle: null, // Single pass, not from bundle
        // Use booking date as the day for the pass; invitation can still set visitor/date later
        date: bookingDate,
        visitDate: parsedVisitDate,
        bookingFor,
        expiresAt,
        price,
        status: "payment_pending",
        notes,
        createdBy: req.user?._id
      });

      await dayPass.save({ session });

      // Create invoice (schema: invoiceModel.js)
      const invoice = new Invoice({
        client: customerType === 'client' ? customerId : null,
        guest: customerType !== 'client' ? customerId : null,
        building: buildingId,
        type: "regular",
        category: "day_pass",
        invoice_number: `DP-${Date.now()}`,
        line_items: [{
          description: `Day Pass - ${building.name}`,
          quantity: 1,
          unitPrice: price,
          amount: price,
          rate: price
        }],
        sub_total: price,
        tax_total: taxAmount,
        total: totalAmount,
        status: "draft",
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });

      await invoice.save({ session });

      // Link invoice to day pass
      dayPass.invoice = invoice._id;
      await dayPass.save({ session });

      await session.commitTransaction();

      // Populate response data
      await dayPass.populate([
        { path: 'customer', select: 'name email phone' },
        { path: 'building', select: 'name address openSpacePricing' },
        { path: 'invoice', select: 'invoice_number total status' }
      ]);

      // Log activity
      await logBookingActivity(req, 'CREATE', 'DayPass', dayPass._id, {
        customerId,
        memberId,
        buildingId,
        date: bookingDate,
        totalAmount
      });

      res.status(201).json({
        success: true,
        message: 'Day pass created successfully',
        data: {
          dayPass,
          invoice,
          razorpayConfig: {
            key: process.env.RAZORPAY_KEY_ID || 'rzp_test_02U4mUmreLeYrU',
            amount: totalAmount * 100, // Razorpay expects amount in paise
            currency: 'INR',
            name: 'Ofis Square',
            description: `Day Pass - ${building.name}`,
            order_id: `daypass_${dayPass._id}`,
            prefill: {
              name: customer.companyName,
              email: customer.email,
              contact: customer.phone
            },
            theme: {
              color: '#3399cc'
            }
          }
        }
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("createSingleDayPass error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Invite visitor to a day pass (assign date and generate QR)
export const inviteVisitor = async (req, res) => {
  try {
    const { dayPassId } = req.params;
    const { 
      date, 
      visitorName, 
      visitorPhone, 
      visitorEmail,
      visitorCompany,
      purpose,
      numberOfGuests = 1,
      expectedArrivalTime,
      expectedDepartureTime
    } = req.body;

    if (!date || !visitorName) {
      return res.status(400).json({ error: "Date and visitor name are required" });
    }

    const dayPass = await DayPass.findById(dayPassId)
      .populate('customer', 'name email phone')
      .populate('building', 'name address')
      .populate('hostMember', 'firstName lastName email phone')
      .populate('hostClient', 'name email phone')
      .populate('hostGuest', 'name email phone');

    if (!dayPass) {
      return res.status(404).json({ error: "Day pass not found" });
    }

    // Check if day pass is issued (payment completed)
    if (dayPass.status !== 'issued') {
      return res.status(400).json({ 
        error: "Day pass must be paid for before inviting visitors",
        currentStatus: dayPass.status,
        requiredStatus: 'issued'
      });
    }

    // Set host information from JWT via hostMiddleware (req.hostInfo)
    if (req.hostInfo?.type && req.hostInfo?.id) {
      if (req.hostInfo.type === 'member') {
        dayPass.hostMember = req.hostInfo.id;
        dayPass.hostClient = null;
        dayPass.hostGuest = null;
      } else if (req.hostInfo.type === 'client') {
        dayPass.hostClient = req.hostInfo.id;
        dayPass.hostMember = null;
        dayPass.hostGuest = null;
      } else if (req.hostInfo.type === 'guest') {
        dayPass.hostGuest = req.hostInfo.id;
        dayPass.hostMember = null;
        dayPass.hostClient = null;
      }
    }

    // Set the pass date and visitor details
    const passDate = new Date(date);
    passDate.setHours(0, 0, 0, 0);
    
    dayPass.date = passDate;
    dayPass.visitorName = visitorName;
    dayPass.visitorPhone = visitorPhone;
    dayPass.visitorEmail = visitorEmail;
    dayPass.visitorCompany = visitorCompany;
    dayPass.purpose = purpose;
    dayPass.numberOfGuests = Math.max(1, parseInt(numberOfGuests) || 1);
    // Helper to merge a "HH:MM" time into a given date
    const buildDateTime = (baseDate, timeStr) => {
      if (!timeStr || typeof timeStr !== 'string') return null;
      const [hh, mm] = timeStr.split(':').map((v) => parseInt(v, 10));
      if (
        Number.isNaN(hh) || Number.isNaN(mm) ||
        hh < 0 || hh > 23 || mm < 0 || mm > 59
      ) {
        return null;
      }
      const dt = new Date(baseDate);
      dt.setHours(hh, mm, 0, 0);
      return dt;
    };

    const arrivalDT = buildDateTime(passDate, expectedArrivalTime);
    const departureDT = buildDateTime(passDate, expectedDepartureTime);

    dayPass.expectedArrivalTime = arrivalDT || null;
    dayPass.expectedDepartureTime = departureDT || null;
    dayPass.status = "invited";
    dayPass.invitedAt = new Date();
    
    // Generate QR code and set expiry
    const qrData = {
      passId: dayPass._id,
      visitorName,
      date: passDate.toISOString(),
      buildingId: dayPass.building._id,
      type: 'day_pass'
    };
    
    dayPass.qrCode = Buffer.from(JSON.stringify(qrData)).toString('base64');
    
    // Set QR expiry to end of pass date
    const qrExpiry = new Date(passDate);
    qrExpiry.setHours(23, 59, 59, 999);
    dayPass.qrExpiresAt = qrExpiry;
    
    await dayPass.save();

    // Populate host information for response
    await dayPass.populate([
      { path: 'hostMember', select: 'firstName lastName email phone' },
      { path: 'hostClient', select: 'name email phone' },
      { path: 'hostGuest', select: 'name email phone' }
    ]);

    // Also create a Visitor record linked to this DayPass
    const visitorDoc = new Visitor({
      name: visitorName,
      email: visitorEmail,
      phone: visitorPhone,
      companyName: visitorCompany,
      purpose,
      numberOfGuests: Math.max(1, parseInt(numberOfGuests) || 1),
      expectedVisitDate: passDate,
      expectedArrivalTime: arrivalDT || null,
      expectedDepartureTime: departureDT || null,
      hostMember: dayPass.hostMember || undefined,
      hostClient: dayPass.hostClient || undefined,
      hostGuest: dayPass.hostGuest || undefined,
      status: 'invited',
      building: dayPass.building,
      dayPass: dayPass._id,
      createdBy: req.user?._id || undefined,
      // Keep QR in sync with DayPass
      qrToken: dayPass.qrCode,
      qrExpiresAt: dayPass.qrExpiresAt,
    });

    await visitorDoc.save();

    // TODO: Send invitation email with QR code similar to visitor system
    
    res.json({
      message: "Visitor invited successfully",
      dayPass,
      visitor: {
        id: visitorDoc._id,
        name: visitorDoc.name,
        qrToken: visitorDoc.qrToken,
        expectedVisitDate: visitorDoc.expectedVisitDate,
        status: visitorDoc.status,
      },
      qrCode: dayPass.qrCode,
      qrUrl: `${req.protocol}://${req.get('host')}/day-passes/scan?qr=${dayPass.qrCode}`
    });

  } catch (error) {
    console.error("inviteVisitor error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Check-in with QR code
export const checkInWithQR = async (req, res) => {
  try {
    const { qrCode, buildingId } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "QR code is required" });
    }

    const dayPass = await DayPass.findOne({ qrCode })
      .populate('customer', 'name email phone')
      .populate('building', 'name address');

    if (!dayPass) {
      return res.status(404).json({ error: "Invalid QR code" });
    }

    // Verify building if provided
    if (buildingId && String(dayPass.building._id) !== String(buildingId)) {
      return res.status(400).json({ error: "QR code not valid for this building" });
    }

    // Check if pass is valid for today
    const today = new Date();
    const passDate = new Date(dayPass.date);
    
    if (passDate.toDateString() !== today.toDateString()) {
      return res.status(400).json({ error: "Day pass is not valid for today" });
    }

    if (dayPass.status !== "invited") {
      return res.status(400).json({ 
        error: `Cannot check-in. Pass status: ${dayPass.status}` 
      });
    }

    // Perform check-in
    dayPass.checkInTime = new Date();
    dayPass.status = "checked_in";
    await dayPass.save();

    res.json({
      message: "Check-in successful",
      dayPass,
      checkInTime: dayPass.checkInTime,
      visitor: {
        name: dayPass.visitorName,
        phone: dayPass.visitorPhone,
        email: dayPass.visitorEmail
      }
    });

  } catch (error) {
    console.error("checkInWithQR error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Check-out with QR code
export const checkOutWithQR = async (req, res) => {
  try {
    const { qrCode, buildingId } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "QR code is required" });
    }

    const dayPass = await DayPass.findOne({ qrCode })
      .populate('customer', 'name email phone')
      .populate('building', 'name address');

    if (!dayPass) {
      return res.status(404).json({ error: "Invalid QR code" });
    }

    // Verify building if provided
    if (buildingId && String(dayPass.building._id) !== String(buildingId)) {
      return res.status(400).json({ error: "QR code not valid for this building" });
    }

    if (dayPass.status !== "checked_in") {
      return res.status(400).json({ 
        error: `Cannot check-out. Pass status: ${dayPass.status}` 
      });
    }

    // Perform check-out
    dayPass.checkOutTime = new Date();
    dayPass.status = "checked_out";
    await dayPass.save();

    // Calculate duration
    const duration = Math.round((dayPass.checkOutTime - dayPass.checkInTime) / (1000 * 60)); // minutes

    res.json({
      message: "Check-out successful",
      dayPass,
      checkOutTime: dayPass.checkOutTime,
      duration: `${duration} minutes`,
      visitor: {
        name: dayPass.visitorName,
        phone: dayPass.visitorPhone,
        email: dayPass.visitorEmail
      }
    });

  } catch (error) {
    console.error("checkOutWithQR error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Scan QR (auto check-in or check-out based on current status)
export const scanQR = async (req, res) => {
  try {
    const { qrCode, buildingId } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "QR code is required" });
    }

    const dayPass = await DayPass.findOne({ qrCode })
      .populate('customer', 'name email phone')
      .populate('building', 'name address');

    if (!dayPass) {
      return res.status(404).json({ error: "Invalid QR code" });
    }

    // Verify building if provided
    if (buildingId && String(dayPass.building._id) !== String(buildingId)) {
      return res.status(400).json({ error: "QR code not valid for this building" });
    }

    // Check if pass is valid for today
    const today = new Date();
    const passDate = new Date(dayPass.date);
    
    if (passDate.toDateString() !== today.toDateString()) {
      return res.status(400).json({ error: "Day pass is not valid for today" });
    }

    let action = "";
    let timestamp = null;

    // Auto-determine action based on current status
    if (dayPass.status === "invited") {
      // Check-in
      dayPass.checkInTime = new Date();
      dayPass.status = "checked_in";
      action = "check_in";
      timestamp = dayPass.checkInTime;
    } else if (dayPass.status === "checked_in") {
      // Check-out
      dayPass.checkOutTime = new Date();
      dayPass.status = "checked_out";
      action = "check_out";
      timestamp = dayPass.checkOutTime;
    } else {
      return res.status(400).json({ 
        error: `Cannot process scan. Pass status: ${dayPass.status}` 
      });
    }

    await dayPass.save();

    // Calculate duration if checking out
    let duration = null;
    if (action === "check_out" && dayPass.checkInTime) {
      duration = Math.round((dayPass.checkOutTime - dayPass.checkInTime) / (1000 * 60)); // minutes
    }

    res.json({
      message: `${action.replace('_', '-')} successful`,
      action,
      dayPass,
      timestamp,
      ...(duration && { duration: `${duration} minutes` }),
      visitor: {
        name: dayPass.visitorName,
        phone: dayPass.visitorPhone,
        email: dayPass.visitorEmail
      }
    });

  } catch (error) {
    console.error("scanQR error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get user's day passes
export const getUserDayPasses = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, buildingId, page = 1, limit = 10 } = req.query;

    const query = { customer: customerId };
    if (status) query.status = status;
    if (buildingId) query.building = buildingId;

    const skip = (page - 1) * limit;

    const dayPasses = await DayPass.find(query)
      .populate('customer', 'name email phone')
      .populate('building', 'name address')
      .populate('bundle', 'no_of_dayPasses remainingPasses')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await DayPass.countDocuments(query);

    res.json({
      dayPasses,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + dayPasses.length < total
      }
    });

  } catch (error) {
    console.error("getUserDayPasses error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get day pass details
export const getDayPassDetails = async (req, res) => {
  try {
    const { dayPassId } = req.params;

    const dayPass = await DayPass.findById(dayPassId)
      .populate('customer', 'name email phone')
      .populate('building', 'name address openSpacePricing')
      .populate('bundle', 'no_of_dayPasses remainingPasses validUntil')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .populate('payment', 'amount method status');

    if (!dayPass) {
      return res.status(404).json({ error: "Day pass not found" });
    }

    res.json({
      dayPass,
      canInvite: dayPass.status === "pending",
      canCheckIn: dayPass.status === "invited" && dayPass.date && 
                  new Date(dayPass.date).toDateString() === new Date().toDateString(),
      canCheckOut: dayPass.status === "checked_in"
    });

  } catch (error) {
    console.error("getDayPassDetails error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Admin: Get all day passes
export const getAllDayPasses = async (req, res) => {
  try {
    const { 
      status, 
      buildingId, 
      customerId,
      bundleId,
      date,
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (buildingId) query.building = buildingId;
    if (customerId) query.customer = customerId;
    if (bundleId) query.bundle = bundleId;
    if (date) {
      const queryDate = new Date(date);
      const startOfDay = new Date(queryDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(queryDate);
      endOfDay.setHours(23, 59, 59, 999);
      query.date = { $gte: startOfDay, $lte: endOfDay };
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const dayPasses = await DayPass.find(query)
      .populate('customer', 'name email phone')
      .populate('building', 'name address')
      .populate('bundle', 'no_of_dayPasses')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await DayPass.countDocuments(query);

    res.json({
      dayPasses,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + dayPasses.length < total
      }
    });

  } catch (err) {
    console.error("getAllDayPasses error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update visitor draft details for "other" bookings
export const updateVisitorDraft = async (req, res) => {
  try {
    const { dayPassId } = req.params;
    const { name, phone, email, company, purpose } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Visitor name is required" });
    }

    const dayPass = await DayPass.findById(dayPassId);
    if (!dayPass) {
      return res.status(404).json({ error: "Day pass not found" });
    }

    if (dayPass.bookingFor !== "other") {
      return res.status(400).json({ error: "Can only update visitor details for 'other' bookings" });
    }

    // Update visitor draft details
    dayPass.visitorDetailsDraft = {
      name: name?.trim(),
      phone: phone?.trim(),
      email: email?.trim(),
      company: company?.trim(),
      purpose: purpose?.trim()
    };

    await dayPass.save();

    res.json({
      success: true,
      message: "Visitor details updated successfully",
      dayPass: {
        _id: dayPass._id,
        bookingFor: dayPass.bookingFor,
        visitDate: dayPass.visitDate,
        status: dayPass.status,
        visitorDetailsDraft: dayPass.visitorDetailsDraft
      }
    });

  } catch (error) {
    console.error("updateVisitorDraft error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Manual issuance of day pass (triggers visitor creation)
export const issueDayPassManual = async (req, res) => {
  try {
    const { dayPassId } = req.params;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const result = await issueDayPass(dayPassId, session);
      
      if (result.success) {
        await session.commitTransaction();
        res.json(result);
      } else {
        await session.abortTransaction();
        res.status(400).json(result);
      }
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("issueDayPassManual error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
