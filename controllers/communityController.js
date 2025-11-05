import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Cabin from "../models/cabinModel.js";
import Ticket from "../models/ticketModel.js";
import Invoice from "../models/invoiceModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Visitor from "../models/visitorModel.js";
import Event from "../models/eventModel.js";
import EventCategory from "../models/eventCategoryModel.js";
import mongoose from "mongoose";
import { logActivity } from "../utils/activityLogger.js";

export const getCommunityDashboard = async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get today's visitors from visitor model
    const todayVisitors = await Visitor.countDocuments({
      checkInTime: {
        $gte: startOfDay,
        $lt: endOfDay
      }
    });

    // Get active clients (clients with active meeting bookings)
    const activeMeetingBookings = await MeetingBooking.find({
      status: 'confirmed',
      date: {
        $gte: startOfDay,
        $lt: endOfDay
      }
    }).populate('client');
    
    const activeClients = new Set(activeMeetingBookings.map(booking => booking.client?._id?.toString())).size;

    // Get available meeting rooms/cabins
    const totalCabins = await Cabin.countDocuments();
    const occupiedCabins = await MeetingBooking.countDocuments({
      status: 'confirmed',
      date: {
        $gte: startOfDay,
        $lt: endOfDay
      }
    });
    const availableRooms = Math.max(0, totalCabins - occupiedCabins);

    // Get upcoming events this week (using meeting bookings as events)
    const upcomingEvents = await MeetingBooking.countDocuments({
      date: {
        $gte: today,
        $lt: endOfWeek
      },
      status: 'confirmed'
    });

    // Get open tickets
    const openTickets = await Ticket.countDocuments({
      status: { $in: ['open', 'in_progress'] }
    });

    // Mock inventory items count (since we don't have an inventory model yet)
    const inventoryItems = 342;

    // Get recent activity
    const recentMeetingBookings = await MeetingBooking.find({
      createdAt: {
        $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
      }
    })
    .populate('client', 'contactPerson')
    .populate('room', 'name')
    .sort({ createdAt: -1 })
    .limit(5);

    const recentTickets = await Ticket.find({
      createdAt: {
        $gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    })
    .populate('client', 'contactPerson')
    .sort({ createdAt: -1 })
    .limit(3);

    const recentVisitors = await Visitor.find({
      checkInTime: {
        $gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    })
    .sort({ checkInTime: -1 })
    .limit(3);

    // Format recent activity
    const recentActivity = [];
    
    // Add meeting booking activities
    recentMeetingBookings.forEach(booking => {
      recentActivity.push({
        type: 'booking',
        title: `Meeting room booked by ${booking.client?.contactPerson || 'Unknown Client'} - ${booking.room?.name || 'Meeting Room'}`,
        timestamp: booking.createdAt
      });
    });

    // Add ticket activities
    recentTickets.forEach(ticket => {
      recentActivity.push({
        type: 'ticket',
        title: `New support ticket: ${ticket.subject || 'Support Request'}`,
        timestamp: ticket.createdAt
      });
    });

    // Add visitor activities
    recentVisitors.forEach(visitor => {
      recentActivity.push({
        type: 'visitor',
        title: `Visitor checked in: ${visitor.name || 'Guest'}`,
        timestamp: visitor.checkInTime
      });
    });

    // Sort by timestamp and limit
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedActivity = recentActivity.slice(0, 10);

    const dashboardData = {
      stats: {
        totalVisitors: todayVisitors,
        activeClients: activeClients,
        availableRooms: Math.max(0, availableRooms),
        upcomingEvents: upcomingEvents,
        openTickets: openTickets,
        inventoryItems: inventoryItems
      },
      recentActivity: limitedActivity
    };
    
    // Log dashboard access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'view',
      resource: 'community_dashboard',
      resourceId: null,
      details: { stats: dashboardData.stats },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error("Community dashboard error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch community dashboard data"
    });
  }
};

// Publish an event (community - only if event belongs to member's building)
export const publishCommunityEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });
    if (!event.location?.building || event.location.building.toString() !== buildingId.toString()) {
      return res.status(403).json({ success: false, error: 'Not allowed to publish this event' });
    }

    event.status = 'published';
    await event.save();

    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'publish',
      resource: 'community_event',
      resourceId: id,
      details: { title: event.title },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({ success: true, data: event });
  } catch (err) {
    console.error('publishCommunityEvent error:', err);
    return res.status(500).json({ success: false, error: 'Failed to publish event' });
  }
};

