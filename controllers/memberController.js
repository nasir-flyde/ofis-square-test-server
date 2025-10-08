import Member from "../models/memberModel.js";
import Building from "../models/buildingModel.js";
import Cabin from "../models/cabinModel.js";
import Client from "../models/clientModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// Create a new member
export const createMember = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, companyName, role, client, status } = req.body || {};
    
    if (!firstName) {
      return res.status(400).json({ success: false, message: "firstName is required" });
    }

    // Validate client exists if provided
    if (client) {
      const clientExists = await Client.findById(client);
      if (!clientExists) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
    }

    let createdUserId = null;

    // Create User record if email is provided
    if (email) {
      try {
        // Find or create default "member" role
        let memberRole = await Role.findOne({ roleName: "member" });
        if (!memberRole) {
          memberRole = await Role.create({
            roleName: "member",
            description: "Default member role with basic access",
            canLogin: true,
            permissions: ["member:read", "member:profile"]
          });
        }
        const defaultPassword = "123456";

        const userData = {
          name: `${firstName} ${lastName || ''}`.trim(),
          email: email,
          phone: phone || `temp_${Date.now()}`,
          password: defaultPassword,
          role: memberRole._id
        };

        const createdUser = await User.create(userData);
        createdUserId = createdUser._id;

        console.log(`Created user for member: ${email} with default password: ${defaultPassword}`);
      } catch (userErr) {
        console.warn("Failed to create user for member:", userErr.message);
        // Continue with member creation even if user creation fails
      }
    }

    const name = `${firstName} ${lastName || ''}`.trim();
    const clientId = client || null;
    const buildingId = null;
    const cabinId = null;

    const member = await Member.create({
      firstName,
      lastName,
      email,
      phone,
      companyName,
      role,
      client: clientId,
      desk: null, // Will be assigned later when desk is allocated
      status: 'active',
      user: createdUserId
    });

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'Member', member._id, null, {
      memberName: name,
      email,
      clientId,
      buildingId,
      cabinId
    });

    res.status(201).json({
      success: true,
      message: 'Member created successfully',
      data: member
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getMembers = async (req, res) => {
  try {
    const { client, status, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (client) filter.client = client;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    
    const members = await Member.find(filter)
      .populate('client', 'companyName contactPerson')
      .populate('desk', 'number floor building')
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: members,
      count: members.length
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get member by ID
export const getMemberById = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id)
      .populate('client', 'companyName contactPerson')
      .populate('desk', 'number floor building')
      .populate('user', 'name email');
    
    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    return res.json({ success: true, data: member });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Update member
export const updateMember = async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body || {};

    const oldMember = await Member.findById(id);
    const member = await Member.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('client', 'companyName contactPerson')
      .populate('desk', 'number floor building')
      .populate('user', 'name email');

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Member', id, {
      before: oldMember?.toObject(),
      after: member.toObject(),
      fields: Object.keys(updateData)
    }, {
      memberName: member.name,
      updatedFields: Object.keys(updateData)
    });

    res.json({
      success: true,
      message: 'Member updated successfully',
      data: member
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Delete member
export const deleteMember = async (req, res) => {
  try {
    const id = req.params.id;
    const member = await Member.findByIdAndDelete(id);

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'DELETE', 'Member', id, null, {
      memberName: member.name,
      email: member.email
    });

    res.json({
      success: true,
      message: 'Member deleted successfully'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get comprehensive member profile
export const getMemberProfile = async (req, res) => {
  try {
    const memberId = req.memberId || req.member?._id || req.user?.memberId || req.params.id;

    if (!memberId) {
      console.log('No memberId found in request');
      return res.status(400).json({ 
        success: false, 
        message: "Member ID is required. Please login as a member.",
        debug: {
          hasMemberId: !!req.memberId,
          hasMember: !!req.member,
          hasUser: !!req.user,
          authType: req.authType
        }
      });
    }

    // Find member with populated client details
    const member = await Member.findById(memberId)
      .populate({
        path: 'client',
        select: 'companyName contactPerson email phone billingAddress shippingAddress'
      })
      .populate({
        path: 'desk',
        select: 'number floor',
        populate: {
          path: 'building',
          select: 'name address'
        }
      })
      .populate('user', 'name email phone');

    if (!member) {
      return res.status(404).json({ 
        success: false, 
        message: "Member not found" 
      });
    }

    // Get credit balance
    let creditBalance = null;
    if (member.client && member.allowedUsingCredits) {
      const ClientCreditWallet = (await import("../models/clientCreditWalletModel.js")).default;
      const wallet = await ClientCreditWallet.findOne({ 
        client: member.client._id,
        status: 'active'
      });
      
      if (wallet) {
        creditBalance = {
          balance: wallet.balance,
          creditValue: wallet.creditValue,
          totalValue: wallet.balance * wallet.creditValue,
          currency: wallet.currency,
          expiresAt: wallet.expiresAt
        };
      }
    }

    // Get meeting room bookings
    const MeetingBooking = (await import("../models/meetingBookingModel.js")).default;
    const meetingBookings = await MeetingBooking.find({ 
      member: memberId,
      status: { $in: ['booked', 'payment_pending', 'completed'] }
    })
      .populate('room', 'name capacity amenities')
      .populate('visitors', 'name email phone company')
      .sort({ start: -1 })
      .limit(20);

    // Get events (RSVPs and attendance)
    const Event = (await import("../models/eventModel.js")).default;
    const rsvpEvents = await Event.find({
      rsvps: memberId,
      status: { $in: ['published', 'completed'] }
    })
      .populate('category', 'name color')
      .populate('location.building', 'name address')
      .populate('location.room', 'name')
      .sort({ startDate: -1 })
      .limit(20);

    const attendedEvents = await Event.find({
      attendance: memberId,
      status: 'completed'
    })
      .populate('category', 'name color')
      .populate('location.building', 'name address')
      .populate('location.room', 'name')
      .sort({ startDate: -1 })
      .limit(20);

    // Build profile response
    const profile = {
      member: {
        id: member._id,
        firstName: member.firstName,
        lastName: member.lastName,
        name: `${member.firstName} ${member.lastName || ''}`.trim(),
        email: member.email,
        phone: member.phone,
        role: member.role,
        status: member.status,
        allowedUsingCredits: member.allowedUsingCredits,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      },
      company: member.client ? {
        id: member.client._id,
        name: member.client.companyName,
        contactPerson: member.client.contactPerson,
        email: member.client.email,
        phone: member.client.phone,
        billingAddress: member.client.billingAddress,
        shippingAddress: member.client.shippingAddress
      } : null,
      desk: member.desk ? {
        number: member.desk.number,
        floor: member.desk.floor,
        building: member.desk.building ? {
          name: member.desk.building.name,
          address: member.desk.building.address
        } : null
      } : null,
      creditBalance: creditBalance,
      meetingBookings: {
        total: meetingBookings.length,
        bookings: meetingBookings.map(booking => ({
          id: booking._id,
          room: booking.room ? {
            name: booking.room.name,
            capacity: booking.room.capacity,
            amenities: booking.room.amenities
          } : null,
          visitors: booking.visitors,
          start: booking.start,
          end: booking.end,
          status: booking.status,
          amount: booking.amount,
          currency: booking.currency,
          amenitiesRequested: booking.amenitiesRequested,
          notes: booking.notes,
          createdAt: booking.createdAt
        }))
      },
      events: {
        rsvps: {
          total: rsvpEvents.length,
          events: rsvpEvents.map(event => ({
            id: event._id,
            title: event.title,
            description: event.description,
            category: event.category,
            startDate: event.startDate,
            endDate: event.endDate,
            location: event.location,
            capacity: event.capacity,
            rsvpCount: event.rsvpCount,
            creditsRequired: event.creditsRequired,
            status: event.status
          }))
        },
        attended: {
          total: attendedEvents.length,
          events: attendedEvents.map(event => ({
            id: event._id,
            title: event.title,
            description: event.description,
            category: event.category,
            startDate: event.startDate,
            endDate: event.endDate,
            location: event.location,
            creditsRequired: event.creditsRequired,
            status: event.status
          }))
        }
      }
    };

    res.json({
      success: true,
      data: profile
    });

  } catch (err) {
    console.error('Get member profile error:', err);
    await logErrorActivity(req, 'GET_MEMBER_PROFILE', err.message, {
      memberId: req.params.id
    });
    return res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};
