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
    const member = await Member.findById(req.memberId).populate("client", "building");
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
      try {
        // Prefer the earlier loaded member for email if available
        if (member?.email) {
          to.email = member.email;
        } else {
          const m = await Member.findById(req.memberId).select('email').lean();
          if (m?.email) to.email = m.email;
        }
      } catch { }

      await sendNotification({
        to,
        channels: { email: Boolean(to.email), sms: false },
        templateKey: 'ticket_created',
        templateVariables: {
          subject: ticketData.subject,
          priority: ticketData.priority || 'low',
          ticketId: populatedTicket?.ticketId || String(populatedTicket._id),
          category: populatedTicket?.category?.categoryId?.name || undefined,
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
        }).populate('building', 'name');

        if (cabin) {
          cabinNumber = cabin.number;
          buildingName = cabin.building?.name;
        }
      }
    } else {
      // Member
      const member = await Member.findById(req.memberId)
        .populate({
          path: 'desk',
          populate: { path: 'cabin', select: 'number' }
        })
        .populate({
          path: 'client',
          select: 'membershipStatus building companyName',
          populate: { path: 'building', select: 'name' }
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
        } else if (member.client && member.client.building) {
          // If no desk, fallback to client's building
          buildingName = member.client.building.name;
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


    res.json({
      success: true,
      data: {
        profile: {
          name,
          companyName,
          cabinNumber,
          buildingName,
          membershipStatus,
          role: isClient ? 'client' : 'member',
          contract: contractData
        },
        events: {
          today: todaysEvents,
          thisWeek: weeksEvents,
          all: allEvents
        },
        notifications
      }
    });

  } catch (err) {
    console.error("getHomePageData error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