// List clients for community users with lightweight aggregates
export const getCommunityClients = async (req, res) => {
  try {
    const clients = await Client.aggregate([
      {
        $lookup: {
          from: "contracts",
          localField: "_id",
          foreignField: "client",
          as: "contracts"
        }
      },
      {
        $addFields: {
          hasActiveContract: {
            $gt: [
              {
                $size: {
                  $filter: { input: "$contracts", cond: { $eq: ["$$this.status", "active"] } }
                }
              },
              0
            ]
          }
        }
      },
      { $project: { contracts: 0 } },
      { $sort: { createdAt: -1 } }
    ]);

    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'list',
      resource: 'clients',
      resourceId: null,
      details: { count: clients.length },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({ success: true, data: clients });
  } catch (err) {
    console.error("getCommunityClients error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
};

export const getCommunityClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ success: false, error: "Client not found" });
    
    // Log client view
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'view',
      resource: 'client',
      resourceId: id,
      details: { clientName: client.companyName },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    return res.json({ success: true, data: client });
  } catch (err) {
    console.error("getCommunityClientById error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch client" });
  }
};

// Get members for a client for community users
export const getCommunityClientMembers = async (req, res) => {
  try {
    const { id } = req.params; // client id
    const { page = 1, limit = 20, status } = req.query;
    const query = { client: id };
    if (status) query.status = status;

    const members = await Member.find(query)
      .populate("desk", "number status building cabin")
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Member.countDocuments(query);

    // Log client members access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'list',
      resource: 'client_members',
      resourceId: id,
      details: { memberCount: members.length, page, limit },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: {
        members,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (err) {
    console.error("getCommunityClientMembers error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch members" });
  }
};

export const getCommunityStats = async (req, res) => {
  try {
    const { period = '30' } = req.query; // days
    const daysBack = parseInt(period);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // Get stats for the specified period
    const totalClients = await Client.countDocuments({
      createdAt: { $gte: startDate }
    });

    const totalBookings = await MeetingBooking.countDocuments({
      createdAt: { $gte: startDate }
    });

    const totalTickets = await Ticket.countDocuments({
      createdAt: { $gte: startDate }
    });

    const resolvedTickets = await Ticket.countDocuments({
      createdAt: { $gte: startDate },
      status: 'resolved'
    });

    const totalRevenue = await Invoice.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' }
        }
      }
    ]);

    const statsData = {
      period: `${daysBack} days`,
      totalClients,
      totalBookings,
      totalTickets,
      resolvedTickets,
      ticketResolutionRate: totalTickets > 0 ? ((resolvedTickets / totalTickets) * 100).toFixed(1) : 0,
      totalRevenue: totalRevenue[0]?.total || 0
    };

    // Log stats access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'view',
      resource: 'community_stats',
      resourceId: null,
      details: { period: daysBack, ...statsData },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: statsData
    });

  } catch (error) {
    console.error("Community stats error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch community stats"
    });
  }
};

