import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Cabin from "../models/cabinModel.js";
import Ticket from "../models/ticketModel.js";
import Invoice from "../models/invoiceModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Visitor from "../models/visitorModel.js";
import mongoose from "mongoose";

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

// List clients for community users with lightweight aggregates
export const getCommunityClients = async (_req, res) => {
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

    return res.json({ success: true, data: clients });
  } catch (err) {
    console.error("getCommunityClients error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
};

// Get a single client's details for community users
export const getCommunityClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ success: false, error: "Client not found" });
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

    res.json({
      success: true,
      data: {
        period: `${daysBack} days`,
        totalClients,
        totalBookings,
        totalTickets,
        resolvedTickets,
        ticketResolutionRate: totalTickets > 0 ? ((resolvedTickets / totalTickets) * 100).toFixed(1) : 0,
        totalRevenue: totalRevenue[0]?.total || 0
      }
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

    // Since there's no inventory model yet, return a placeholder response
    // This can be updated when inventory model is created
    return res.json({
      success: true,
      data: {
        items: [],
        message: "Inventory system not yet implemented for this building"
      }
    });
  } catch (err) {
    console.error("getCommunityInventory error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch inventory" });
  }
};
