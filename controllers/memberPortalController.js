import Member from "../models/memberModel.js";
import Ticket from "../models/ticketModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Notification from "../models/notificationModel.js";

// Member Dashboard API - Get dashboard stats and recent activity
export const getMemberDashboard = async (req, res) => {
  try {
    const memberId = req.memberId;
    const clientId = req.clientId;

    if (!memberId || !clientId) {
      return res.status(400).json({ error: "Member ID or Client ID not found in token" });
    }

    // Get member info with desk details
    const member = await Member.findById(memberId)
      .populate({
        path: 'desk',
        populate: [
          { path: 'cabin', select: 'name number' },
          { path: 'building', select: 'name address' }
        ]
      })
      .populate('client', 'name email');

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    // Get active bookings count
    const activeBookings = await MeetingBooking.countDocuments({
      member: memberId,
      client: clientId,
      status: { $in: ["confirmed", "active"] }
    });

    // Get open tickets count
    const openTickets = await Ticket.countDocuments({
      createdBy: memberId,
      client: clientId,
      status: { $in: ["open", "inprogress", "pending"] }
    });

    // Get unread notifications count
    const unreadNotifications = await Notification.countDocuments({
      member: memberId,
      client: clientId,
      read: false
    });

    // Get recent activity
    const recentBookings = await MeetingBooking.find({ 
      member: memberId,
      client: clientId 
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate('room', 'name')
      .select('room status start createdAt');

    const recentTickets = await Ticket.find({ 
      createdBy: memberId,
      client: clientId 
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('subject status priority createdAt');

    const recentNotifications = await Notification.find({
      member: memberId,
      client: clientId
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('title message read createdAt');

    // Format recent activity
    const recentActivity = [];

    recentBookings.forEach(booking => {
      recentActivity.push({
        type: 'booking',
        title: `Meeting Room: ${booking.room?.name || 'Unknown'}`,
        description: `Status: ${booking.status}`,
        timestamp: booking.createdAt,
        status: booking.status
      });
    });

    recentTickets.forEach(ticket => {
      recentActivity.push({
        type: 'ticket',
        title: ticket.subject,
        description: `Priority: ${ticket.priority}`,
        timestamp: ticket.createdAt,
        status: ticket.status
      });
    });

    recentNotifications.forEach(notification => {
      recentActivity.push({
        type: 'notification',
        title: notification.title,
        description: notification.message,
        timestamp: notification.createdAt,
        status: notification.read ? 'read' : 'unread'
      });
    });

    // Sort by timestamp (most recent first)
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedActivity = recentActivity.slice(0, 5);

    const dashboardData = {
      member: {
        _id: member._id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        role: member.role,
        status: member.status,
        desk: member.desk ? {
          number: member.desk.number,
          cabin: member.desk.cabin,
          building: member.desk.building,
          status: member.desk.status
        } : null
      },
      stats: {
        activeBookings,
        openTickets,
        unreadNotifications,
        deskAssigned: member.desk ? 1 : 0
      },
      recentActivity: limitedActivity
    };

    return res.json({ success: true, data: dashboardData });
  } catch (err) {
    console.error("getMemberDashboard error:", err);
    return res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};

// Get member profile with desk details
export const getMyProfile = async (req, res) => {
  try {
    const member = await Member.findById(req.memberId)
      .populate({
        path: 'desk',
        populate: [
          { path: 'cabin', select: 'name number' },
          { path: 'building', select: 'name address' }
        ]
      })
      .populate('client', 'name email');

    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    // Ensure member belongs to the client from token
    if (member.client._id.toString() !== req.clientId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const profileData = {
      _id: member._id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      phone: member.phone,
      companyName: member.companyName,
      role: member.role,
      status: member.status,
      client: member.client,
      desk: member.desk ? {
        _id: member.desk._id,
        number: member.desk.number,
        status: member.desk.status,
        cabin: member.desk.cabin,
        building: member.desk.building,
        allocatedAt: member.desk.allocatedAt
      } : null,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt
    };

    res.json({ success: true, data: profileData });
  } catch (err) {
    console.error("getMyProfile error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get member's tickets
export const getMyTickets = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, priority } = req.query;
    
    const filter = { 
      createdBy: req.memberId,
      client: req.clientId 
    };
    
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const skip = (page - 1) * limit;
    
    const tickets = await Ticket.find(filter)
      .populate('building', 'name')
      .populate('cabin', 'name')
      .populate('assignedTo', 'name')
      .populate('category.categoryId', 'name description subCategories')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Ticket.countDocuments(filter);

    res.json({
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
    console.error("getMyTickets error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Create a new ticket
export const createMyTicket = async (req, res) => {
  try {
    const { subject, description, priority = "low", category, images = [] } = req.body;

    if (!subject || !description) {
      return res.status(400).json({ success: false, message: "Subject and description are required" });
    }

    // Get building ID from member's client
    const member = await Member.findById(req.memberId).populate("client", "building");
    if (!member || !member.client || !member.client.building) {
      return res.status(400).json({ success: false, message: "Member client or building not found. Please contact admin." });
    }

    const ticketData = {
      subject: subject.trim(),
      description: description.trim(),
      priority,
      images,
      createdBy: req.memberId,
      client: req.clientId,
      building: member.client.building
    };

    if (category && category.categoryId) {
      ticketData.category = {
        categoryId: category.categoryId,
        subCategory: category.subCategory || ""
      };
    }

    const ticket = await Ticket.create(ticketData);
    
    // Populate the created ticket for response
    const populatedTicket = await Ticket.findById(ticket._id)
      .populate('category.categoryId', 'name');

    res.status(201).json({ success: true, data: populatedTicket });
  } catch (err) {
    console.error("createMyTicket error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get member's bookings
export const getMyBookings = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    
    const filter = { 
      member: req.memberId,
      client: req.clientId 
    };
    
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    
    const bookings = await MeetingBooking.find(filter)
      .populate('room', 'name capacity amenities')
      .sort({ start: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await MeetingBooking.countDocuments(filter);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getMyBookings error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get member's notifications
export const getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, read } = req.query;
    
    const filter = { 
      member: req.memberId,
      client: req.clientId 
    };
    
    if (read !== undefined) filter.read = read === 'true';

    const skip = (page - 1) * limit;
    
    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ 
      member: req.memberId,
      client: req.clientId,
      read: false 
    });

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getMyNotifications error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Mark notification as read
export const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    
    const notification = await Notification.findOneAndUpdate(
      { 
        _id: id, 
        member: req.memberId,
        client: req.clientId 
      },
      { 
        read: true, 
        readAt: new Date() 
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.json({ success: true, data: notification });
  } catch (err) {
    console.error("markNotificationRead error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Mark all notifications as read
export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { 
        member: req.memberId,
        client: req.clientId,
        read: false 
      },
      { 
        read: true, 
        readAt: new Date() 
      }
    );

    res.json({ 
      success: true, 
      message: `${result.modifiedCount} notifications marked as read` 
    });
  } catch (err) {
    console.error("markAllNotificationsRead error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
