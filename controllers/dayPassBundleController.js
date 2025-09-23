import DayPassBundle from "../models/dayPassBundleModel.js";
import DayPass from "../models/dayPassModel.js";
import Building from "../models/buildingModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import Payment from "../models/paymentModel.js";
import mongoose from "mongoose";
import crypto from "crypto";

// Create a new day pass bundle
export const createDayPassBundle = async (req, res) => {
  try {
    const { 
      customerId, 
      memberId, 
      buildingId, 
      no_of_dayPasses, 
      validityDays = 60,
      notes,
      splitSelf = 0,
      splitOther = 0,
      datesSelf = [],
      datesOther = []
    } = req.body;

    if (!customerId || !buildingId || !no_of_dayPasses) {
      return res.status(400).json({ 
        error: "Customer ID, Building ID, and number of day passes are required" 
      });
    }

    if (no_of_dayPasses < 1 || no_of_dayPasses > 50) {
      return res.status(400).json({ 
        error: "Number of day passes must be between 1 and 50" 
      });
    }

    // Validate split counts
    if (splitSelf + splitOther > no_of_dayPasses) {
      return res.status(400).json({ 
        error: "splitSelf + splitOther cannot exceed no_of_dayPasses" 
      });
    }

    if (splitSelf + splitOther === 0) {
      return res.status(400).json({ 
        error: "At least one pass must be allocated (splitSelf or splitOther)" 
      });
    }

    if (splitSelf > 0 && datesSelf.length !== splitSelf) {
      return res.status(400).json({ 
        error: "datesSelf array length must match splitSelf count" 
      });
    }

    // No date validation for "other" bookings - dates will be set later in manage flow

    // Parse and validate dates
    const parsedDatesSelf = datesSelf.map(date => {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid date in datesSelf: ${date}`);
      }
      return parsed;
    });

    // Only parse datesOther if provided (for "other" bookings, dates are optional at booking time)
    const parsedDatesOther = datesOther.length > 0 ? datesOther.map(date => {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid date in datesOther: ${date}`);
      }
      return parsed;
    }) : [];

    // Verify customer exists (could be Guest, Member, or Client)
    let customer = await Guest.findById(customerId);
    let customerType = 'guest';
    
    if (!customer) {
      customer = await Member.findById(customerId);
      if (customer) {
        customerType = 'member';
      }
    }
    
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

    // Calculate total amount
    const pricePerPass = building.openSpacePricing;
    const totalAmount = pricePerPass * no_of_dayPasses;
    const taxAmount = Math.round(totalAmount * 0.18); // 18% GST
    const finalAmount = totalAmount + taxAmount;

    // Set validity dates
    const validFrom = new Date();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validityDays);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create bundle
      const bundle = new DayPassBundle({
        customer: customerId,
        member: memberId || null,
        building: buildingId,
        no_of_dayPasses,
        remainingPasses: no_of_dayPasses,
        countsSelf: splitSelf,
        countsOther: splitOther,
        plannedDatesSelf: parsedDatesSelf,
        plannedDatesOther: parsedDatesOther,
        totalAmount: finalAmount,
        validFrom,
        validUntil,
        notes
      });

      await bundle.save({ session });

      // Create individual day pass records (status: pending)
      const dayPasses = [];
      
      // Create passes for "self" bookings
      for (let i = 0; i < splitSelf; i++) {
        const dayPass = new DayPass({
          customer: customerId,
          member: memberId || null,
          building: buildingId,
          bundle: bundle._id,
          date: null, // Will be set when invited
          visitDate: parsedDatesSelf[i],
          bookingFor: "self",
          expiresAt: validUntil,
          price: pricePerPass,
          status: "payment_pending",
          createdBy: req.user?._id
        });
        dayPasses.push(dayPass);
      }
      
      // Create passes for "other" bookings
      for (let i = 0; i < splitOther; i++) {
        const dayPass = new DayPass({
          customer: customerId,
          member: memberId || null,
          building: buildingId,
          bundle: bundle._id,
          date: null, // Will be set when invited
          visitDate: null, // Will be set later in manage flow
          bookingFor: "other",
          expiresAt: validUntil,
          price: pricePerPass,
          status: "payment_pending",
          createdBy: req.user?._id
        });
        dayPasses.push(dayPass);
      }

      await DayPass.insertMany(dayPasses, { session });

      // Create invoice (schema: invoiceModel.js)
      const invoice = new Invoice({
        client: customerType === 'client' ? customerId : null,
        guest: customerType !== 'client' ? customerId : null,
        building: buildingId,
        type: "regular",
        category: "day_pass",
        invoice_number: `DPB-${Date.now()}`,
        line_items: [{
          description: `Day Pass Bundle - ${building.name} (${no_of_dayPasses} passes)`,
          quantity: no_of_dayPasses,
          unitPrice: pricePerPass,
          amount: totalAmount,
          rate: pricePerPass
        }],
        sub_total: totalAmount,
        tax_total: taxAmount,
        total: finalAmount,
        status: "draft",
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });

      await invoice.save({ session });

      // Link invoice to bundle
      bundle.invoice = invoice._id;
      await bundle.save({ session });

      await session.commitTransaction();

      // Populate response data
      await bundle.populate([
        { path: 'customer', select: 'name email phone' },
        { path: 'building', select: 'name address openSpacePricing' },
        { path: 'invoice', select: 'invoice_number total status' }
      ]);

      res.status(201).json({
        message: "Day pass bundle created successfully",
        bundle,
        dayPassesCreated: no_of_dayPasses,
        invoice: {
          id: invoice._id,
          invoice_number: invoice.invoice_number,
          total: invoice.total,
          status: invoice.status
        },
        payment: {
          required: true,
          amount: finalAmount
        }
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("createDayPassBundle error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get user's bundles
export const getUserBundles = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { customer: customerId };
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    const bundles = await DayPassBundle.find(query)
      .populate('customer', 'name email phone')
      .populate('building', 'name address openSpacePricing')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await DayPassBundle.countDocuments(query);

    res.json({
      bundles,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + bundles.length < total
      }
    });

  } catch (error) {
    console.error("getUserBundles error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get bundle details with day passes
export const getBundleDetails = async (req, res) => {
  try {
    const { bundleId } = req.params;

    const bundle = await DayPassBundle.findById(bundleId)
      .populate('customer', 'name email phone')
      .populate('building', 'name address openSpacePricing')
      .populate('invoice', 'invoiceNumber totalAmount status');

    if (!bundle) {
      return res.status(404).json({ error: "Bundle not found" });
    }

    // Get associated day passes
    const dayPasses = await DayPass.find({ bundle: bundleId })
      .sort({ createdAt: 1 });

    res.json({
      bundle,
      dayPasses,
      summary: {
        totalPasses: bundle.no_of_dayPasses,
        remainingPasses: bundle.remainingPasses,
        usedPasses: bundle.no_of_dayPasses - bundle.remainingPasses,
        validUntil: bundle.validUntil,
        isExpired: new Date() > bundle.validUntil
      }
    });

  } catch (error) {
    console.error("getBundleDetails error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Cancel bundle
export const cancelBundle = async (req, res) => {
  try {
    const { bundleId } = req.params;
    const { reason } = req.body;

    const bundle = await DayPassBundle.findById(bundleId);
    if (!bundle) {
      return res.status(404).json({ error: "Bundle not found" });
    }

    if (bundle.status === "cancelled") {
      return res.status(400).json({ error: "Bundle is already cancelled" });
    }

    if (bundle.status === "completed") {
      return res.status(400).json({ error: "Cannot cancel completed bundle" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update bundle status
      bundle.status = "cancelled";
      bundle.notes = bundle.notes ? `${bundle.notes}\nCancelled: ${reason}` : `Cancelled: ${reason}`;
      await bundle.save({ session });

      // Cancel all pending day passes
      await DayPass.updateMany(
        { bundle: bundleId, status: "pending" },
        { status: "cancelled" },
        { session }
      );

      await session.commitTransaction();

      res.json({
        message: "Bundle cancelled successfully",
        bundle
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("cancelBundle error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Admin: Get all bundles
export const getAllBundles = async (req, res) => {
  try {
    const { 
      status, 
      buildingId, 
      customerId,
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (buildingId) query.building = buildingId;
    if (customerId) query.customer = customerId;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const bundles = await DayPassBundle.find(query)
      .populate('customer', 'name email phone')
      .populate('building', 'name address')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await DayPassBundle.countDocuments(query);

    res.json({
      bundles,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + bundles.length < total
      }
    });

  } catch (error) {
    console.error("getAllBundles error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
