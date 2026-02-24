import Member from "../models/memberModel.js";
import Ticket from "../models/ticketModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Notification from "../models/notificationModel.js";
import Event from "../models/eventModel.js";
import Announcement from "../models/announcementModel.js";
import Cabin from "../models/cabinModel.js";
import Contract from "../models/contractModel.js";
import imagekit from "../utils/imageKit.js";
import { sendNotification } from "../utils/notificationHelper.js";
import Visitor from "../models/visitorModel.js";
import User from "../models/userModel.js";
import Client from "../models/clientModel.js";
import BhaifiUser from "../models/bhaifiUserModel.js";
import Building from "../models/buildingModel.js";
import BhaifiNas from "../models/bhaifiNasModel.js";
import { bhaifiCreateUser, bhaifiWhitelist, bhaifiDewhitelist } from "../services/bhaifiService.js";
import { normalizePhoneToUserName, formatDateTime, endOfDayString } from "../controllers/bhaifiController.js";

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
    // Detect role via universalAuthVerify/memberMiddleware
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const authType = String(req.authType || '').toLowerCase();
    const isClient = roleName === 'client' || roleName === 'clients' || authType === 'client' || authType === 'clients';

    // For client-auth requests, req.memberId may be undefined. In that case,
    // either require a memberId to be present on the token or provided via query/params.
    let targetMemberId = req.memberId || req.params?.memberId || req.query?.memberId;
    if (isClient && !targetMemberId) {
      return res.status(400).json({ success: false, message: "memberId is required for client-auth to view a member profile. Alternatively call /api/member-portal/me/home for a client-centric overview." });
    }

    const member = await Member.findById(targetMemberId || req.memberId)
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

    // Role-aware access checks
    if (isClient) {
      // Client-auth: ensure the member belongs to this client
      if (!req.clientId) {
        return res.status(403).json({ success: false, message: "Access denied: missing clientId in request context" });
      }
      if (String(member.client?._id || '') !== String(req.clientId || '')) {
        return res.status(403).json({ success: false, message: `Access denied: member.clientId (${String(member.client?._id)}) does not match req.clientId (${String(req.clientId)})` });
      }
    } else {
      // Member-auth: ensure the member is accessing their own profile and within same client (if clientId present)
      if (String(member._id || '') !== String(req.memberId || '')) {
        return res.status(403).json({ success: false, message: `Access denied: token memberId (${String(req.memberId)}) does not match requested member (${String(member._id)})` });
      }
      if (req.clientId && String(member.client?._id || '') !== String(req.clientId || '')) {
        return res.status(403).json({ success: false, message: `Access denied: member.clientId (${String(member.client?._id)}) does not match req.clientId (${String(req.clientId)})` });
      }
    }

    // Fetch upcoming/active events (show all published events)
    const eventsQuery = {
      status: 'published',
      startDate: { $gte: new Date() }
    };

    const events = await Event.find(eventsQuery)
      .populate('category', 'name')
      .populate('location.building', 'name')
      .populate('location.room', 'name')
      .sort({ startDate: 1 })
      .limit(10)
      .select('title description startDate endDate location category thumbnail mainImage creditsRequired capacity rsvps');

    // Fetch active announcements (show all published announcements)
    const announcementsQuery = {
      status: 'published',
      publishDate: { $lte: new Date() },
      $or: [
        { expiryDate: { $exists: false } },
        { expiryDate: null },
        { expiryDate: { $gt: new Date() } }
      ]
    };

    const announcements = await Announcement.find(announcementsQuery)
      .populate('author', 'name')
      .populate('location.building', 'name')
      .sort({ isPinned: -1, publishDate: -1 })
      .limit(10)
      .select('title subtitle description publishDate expiryDate location category priority thumbnail mainImage isPinned tags views likes');

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
      events: events,
      announcements: announcements,
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

    // Detect role via universalAuthVerify/memberMiddleware
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const authType = String(req.authType || '').toLowerCase();

    // Build filter based on role
    let filter;
    if (roleName === 'client' || roleName === 'clients' || authType === 'client' || authType === 'clients') {
      // Client role: all tickets created by members that belong to this client
      filter = {
        client: req.clientId,
        createdBy: { $exists: true, $ne: null }
      };
    } else {
      // Member role: only this member's tickets
      filter = {
        createdBy: req.memberId,
        client: req.clientId
      };
    }

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
    const { subject, description, priority = "low" } = req.body;

    if (!subject || !description) {
      return res.status(400).json({ success: false, message: "Subject and description are required" });
    }

    // Get building ID from member's client
    const member = await Member.findById(req.memberId).populate("client", "building companyName");
    if (!member || !member.client || !member.client.building) {
      return res.status(400).json({ success: false, message: "Member client or building not found. Please contact admin." });
    }

    // Collect image URLs from uploaded files (if any)
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      try {
        for (const file of req.files) {
          const fileName = `ticket_${Date.now()}_${file.originalname}`;
          const base64 = file.buffer?.toString("base64");
          const uploadResponse = await imagekit.upload({
            file: base64 || file.buffer,
            fileName,
            folder: "/tickets",
            useUniqueFileName: true,
          });
          imageUrls.push(uploadResponse.url);
        }
      } catch (uploadError) {
        console.error("ImageKit upload error (files):", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload images",
          error: uploadError.message
        });
      }
    }

    // Also support images sent via body (either URLs or base64 data URLs)
    try {
      let bodyImagesRaw = req.body?.images;
      let bodyImages = [];
      if (bodyImagesRaw) {
        if (Array.isArray(bodyImagesRaw)) {
          bodyImages = bodyImagesRaw;
        } else if (typeof bodyImagesRaw === "string") {
          try {
            const parsed = JSON.parse(bodyImagesRaw);
            if (Array.isArray(parsed)) bodyImages = parsed;
            else bodyImages = String(bodyImagesRaw).split(",").map(s => s.trim()).filter(Boolean);
          } catch {
            bodyImages = String(bodyImagesRaw).split(",").map(s => s.trim()).filter(Boolean);
          }
        }
      }

      for (const img of bodyImages) {
        if (!img) continue;
        if (typeof img === "string" && img.startsWith("data:")) {
          try {
            const uploadResponse = await imagekit.upload({
              file: img,
              fileName: `ticket_${Date.now()}.jpg`,
              folder: "/tickets",
              useUniqueFileName: true,
            });
            imageUrls.push(uploadResponse.url);
          } catch (uploadError) {
            console.warn("ImageKit upload error (base64 body image):", uploadError?.message || uploadError);
          }
        } else if (typeof img === "string") {
          imageUrls.push(img);
        }
      }
    } catch (e) {
      console.warn("Failed to process body images:", e?.message || e);
    }

    // Normalize category from various possible field encodings in multipart
    let categoryObj = req.body?.category;
    if (typeof categoryObj === 'string') {
      try { categoryObj = JSON.parse(categoryObj); } catch { categoryObj = {}; }
    }
    const categoryId = categoryObj?.categoryId || req.body['category[categoryId]'] || req.body['category.categoryId'];
    const subCategory = categoryObj?.subCategory || req.body['category[subCategory]'] || req.body['category.subCategory'] || "";

    const ticketData = {
      subject: subject.trim(),
      description: description.trim(),
      priority,
      images: imageUrls,
      createdBy: req.memberId,
      client: req.clientId,
      building: member.client.building,
      status: "open",
      latestUpdate: "Ticket created"
    };

    if (categoryId) {
      ticketData.category = {
        categoryId,
        subCategory
      };
    }

    const ticket = await Ticket.create(ticketData);

    // Populate the created ticket for response
    const populatedTicket = await Ticket.findById(ticket._id)
      .populate('category.categoryId', 'name');

    // Notify the creating member using template 'ticket_created'
    try {
      const to = {
        memberId: req.memberId,
        clientId: req.clientId
      };

      if (member?.email) {
        to.email = member.email;
      } else {
        const m = await Member.findById(req.memberId).select('email').lean();
        if (m?.email) to.email = m.email;
      }

      await sendNotification({
        to,
        channels: { email: Boolean(to.email), sms: false },
        templateKey: 'ticket_created',
        templateVariables: {
          greeting: member?.client?.companyName || '',
          memberName: member?.client?.companyName || 'Member',
          "Member Name": `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Member',
          subject: ticketData.subject,
          priority: ticketData.priority || 'low',
          id: populatedTicket?.ticketId || String(populatedTicket._id),
          Category: populatedTicket?.category?.categoryId?.name || '',
          status: populatedTicket?.status || 'open'
        },
        title: 'Ticket Created',
        metadata: {
          category: 'ticket',
          tags: ['ticket_created'],
          route: `/tickets/${populatedTicket._id}`,
          deepLink: `ofis://tickets/${populatedTicket._id}`,
          routeParams: { id: String(populatedTicket._id) }
        },
        source: 'system',
        type: 'transactional'
      });
    } catch (notifyErr) {
      console.warn('createMyTicket: failed to send ticket_created notification:', notifyErr?.message || notifyErr);
    }

    // Notify community team of the same building
    try {
      const Role = (await import("../models/roleModel.js")).default;
      const User = (await import("../models/userModel.js")).default;
      const communityRole = await Role.findOne({ roleName: { $regex: /^community$/i } });

      if (communityRole) {
        const communityUsers = await User.find({
          role: communityRole._id,
          buildingId: member.client.building
        }).select('email').lean();

        const building = await (await import("../models/buildingModel.js")).default.findById(member.client.building).select('name').lean();

        for (const user of communityUsers) {
          if (user.email) {
            await sendNotification({
              to: { email: user.email },
              channels: { email: true, sms: false },
              templateKey: 'community_ticket_created',
              templateVariables: {
                greeting: member?.client?.companyName || 'Member',
                ticketId: populatedTicket?.ticketId || String(populatedTicket._id),
                buildingName: building?.name || 'Your Building',
                memberName: member?.client?.companyName || 'A Member',
                Category: populatedTicket?.category?.categoryId?.name || '',
                priority: populatedTicket?.priority || 'low',
                description: populatedTicket?.description || '',
                ctaLink: process.env.COMMUNITY_PANEL_LINK || 'https://ofis-square-community-team.vercel.app/'
              },
              title: 'New Support Ticket Raised',
              metadata: {
                category: 'ticket',
                tags: ['ticket_created', 'community'],
                route: `/tickets/${populatedTicket._id}`,
                deepLink: `ofis://tickets/${populatedTicket._id}`,
                routeParams: { id: String(populatedTicket._id) }
              },
              source: 'system',
              type: 'transactional'
            });
          }
        }
      }
    } catch (communityNotifyErr) {
      console.warn('createMyTicket: failed to send community_ticket_created notification:', communityNotifyErr?.message || communityNotifyErr);
    }

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
      .populate({
        path: 'room',
        select: 'name capacity images amenities',
        populate: {
          path: 'amenities',
          select: 'name iconUrl'
        }
      })
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

    // Detect role via universalAuthVerify/memberMiddleware
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const authType = String(req.authType || '').toLowerCase();

    // Build filter based on role
    let filter = {};
    if (roleName === 'client' || roleName === 'clients' || authType === 'client' || authType === 'clients') {
      // Client role: show notifications sent to the client itself and to any of its members
      const memberIds = req.clientId
        ? (await Member.find({ client: req.clientId }).select('_id')).map(m => m._id)
        : [];
      filter = {
        $or: [
          { 'to.clientId': req.clientId },
          memberIds.length ? { 'to.memberId': { $in: memberIds } } : { _id: { $exists: true } } // no-op if no members
        ]
      };
    } else {
      // Member role (default): only this member's notifications within their client
      filter = {
        'to.memberId': req.memberId,
        ...(req.clientId ? { 'to.clientId': req.clientId } : {})
      };
    }

    if (read !== undefined) filter.isRead = String(read) === 'true';

    const skip = (Number(page) - 1) * Number(limit);

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);

    const unreadFilter = { ...filter, isRead: false };
    const unreadCount = await Notification.countDocuments(unreadFilter);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / Number(limit))
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

    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const authType = String(req.authType || '').toLowerCase();

    let filter;
    if (roleName === 'client' || roleName === 'clients' || authType === 'client' || authType === 'clients') {
      const memberIds = req.clientId
        ? (await Member.find({ client: req.clientId }).select('_id')).map(m => m._id)
        : [];
      filter = {
        _id: id,
        $or: [
          { 'to.clientId': req.clientId },
          memberIds.length ? { 'to.memberId': { $in: memberIds } } : { _id: { $exists: true } }
        ]
      };
    } else {
      filter = {
        _id: id,
        'to.memberId': req.memberId,
        ...(req.clientId ? { 'to.clientId': req.clientId } : {})
      };
    }

    const notification = await Notification.findOneAndUpdate(
      filter,
      {
        isRead: true,
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
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const authType = String(req.authType || '').toLowerCase();

    let filter;
    if (roleName === 'client' || roleName === 'clients' || authType === 'client' || authType === 'clients') {
      const memberIds = req.clientId
        ? (await Member.find({ client: req.clientId }).select('_id')).map(m => m._id)
        : [];
      filter = {
        $or: [
          { 'to.clientId': req.clientId },
          memberIds.length ? { 'to.memberId': { $in: memberIds } } : { _id: { $exists: true } }
        ],
        isRead: false
      };
    } else {
      filter = {
        'to.memberId': req.memberId,
        ...(req.clientId ? { 'to.clientId': req.clientId } : {}),
        isRead: false
      };
    }

    const result = await Notification.updateMany(
      filter,
      {
        isRead: true,
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

// Get Homepage Data
export const getHomePageData = async (req, res) => {
  try {
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const authType = String(req.authType || '').toLowerCase();
    const isClient = roleName === 'client' || roleName === 'clients' || authType === 'client' || authType === 'clients';

    let name = "";
    let cabinNumber = null;
    let buildingName = null;
    let membershipStatus = null;
    let companyName = null;
    let notifications = [];
    let contractData = null;
    let cabinType = null;
    let buildingOpeningTime = null;
    let buildingClosingTime = null;

    // --- 1. Identify User & Basic Info ---
    if (isClient) {
      if (req.client) {
        name = req.client.primaryFirstName || req.client.companyName || "Client";
        membershipStatus = req.client.membershipStatus || "active";
        companyName = req.client.companyName

        // Find cabin allocated to this client
        // Checking both direct allocation and allocation via active contract blocks is complex, 
        // starting with simple direct allocation check on Cabin model
        const cabin = await Cabin.findOne({
          allocatedTo: req.client._id,
          status: { $ne: 'released' } // simple check
        }).populate('building', 'name openingTime closingTime');

        if (cabin) {
          cabinNumber = cabin.number;
          buildingName = cabin.building?.name;
          cabinType = cabin.type || null;
          buildingOpeningTime = cabin.building?.openingTime || null;
          buildingClosingTime = cabin.building?.closingTime || null;
        }
      }
    } else {
      // Member
      const member = await Member.findById(req.memberId)
        .populate({
          path: 'desk',
          populate: { path: 'cabin', select: 'number type category' }
        })
        .populate({
          path: 'client',
          select: 'membershipStatus building companyName',
          populate: { path: 'building', select: 'name openingTime closingTime' }
        });

      if (member) {
        name = `${member.firstName || ''} ${member.lastName || ''}`.trim();
        membershipStatus = member.client?.membershipStatus || "active";
        companyName = member.client?.companyName || companyName;

        if (member.desk) {
          cabinNumber = member.desk.cabin?.number;
          // Prefer building from client if available (usually consistent), else from desk relation if we populated it
          // In member populate above, we populated member -> client -> building
          buildingName = member.client?.building?.name;
          cabinType = member.desk.cabin?.type || null;
          buildingOpeningTime = member.client?.building?.openingTime || null;
          buildingClosingTime = member.client?.building?.closingTime || null;
        } else if (member.client && member.client.building) {
          // If no desk, fallback to client's building
          buildingName = member.client.building.name;
          buildingOpeningTime = member.client.building.openingTime || null;
          buildingClosingTime = member.client.building.closingTime || null;
        }
      }
    }

    // --- Fetch Active Contract ---
    if (req.clientId) {
      try {
        const contract = await Contract.findOne({
          client: req.clientId,
          status: 'active'
        }).select('monthlyRent capacity escalation startDate').lean();

        if (contract) {
          // Calculate escalation due date
          let escalationDueInMonths = null;
          if (contract.escalation && contract.escalation.frequencyMonths && contract.startDate) {
            const startDate = new Date(contract.startDate);
            const frequencyMonths = contract.escalation.frequencyMonths;
            const today = new Date();

            // Calculate months since contract start
            const monthsSinceStart = (today.getFullYear() - startDate.getFullYear()) * 12 +
              (today.getMonth() - startDate.getMonth());

            // Calculate next escalation point
            const nextEscalationMonths = Math.ceil((monthsSinceStart + 1) / frequencyMonths) * frequencyMonths;
            escalationDueInMonths = nextEscalationMonths - monthsSinceStart;
          }

          contractData = {
            monthlyRent: contract.monthlyRent || null,
            capacity: contract.capacity || null,
            escalationDueInMonths
          };
        }
      } catch (contractErr) {
        console.warn('Failed to fetch contract data:', contractErr);
      }
    }

    // --- 2. Upcoming Events ---
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    // Start of week
    const startOfWeek = new Date(today);
    // End of week (next 7 days from today)
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);

    // Common event query: published
    const baseEventQuery = {
      status: 'published',
      // We generally want future events or events happening today
      endDate: { $gte: today }
    };

    // Parallel fetch for events
    const [todaysEvents, weeksEvents, allEvents] = await Promise.all([
      // Today's events
      Event.find({
        ...baseEventQuery,
        startDate: { $gte: today, $lte: endOfToday }
      })
        .select('title description startDate endDate location thumbnail mainImage category')
        .populate('location.building', 'name')
        .sort({ startDate: 1 }),

      // This week's events
      Event.find({
        ...baseEventQuery,
        startDate: { $gte: today, $lte: endOfWeek }
      })
        .select('title description startDate endDate location thumbnail mainImage category')
        .populate('location.building', 'name')
        .sort({ startDate: 1 }),

      // All events (Global, showing potentially all or just future? Let's show all published for now as requested, or maybe recent past too?)
      // User said "all events are not showing", likely expecting to see more.
      // Removing date filter to show EVERYTHING published.
      Event.find({
        status: 'published'
      })
        .select('title description startDate endDate location thumbnail mainImage category')
        .populate('location.building', 'name')
        .sort({ startDate: -1 }) // Newest/Future first
        .limit(50) // Increased limit
    ]);


    // --- 3. Notifications ---
    let notifFilter;
    if (isClient) {
      // Client notifications
      const memberIds = req.clientId
        ? (await Member.find({ client: req.clientId }).select('_id')).map(m => m._id)
        : [];

      notifFilter = {
        $or: [
          { 'to.clientId': req.clientId },
          memberIds.length ? { 'to.memberId': { $in: memberIds } } : { _id: { $exists: true } }
        ]
      };
    } else {
      // Member notifications
      notifFilter = {
        'to.memberId': req.memberId,
        ...(req.clientId ? { 'to.clientId': req.clientId } : {})
      };
    }

    // Fetch recent notifications (limit 5)
    notifications = await Notification.find(notifFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title content type isRead createdAt metadata');

    // --- 4. Today's Meeting Room Bookings ---
    let bookingsToday = [];
    try {
      let bookingQuery = null;
      if (isClient && req.clientId) {
        bookingQuery = {
          client: req.clientId,
          start: { $gte: today, $lte: endOfToday },
          status: { $ne: 'cancelled' }
        };
      } else if (!isClient && req.memberId) {
        bookingQuery = {
          member: req.memberId,
          start: { $gte: today, $lte: endOfToday },
          status: { $ne: 'cancelled' }
        };
      }

      if (bookingQuery) {
        const rawBookings = await MeetingBooking.find(bookingQuery)
          .populate({
            path: 'room',
            select: 'name images building',
            populate: {
              path: 'building',
              select: 'name address'
            }
          })
          .select('room start end status member client');

        const fmt = (d) => {
          try {
            return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          } catch { return null; }
        };

        bookingsToday = rawBookings.map(b => ({
          _id: b._id,
          roomId: b.room?._id,
          roomName: b.room?.name,
          roomBuildingName: b.room?.building?.name,
          roomBuildingAddress: b.room?.building?.address,
          image: Array.isArray(b.room?.images) && b.room.images.length ? b.room.images[0] : null,
          start: b.start,
          end: b.end,
          slot: `${fmt(b.start)} - ${fmt(b.end)}`,
          status: b.status,
          bookedByMember: b.member,
          bookedByClient: b.client
        }));
      }
    } catch (e) {
      console.warn('getHomePageData: failed to fetch todays bookings', e?.message || e);
    }

    res.json({
      success: true,
      data: {
        profile: {
          name,
          memberId: req.memberId || null,
          companyName,
          cabinNumber,
          buildingName,
          membershipStatus,
          role: isClient ? 'client' : 'member',
          contract: contractData,
          cabinType,
          buildingOpeningTime,
          buildingClosingTime
        },
        events: {
          today: todaysEvents,
          thisWeek: weeksEvents,
          all: allEvents
        },
        notifications,
        bookingsToday
      }
    });

  } catch (err) {
    console.error("getHomePageData error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get App Homepage Data (No Notifications)
export const getAppHomePageData = async (req, res) => {
  try {
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const authType = String(req.authType || '').toLowerCase();
    const isClient = roleName === 'client' || roleName === 'clients' || authType === 'client' || authType === 'clients';

    let name = "";
    let cabinNumber = null;
    let buildingName = null;
    let membershipStatus = null;
    let companyName = null;
    let contractData = null;
    let cabinType = null;
    let buildingOpeningTime = null;
    let buildingClosingTime = null;

    // --- 1. Identify User & Basic Info ---
    if (isClient) {
      if (req.client) {
        name = req.client.primaryFirstName || req.client.companyName || "Client";
        membershipStatus = req.client.membershipStatus || "active";
        companyName = req.client.companyName

        // Find cabin allocated to this client
        const cabin = await Cabin.findOne({
          allocatedTo: req.client._id,
          status: { $ne: 'released' }
        }).populate('building', 'name openingTime closingTime');

        if (cabin) {
          cabinNumber = cabin.number;
          buildingName = cabin.building?.name;
          cabinType = cabin.type || null;
          buildingOpeningTime = cabin.building?.openingTime || null;
          buildingClosingTime = cabin.building?.closingTime || null;
        }
      }
    } else {
      // Member
      const member = await Member.findById(req.memberId)
        .populate({
          path: 'desk',
          populate: { path: 'cabin', select: 'number type category' }
        })
        .populate({
          path: 'client',
          select: 'membershipStatus building companyName',
          populate: { path: 'building', select: 'name openingTime closingTime' }
        });

      if (member) {
        name = `${member.firstName || ''} ${member.lastName || ''}`.trim();
        membershipStatus = member.client?.membershipStatus || "active";
        companyName = member.client?.companyName || companyName;

        if (member.desk) {
          cabinNumber = member.desk.cabin?.number;
          buildingName = member.client?.building?.name;
          cabinType = member.desk.cabin?.type || null;
          buildingOpeningTime = member.client?.building?.openingTime || null;
          buildingClosingTime = member.client?.building?.closingTime || null;
        } else if (member.client && member.client.building) {
          buildingName = member.client.building.name;
          buildingOpeningTime = member.client.building.openingTime || null;
          buildingClosingTime = member.client.building.closingTime || null;
        }
      }
    }

    // --- Fetch Active Contract ---
    if (req.clientId) {
      try {
        const contract = await Contract.findOne({
          client: req.clientId,
          status: 'active'
        }).select('monthlyRent capacity escalation startDate').lean();

        if (contract) {
          let escalationDueInMonths = null;
          if (contract.escalation && contract.escalation.frequencyMonths && contract.startDate) {
            const startDate = new Date(contract.startDate);
            const frequencyMonths = contract.escalation.frequencyMonths;
            const today = new Date();
            const monthsSinceStart = (today.getFullYear() - startDate.getFullYear()) * 12 +
              (today.getMonth() - startDate.getMonth());
            const nextEscalationMonths = Math.ceil((monthsSinceStart + 1) / frequencyMonths) * frequencyMonths;
            escalationDueInMonths = nextEscalationMonths - monthsSinceStart;
          }

          contractData = {
            monthlyRent: contract.monthlyRent || null,
            capacity: contract.capacity || null,
            escalationDueInMonths
          };
        }
      } catch (contractErr) {
        console.warn('Failed to fetch contract data:', contractErr);
      }
    }

    // --- 2. Upcoming Events ---
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);

    const baseEventQuery = {
      status: 'published',
      endDate: { $gte: today }
    };

    const [todaysEvents, weeksEvents, allEvents] = await Promise.all([
      Event.find({
        ...baseEventQuery,
        startDate: { $gte: today, $lte: endOfToday }
      })
        .select('title description startDate endDate location thumbnail mainImage category')
        .populate('location.building', 'name')
        .sort({ startDate: 1 }),

      Event.find({
        ...baseEventQuery,
        startDate: { $gte: today, $lte: endOfWeek }
      })
        .select('title description startDate endDate location thumbnail mainImage category')
        .populate('location.building', 'name')
        .sort({ startDate: 1 }),

      Event.find({ status: 'published' })
        .select('title description startDate endDate location thumbnail mainImage category')
        .populate('location.building', 'name')
        .sort({ startDate: -1 })
        .limit(50)
    ]);

    // --- 3. Today's Meeting Room Bookings ---
    let bookingsToday = [];
    try {
      let bookingQuery = null;
      if (isClient && req.clientId) {
        bookingQuery = {
          client: req.clientId,
          start: { $gte: today, $lte: endOfToday },
          status: { $ne: 'cancelled' }
        };
      } else if (!isClient && req.memberId) {
        bookingQuery = {
          member: req.memberId,
          start: { $gte: today, $lte: endOfToday },
          status: { $ne: 'cancelled' }
        };
      }

      if (bookingQuery) {
        const rawBookings = await MeetingBooking.find(bookingQuery)
          .populate({
            path: 'room',
            select: 'name images building',
            populate: {
              path: 'building',
              select: 'name address'
            }
          })
          .select('room start end status member client');

        const fmt = (d) => {
          try {
            return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          } catch { return null; }
        };

        bookingsToday = rawBookings.map(b => ({
          _id: b._id,
          roomId: b.room?._id,
          roomName: b.room?.name,
          roomBuildingName: b.room?.building?.name,
          roomBuildingAddress: b.room?.building?.address,
          image: Array.isArray(b.room?.images) && b.room.images.length ? b.room.images[0] : null,
          start: b.start,
          end: b.end,
          slot: `${fmt(b.start)} - ${fmt(b.end)}`,
          status: b.status,
          bookedByMember: b.member,
          bookedByClient: b.client
        }));
      }
    } catch (e) {
      console.warn('getAppHomePageData: failed to fetch todays bookings', e?.message || e);
    }

    res.json({
      success: true,
      data: {
        profile: {
          name,
          memberId: req.memberId || null,
          companyName,
          cabinNumber,
          buildingName,
          membershipStatus,
          role: isClient ? 'client' : 'member',
          contract: contractData,
          cabinType,
          buildingOpeningTime,
          buildingClosingTime
        },
        events: {
          today: todaysEvents,
          thisWeek: weeksEvents,
          all: allEvents
        },
        bookingsToday
      }
    });

  } catch (err) {
    console.error("getAppHomePageData error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get member's visitors
export const getMyVisitors = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    const filter = {
      hostMember: req.memberId,
      deletedAt: null
    };

    if (status) {
      if (Array.isArray(status)) {
        filter.status = { $in: status };
      } else {
        filter.status = status;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const visitors = await Visitor.find(filter)
      .populate('building', 'name address')
      .sort({ expectedVisitDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Visitor.countDocuments(filter);

    res.json({
      success: true,
      data: {
        visitors,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (err) {
    console.error("getMyVisitors error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Edit member profile with phone sync and Bhaifi integration
export const editMember = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body || {};

    // Handle fullName splitting if provided
    if (updateData.fullName) {
      const parts = String(updateData.fullName).trim().split(/\s+/);
      if (parts.length > 0) {
        updateData.firstName = parts[0];
        updateData.lastName = parts.slice(1).join(" ") || "";
      }
    }

    // Ensure gender is lowercase if provided
    if (updateData.gender) {
      updateData.gender = updateData.gender.toLowerCase();
    }

    const oldMember = await Member.findById(id).populate({
      path: 'client',
      select: 'building'
    });
    if (!oldMember) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    // Update the member record
    const updatedMember = await Member.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    // Handle phone or email change and syncing
    const phoneChanged = updateData.phone && updateData.phone !== oldMember.phone;
    const emailChanged = updateData.email && updateData.email !== oldMember.email;

    if (phoneChanged || emailChanged) {
      const syncPayload = {};
      if (phoneChanged) syncPayload.phone = updateData.phone;
      if (emailChanged) syncPayload.email = updateData.email;

      // 1. Sync to User record if linked
      if (updatedMember.user) {
        await User.findByIdAndUpdate(updatedMember.user, syncPayload);
      }

      // 2. Sync to Client record if member is a client role
      const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
      const isClientRole = roleName === 'client' || roleName === 'clients';

      if (isClientRole && updatedMember.client) {
        await Client.findByIdAndUpdate(updatedMember.client, syncPayload);
      }

      // 3. Bhaifi integration (only if phone changed)
      if (phoneChanged) {
        try {
          const oldUserName = normalizePhoneToUserName(oldMember.phone);
          const newUserName = normalizePhoneToUserName(updateData.phone);

          if (oldUserName && newUserName && oldUserName !== newUserName) {
            // Resolve NAS IDs (Enterprise level)
            let nasIds = [];
            try {
              const buildingId = updatedMember.client?.building || oldMember.client?.building;
              if (buildingId) {
                const bld = await Building.findById(buildingId).select('wifiAccess').lean();
                const enterprise = bld?.wifiAccess?.enterpriseLevel || {};
                const nasRefIds = Array.isArray(enterprise?.nasRefs) ? enterprise.nasRefs : [];
                if (enterprise?.enabled && nasRefIds.length > 0) {
                  const nasDocs = await BhaifiNas.find({ _id: { $in: nasRefIds }, isActive: true }).select('nasId').lean();
                  const discoveredNasIds = nasDocs.map(d => d.nasId).filter(Boolean);
                  if (discoveredNasIds.length > 0) nasIds = discoveredNasIds;
                }
              }
            } catch (nasErr) {
              console.warn("[BHAIFI] NAS discovery failed during editMember", nasErr.message);
            }

            for (const nasId of nasIds) {
              // De-whitelist old phone
              try {
                await bhaifiDewhitelist({ nasId, userName: oldUserName });
                await BhaifiUser.updateMany({ member: id, userName: oldUserName, nasId }, { $set: { status: "dewhitelisted" } });
              } catch (deErr) {
                // Ignore if not whitelisted
              }

              // Whitelist new phone
              let bhaifiNew = await BhaifiUser.findOne({ member: id, userName: newUserName, nasId });

              if (!bhaifiNew) {
                try {
                  const name = [updatedMember.firstName, updatedMember.lastName].filter(Boolean).join(" ") || updatedMember.companyName || "Member";
                  const email = updatedMember.email;

                  if (email) {
                    const apiRes = await bhaifiCreateUser({ email, idType: 1, name, nasId, userName: newUserName });
                    bhaifiNew = await BhaifiUser.create({
                      member: id,
                      client: updatedMember.client || null,
                      email,
                      name,
                      userName: newUserName,
                      nasId,
                      bhaifiUserId: apiRes?.data?.id || apiRes?.data?.userId || null,
                      status: "active",
                      lastSyncAt: new Date(),
                    });
                  }
                } catch (createErr) {
                  const status = createErr?.response?.status;
                  const msg = (createErr?.response?.data?.message || createErr?.message || '').toLowerCase();
                  const isAlreadyExists = status === 409 || status === 400 || msg.includes('already exists') || msg.includes('duplicate');

                  if (isAlreadyExists) {
                    bhaifiNew = await BhaifiUser.create({
                      member: id,
                      client: updatedMember.client || null,
                      email: updatedMember.email,
                      name: [updatedMember.firstName, updatedMember.lastName].filter(Boolean).join(" "),
                      userName: newUserName,
                      nasId,
                      status: "active",
                      lastSyncAt: new Date(),
                    });
                  }
                }
              }

              // Apply whitelisting
              if (bhaifiNew) {
                try {
                  const contract = await Contract.findOne({ client: updatedMember.client, status: 'active' }).select('endDate');
                  const startDate = formatDateTime(new Date());
                  const endDate = contract?.endDate ? endOfDayString(new Date(contract.endDate)) : endOfDayString(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

                  await bhaifiWhitelist({ nasId, startDate, endDate, userName: newUserName });
                  bhaifiNew.lastWhitelistedAt = new Date();
                  bhaifiNew.status = "active";
                  await bhaifiNew.save();
                } catch (whiErr) {
                  const msg = (whiErr?.response?.data?.message || whiErr?.message || '').toLowerCase();
                  if (msg.includes('already whitelisted') || msg.includes('already exists')) {
                    bhaifiNew.lastWhitelistedAt = new Date();
                    bhaifiNew.status = "active";
                    await bhaifiNew.save();
                  }
                }
              }
            }
          }
        } catch (bhaifiErr) {
          console.warn("[BHAIFI] Integration error during editMember", bhaifiErr.message);
        }
      }
    }

    res.json({ success: true, message: "Member updated successfully", data: updatedMember });
  } catch (err) {
    console.error("editMember error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