// Get building-specific tickets for community users
export const getCommunityTickets = async (req, res) => {
  try {
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    const { page = 1, limit = 20, status, priority, search } = req.query;
    
    const filter = { building: buildingId };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { ticketId: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const tickets = await Ticket.find(filter)
      .populate('building', 'name address')
      .populate('cabin', 'name')
      .populate('assignedTo', 'name email')
      .populate('client', 'contactPerson companyName')
      .populate('category.categoryId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Ticket.countDocuments(filter);

    // Log tickets access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'list',
      resource: 'community_tickets',
      resourceId: buildingId,
      details: { ticketCount: tickets.length, buildingId, filters: { status, priority, search } },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getCommunityTickets error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch tickets" });
  }
};

// Get building-specific clients for community users
export const getCommunityBuildingClients = async (req, res) => {
  try {
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    const { page = 1, limit = 20, search } = req.query;
    
    // Find clients who have members in this building or have tickets/bookings in this building
    const filter = {
      $or: [
        // Clients with members in this building
        { 
          _id: { 
            $in: await Member.distinct('client', { 
              desk: { 
                $in: await mongoose.model('Desk').distinct('_id', { building: buildingId })
              }
            })
          }
        },
        // Clients with tickets in this building
        {
          _id: {
            $in: await Ticket.distinct('client', { building: buildingId })
          }
        },
        // Clients with meeting bookings in this building
        {
          _id: {
            $in: await MeetingBooking.distinct('client', { 
              room: {
                $in: await mongoose.model('MeetingRoom').distinct('_id', { building: buildingId })
              }
            })
          }
        }
      ]
    };

    if (search) {
      filter.$and = [
        { $or: filter.$or },
        {
          $or: [
            { contactPerson: { $regex: search, $options: 'i' } },
            { companyName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } }
          ]
        }
      ];
      delete filter.$or;
    }

    const skip = (page - 1) * limit;
    
    const clients = await Client.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Client.countDocuments(filter);

    // Log building clients access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'list',
      resource: 'building_clients',
      resourceId: buildingId,
      details: { clientCount: clients.length, buildingId, search },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: {
        clients,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getCommunityBuildingClients error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
};

// Get building-specific inventory items for community users
export const getCommunityInventory = async (req, res) => {
  try {
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    // Import Building model
    const Building = mongoose.model('Building');
    
    // Get building details
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ success: false, error: "Building not found" });
    }

    // Get all cabins for this building with populated data
    const cabins = await Cabin.find({ building: buildingId })
      .populate('allocatedTo', 'companyName contactPerson')
      .populate('contract', 'status startDate endDate')
      .populate('desks', 'number status')
      .sort({ floor: 1, number: 1 });

    // Calculate stats
    const stats = {
      totalCabins: cabins.length,
      available: cabins.filter(c => c.status === 'available').length,
      occupied: cabins.filter(c => c.status === 'occupied').length,
      maintenance: cabins.filter(c => c.status === 'maintenance').length,
      totalDesks: cabins.reduce((sum, cabin) => sum + (cabin.desks?.length || 0), 0)
    };

    // Log inventory access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'view',
      resource: 'community_inventory',
      resourceId: buildingId,
      details: { buildingId, stats },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: {
        building,
        cabins,
        stats
      }
    });
  } catch (err) {
    console.error("getCommunityInventory error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch inventory" });
  }
};

// Get building-specific events for community members
export const getCommunityEvents = async (req, res) => {
  try {
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    const { page = 1, limit = 20, status, category, search } = req.query;
    
    // Filter events by building and status
    const filter = { 
      'location.building': buildingId,
    };
    
    if (status && status !== 'all') filter.status = status;
    if (category && category !== 'all') filter.category = category;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const events = await Event.find(filter)
      .populate('category', 'name')
      .populate('location.building', 'name address')
      .populate('location.room', 'name')
      .populate('createdBy', 'name email')
      .sort({ startDate: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Event.countDocuments(filter);

    // Log events access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'list',
      resource: 'community_events',
      resourceId: buildingId,
      details: { eventCount: events.length, buildingId, filters: { status, category, search } },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: events
    });
  } catch (err) {
    console.error("getCommunityEvents error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch events" });
  }
};

// Get event categories for community members
export const getCommunityEventCategories = async (req, res) => {
  try {
    const categories = await EventCategory.find({ status: 'active' })
      .sort({ name: 1 });

    // Log categories access
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'list',
      resource: 'event_categories',
      resourceId: null,
      details: { categoryCount: categories.length },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: categories
    });
  } catch (err) {
    console.error("getCommunityEventCategories error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch event categories" });
  }
};

// Get single event details with RSVP information
export const getCommunityEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.memberId;

    const event = await Event.findById(id)
      .populate('category', 'name')
      .populate('location.building', 'name address')
      .populate('location.room', 'name')
      .populate('createdBy', 'name email')
      .populate('rsvps', 'firstName lastName email phone companyName')
      .populate('attendance', 'firstName lastName email phone companyName');

    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }

    // Check if user has RSVPed
    const hasRsvped = event.rsvps.some(rsvp => rsvp._id.toString() === memberId);

    // Log event view
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'view',
      resource: 'community_event',
      resourceId: id,
      details: { eventTitle: event.title, hasRsvped },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      data: { ...event.toObject(), hasRsvped }
    });
  } catch (err) {
    console.error("getCommunityEventById error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch event details" });
  }
};

