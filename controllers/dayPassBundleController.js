import DayPassBundle from "../models/dayPassBundleModel.js";
import DayPass from "../models/dayPassModel.js";
import Building from "../models/buildingModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import Payment from "../models/paymentModel.js";
import mongoose from "mongoose";
import crypto from "crypto";
import { sendNotification } from "../utils/notificationHelper.js";
import DayPassDailyUsage from "../models/dayPassDailyUsageModel.js";
import loggedRazorpay from "../utils/loggedRazorpay.js";


// Create a new day pass bundle
export const createDayPassBundle = async (req, res) => {
  try {
    let {
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

    // Automate customerId from token if not provided
    if (!customerId && req.user) {
      if (req.user.guestId) {
        customerId = req.user.guestId;
      } else if (req.user.memberId) {
        customerId = req.user.memberId;
      }
    }

    // Automate memberId from token if not provided
    if (!memberId && req.user && req.user.memberId) {
      memberId = req.user.memberId;
    }

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

    // Attach buildingId to guest table for ondemanduser role
    if (req.user?.roleName?.toLowerCase() === 'ondemanduser' && customerType === 'guest') {
      try {
        await Guest.findByIdAndUpdate(customerId, { buildingId: buildingId });
      } catch (updateErr) {
        console.warn("Failed to attach buildingId to guest record:", updateErr.message);
        // Non-blocking: proceed with bundle creation even if guest update fails
      }
    }

    // Verify building exists and get pricing
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }

    // Resolve price per pass from building (single-key capacity model)
    const pricePerPass = Number(building.openSpacePricing) || 0;
    if (!pricePerPass) {
      return res.status(400).json({ error: 'Day pass price not configured for this building' });
    }
    const baseAmount = pricePerPass * no_of_dayPasses;
    const gstRate = 18; // Apply 18% GST
    const taxAmount = Math.round(((baseAmount * gstRate) / 100) * 100) / 100;
    const finalAmount = Math.round(((baseAmount + taxAmount)) * 100) / 100;

    // Server-side capacity pre-check for provided self dates (no reservation here)
    const cap = Number(building.dayPassDailyCapacity || 0);
    if (cap > 0 && splitSelf > 0) {
      // Build a per-date count map from datesSelf
      const dateCounts = {};
      for (const ds of parsedDatesSelf) {
        const d = new Date(ds);
        d.setHours(0, 0, 0, 0);
        const key = d.toISOString();
        dateCounts[key] = (dateCounts[key] || 0) + 1;
      }
      // Check each date against existing usage: seats (bundle/seat-based) + bookedCount (partner counter)
      for (const [iso, reqCount] of Object.entries(dateCounts)) {
        const usages = await DayPassDailyUsage.find({ building: buildingId, date: new Date(iso) })
          .select('seats bookedCount')
          .lean();
        const booked = (usages || []).reduce((sum, u) => sum + (Number(u.seats) || 0) + (Number(u.bookedCount) || 0), 0);
        if (booked + reqCount > cap) {
          return res.status(409).json({
            error: 'Insufficient capacity for one or more selected dates',
            details: { date: iso.slice(0, 10), capacity: cap, requested: reqCount, booked, remaining: Math.max(0, cap - booked) }
          });
        }
      }
    }

    // Set validity dates
    const validFrom = new Date();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validityDays);

    // If attempting credit payment, enforce member credit usage permission
    const requestedPaymentMethod = (req.body?.paymentMethod || '').toLowerCase();
    if (requestedPaymentMethod === 'credits') {
      // Determine member to check: prefer explicit memberId; else if customer is a member
      const memberLookupId = memberId || (customerType === 'member' ? customerId : null);
      if (memberLookupId) {
        try {
          const m = await Member.findById(memberLookupId).select('allowedUsingCredits status');
          if (!m) {
            return res.status(404).json({ error: 'Member not found for credit payment' });
          }
          if (m.status !== 'active') {
            return res.status(403).json({ error: 'Member is inactive', code: 'MEMBER_INACTIVE' });
          }
          if (m.allowedUsingCredits === false) {
            return res.status(403).json({ error: 'This member is not allowed to use credits', code: 'CREDITS_NOT_ALLOWED' });
          }
        } catch (e) {
          return res.status(500).json({ error: 'Failed to validate member credit permission' });
        }
      }
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // We will not upsert counters without a dayPass. Instead, we'll create per-pass usage docs after creating day passes.

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

      // After creating self day passes, record usage per date with seats equal to the number of passes
      if (splitSelf > 0 && parsedDatesSelf.length > 0) {
        // Group required additions per date for capacity validation within the transaction
        const incCounts = {};
        const selfPasses = dayPasses.filter(dp => dp.bookingFor === 'self');
        for (const dp of selfPasses) {
          const d = new Date(dp.visitDate);
          d.setHours(0, 0, 0, 0);
          const key = d.toISOString();
          incCounts[key] = (incCounts[key] || 0) + 1;
        }
        // Validate capacity against current usage: seats + bookedCount
        if (cap > 0) {
          for (const [iso, add] of Object.entries(incCounts)) {
            const usages = await DayPassDailyUsage.find({ building: buildingId, date: new Date(iso) })
              .select('seats bookedCount')
              .session(session)
              .lean();
            const booked = (usages || []).reduce((sum, u) => sum + (Number(u.seats) || 0) + (Number(u.bookedCount) || 0), 0);
            if (booked + add > cap) {
              const err = new Error('Capacity exceeded for selected date');
              err.status = 409;
              err.details = { date: iso.slice(0, 10), capacity: cap, requested: add, booked, remaining: Math.max(0, cap - booked) };
              throw err;
            }
          }
        }
        // Upsert a single usage row per date for this bundle, incrementing seats by the count
        for (const [iso, add] of Object.entries(incCounts)) {
          await DayPassDailyUsage.findOneAndUpdate(
            { building: buildingId, date: new Date(iso), bundle: bundle._id },
            { $inc: { seats: add } },
            { upsert: true, new: true, setDefaultsOnInsert: true, session }
          );
        }
      }
      const paymentMethod = (req.body?.paymentMethod || '').toLowerCase();
      let invoice = null;
      if (paymentMethod !== 'credits') {
        // Create invoice (schema: invoiceModel.js)
        const clientIdForInvoice = req.user?.clientId || (customerType === 'client' ? customerId : null);
        invoice = new Invoice({
          client: clientIdForInvoice,
          guest: clientIdForInvoice ? null : (customerType !== 'client' ? customerId : null),
          building: buildingId,
          type: "regular",
          category: "day_pass",
          invoice_number: `DPB-${Date.now()}`,
          line_items: [{
            description: `Day Pass Bundle - ${building.name} (${no_of_dayPasses} passes)`,
            quantity: no_of_dayPasses,
            unitPrice: pricePerPass,
            amount: baseAmount,
            rate: pricePerPass,
            tax_percentage: gstRate
          }],
          sub_total: baseAmount,
          tax_total: taxAmount,
          total: finalAmount,
          status: "draft",
          due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        await invoice.save({ session });

        // Link invoice to bundle
        bundle.invoice = invoice._id;
        await bundle.save({ session });
      }

      await session.commitTransaction();

      // Populate response data
      await bundle.populate([
        { path: 'customer', select: 'name email phone' },
        { path: 'building', select: 'name address openSpacePricing' },
        { path: 'invoice', select: 'invoice_number total status' }
      ]);

      // Notify booking customer - Day Pass Bundle booking confirmed
      try {
        const to = {};
        if (bundle.customer?.email) to.email = bundle.customer.email;
        // We can optionally associate clientId in future if available
        if (to.email) {
          await sendNotification({
            to,
            channels: { email: true, sms: false },
            templateKey: 'day_pass_booking_confirmed',
            templateVariables: {
              buildingName: bundle.building?.name,
              passes: bundle.no_of_dayPasses,
              validFrom: bundle.validFrom?.toISOString()?.slice(0, 10),
              validUntil: bundle.validUntil?.toISOString()?.slice(0, 10),
              bundleId: String(bundle._id)
            },
            title: 'Day Pass Bundle Booking Confirmed',
            metadata: {
              category: 'day_pass',
              tags: ['day_pass_booking_confirmed', 'bundle'],
              route: `/day-pass-bundles/${bundle._id}`,
              deepLink: `ofis://day-pass-bundles/${bundle._id}`,
              routeParams: { id: String(bundle._id) }
            },
            source: 'system',
            type: 'transactional'
          });
        }
      } catch (notifyErr) {
        console.warn('createDayPassBundle: failed to send day_pass_booking_confirmed notification:', notifyErr?.message || notifyErr);
      }

      const resp = {
        message: "Day pass bundle created successfully",
        bundle,
        dayPassesCreated: no_of_dayPasses,
        payment: {
          required: paymentMethod !== 'credits',
          amount: finalAmount
        }
      };
      if (invoice) {
        resp.invoice = {
          id: invoice._id,
          invoice_number: invoice.invoice_number,
          total: invoice.total,
          status: invoice.status
        };
      }
      if (paymentMethod !== 'credits') {
        resp.razorpayConfig = {
          key: process.env.RAZORPAY_KEY_ID || 'rzp_test_02U4mUmreLeYrU',
          amount: finalAmount * 100, // Razorpay expects amount in paise
          currency: 'INR',
          name: 'Ofis Square',
          description: `Day Pass Bundle - ${building.name} (${no_of_dayPasses} passes)`,
          prefill: {
            name: customer.name || customer.companyName,
            email: customer.email,
            contact: customer.phone
          },
          theme: { color: '#3399cc' }
        };

        // Create actual Razorpay order
        try {
          const rzpOrder = await loggedRazorpay.createOrder({
            amount: finalAmount * 100,
            currency: 'INR',
            receipt: `receipt_bundle_${bundle._id}`
          }, {
            userId: req.user?._id,
            clientId: bundle.customer?.constructor.modelName === 'Client' ? bundle.customer?._id : (req.user?.clientId || null),
            relatedEntity: 'DayPassBundle',
            relatedEntityId: bundle._id
          });
          resp.razorpayConfig.order_id = rzpOrder.id;
        } catch (rzpErr) {
          console.error("Failed to create Razorpay order for Bundle:", rzpErr);
          return res.status(500).json({
            error: "Failed to initialize Razorpay payment",
            reason: rzpErr.message,
            message: "A valid Razorpay order could not be created for this bundle. Please check backend credentials."
          });
        }

      }
      res.status(201).json(resp);

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