// RSVP to an event
export const rsvpToEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.memberId;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }

    // Check if event is published
    if (event.status !== 'published') {
      return res.status(400).json({ success: false, error: "Cannot RSVP to unpublished event" });
    }

    // Check if already RSVPed
    if (event.rsvps.includes(memberId)) {
      return res.status(400).json({ success: false, error: "Already RSVPed to this event" });
    }

    // Check capacity
    if (event.capacity > 0 && event.rsvps.length >= event.capacity) {
      return res.status(400).json({ success: false, error: "Event is at full capacity" });
    }

    // Add RSVP
    event.rsvps.push(memberId);
    await event.save();

    // Log RSVP
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'rsvp',
      resource: 'community_event',
      resourceId: id,
      details: { eventTitle: event.title, action: 'join' },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      message: "Successfully RSVPed to event",
      data: { rsvpCount: event.rsvps.length }
    });
  } catch (err) {
    console.error("rsvpToEvent error:", err);
    return res.status(500).json({ success: false, error: "Failed to RSVP to event" });
  }
};

// Cancel RSVP to an event
export const cancelRsvp = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.memberId;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }

    // Check if RSVPed
    if (!event.rsvps.includes(memberId)) {
      return res.status(400).json({ success: false, error: "Not RSVPed to this event" });
    }

    // Remove RSVP
    event.rsvps = event.rsvps.filter(rsvpId => rsvpId.toString() !== memberId);
    await event.save();

    // Log RSVP cancellation
    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'rsvp',
      resource: 'community_event',
      resourceId: id,
      details: { eventTitle: event.title, action: 'cancel' },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      message: "Successfully cancelled RSVP",
      data: { rsvpCount: event.rsvps.length }
    });
  } catch (err) {
    console.error("cancelRsvp error:", err);
    return res.status(500).json({ success: false, error: "Failed to cancel RSVP" });
  }
};

// Create event (community - scoped to member's building)
export const createCommunityEvent = async (req, res) => {
  try {
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    const {
      title,
      description,
      category,
      startDate,
      endDate,
      location = {},
      capacity = 0,
      creditsRequired = 0,
      status = 'draft'
    } = req.body || {};

    if (!title || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: "title, startDate and endDate are required" });
    }

    const event = await Event.create({
      title,
      description,
      category: category || undefined,
      startDate,
      endDate,
      location: {
        building: buildingId,
        room: location.room || undefined,
        address: location.address || undefined,
      },
      capacity: Number.isFinite(+capacity) ? +capacity : 0,
      creditsRequired: Number.isFinite(+creditsRequired) ? +creditsRequired : 0,
      status,
      createdBy: req.userId,
    });

    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'create',
      resource: 'community_event',
      resourceId: event._id,
      details: { title: event.title, buildingId },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({ success: true, data: event });
  } catch (err) {
    console.error('createCommunityEvent error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create event' });
  }
};

// Update event (community - only if event belongs to member's building)
export const updateCommunityEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });
    if (!event.location?.building || event.location.building.toString() !== buildingId.toString()) {
      return res.status(403).json({ success: false, error: 'Not allowed to modify this event' });
    }

    const {
      title,
      description,
      category,
      startDate,
      endDate,
      location = {},
      capacity,
      creditsRequired,
      status
    } = req.body || {};

    if (title !== undefined) event.title = title;
    if (description !== undefined) event.description = description;
    if (category !== undefined) event.category = category || undefined;
    if (startDate !== undefined) event.startDate = startDate;
    if (endDate !== undefined) event.endDate = endDate;
    if (location) {
      event.location = {
        building: buildingId, // enforce current building
        room: location.room || undefined,
        address: location.address || undefined,
      };
    }
    if (capacity !== undefined) event.capacity = Number.isFinite(+capacity) ? +capacity : 0;
    if (creditsRequired !== undefined) event.creditsRequired = Number.isFinite(+creditsRequired) ? +creditsRequired : 0;
    if (status !== undefined) event.status = status;

    await event.save();

    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'update',
      resource: 'community_event',
      resourceId: id,
      details: { title: event.title },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({ success: true, data: event });
  } catch (err) {
    console.error('updateCommunityEvent error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update event' });
  }
};

// Delete event (community - only if event belongs to member's building)
export const deleteCommunityEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, error: "Building ID not found in token" });
    }

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });
    if (!event.location?.building || event.location.building.toString() !== buildingId.toString()) {
      return res.status(403).json({ success: false, error: 'Not allowed to delete this event' });
    }

    await Event.deleteOne({ _id: id });

    await logActivity({
      userId: req.userId,
      userType: req.userType,
      action: 'delete',
      resource: 'community_event',
      resourceId: id,
      details: { title: event.title },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({ success: true, message: 'Event deleted' });
  } catch (err) {
    console.error('deleteCommunityEvent error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete event' });
  }
};
