import Ticket from "../models/ticketModel.js";
import TicketCategory from "../models/ticketCategoryModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Role from "../models/roleModel.js";
import Guest from "../models/guestModel.js";
import mongoose from "mongoose";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import { sendNotification } from "../utils/notificationHelper.js";

// GET /api/tickets
export const getAllTickets = async (req, res) => {
  try {
    const {
      status,
      priority,
      category, // categoryId
      assignedTo,
      building,
      cabin,
      createdBy,
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query || {};

    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter["category.categoryId"] = category;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (building) filter.building = building;
    if (cabin) filter.cabin = cabin;
    if (createdBy) filter.createdBy = createdBy;

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const tickets = await Ticket.find(filter)
      .populate("building", "name")
      .populate("category", "name")
      .populate("client", "companyName")
      .populate("createdBy", "name")
      .populate("assignedTo", "name")
      .sort(sortOptions)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    // Manual logging removed - handled by middleware for non-GET requests only

    const total = await Ticket.countDocuments(filter);

    res.json({
      success: true,
      data: tickets,
      count: tickets.length,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// POST /api/tickets
export const createTicket = async (req, res) => {
  try {
    const { subject, description } = req.body || {};
    if (!subject || !description) {
      return res.status(400).json({ error: "subject and description are required" });
    }

    // Handle image uploads if files are present
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      try {
        for (const file of req.files) {
          const fileName = `ticket_${Date.now()}_${file.originalname}`;
          // Convert buffer to base64 string for ImageKit upload for maximum compatibility
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
          error: "Failed to upload images",
          details: uploadError.message
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
          // Try to parse JSON array first; fallback to comma-separated list
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
          // Base64 data URL provided - upload to ImageKit
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
          // Direct URL provided - store as-is
          imageUrls.push(img);
        }
      }
    } catch (e) {
      console.warn("Failed to process body images:", e?.message || e);
    }

    let ticketData = {
      ...req.body,
      status: req.body.status || "open",
      latestUpdate: req.body.latestUpdate || `Ticket created`,
      images: imageUrls,
    };

    // Optional user authentication logic - only apply if req.user exists
    if (req.user) {
      const { userId, clientId, memberId, loginType } = req.user;

      if (loginType === "client" && clientId) {
        const Client = (await import("../models/clientModel.js")).default;
        const client = await Client.findById(clientId).select("building");

        if (client && client.building) {
          ticketData.building = client.building;
          ticketData.client = clientId;
          ticketData.createdBy = null;
        }
      } else if (loginType === "member" && memberId) {
        const Member = (await import("../models/memberModel.js")).default;
        const member = await Member.findById(memberId).populate("client", "building");

        if (member && member.client && member.client.building) {
          ticketData.building = member.client.building;
          ticketData.client = member.client._id;
          ticketData.createdBy = memberId;
        }
      }
    }

    const ticket = await Ticket.create(ticketData);

    const populated = await Ticket.findById(ticket._id)
      .populate("assignedTo", "name email phone")
      .populate("building", "name city")
      .populate("cabin", "number floor")
      .populate("createdBy", "firstName lastName phone")
      .populate({ path: "category.categoryId", select: "name description subCategories" });

    // Notify creator (member if available, else client) using template 'ticket_created'
    try {
      let to = {};
      let emailTo = null;
      let actualName = 'Member';
      let companyName = '';

      if (ticketData.createdBy) {
        const m = await Member.findById(ticketData.createdBy).select('firstName lastName email client').populate('client', 'companyName').lean();
        to.memberId = ticketData.createdBy;
        if (m) {
          actualName = `${m.firstName || ''} ${m.lastName || ''}`.trim() || 'Member';
          if (m.client) {
            to.clientId = m.client._id;
            companyName = m.client.companyName || '';
          }
        }
        if (m?.email) emailTo = m.email;
      } else if (ticketData.client) {
        const c = await Client.findById(ticketData.client).select('contactPerson companyName email').lean();
        to.clientId = ticketData.client;
        if (c?.email) emailTo = c.email;
        companyName = c?.companyName || '';
        actualName = c?.contactPerson || companyName || 'Client';
      }
      if (emailTo) to.email = emailTo;

      await sendNotification({
        to,
        channels: { email: Boolean(emailTo), sms: false },
        templateKey: 'ticket_created',
        templateVariables: {
          greeting: 'Ofis Square',
          memberName: companyName || actualName,
          "Member Name": actualName,
          subject: ticketData.subject,
          priority: ticketData.priority || 'low',
          id: populated?.ticketId || String(populated._id),
          Category: populated?.category?.categoryId?.name || '',
          status: populated?.status || 'open'
        },
        title: 'Ticket Created',
        metadata: {
          category: 'ticket',
          tags: ['ticket_created'],
          route: `/tickets/${populated._id}`,
          deepLink: `ofis://tickets/${populated._id}`,
          routeParams: { id: String(populated._id) }
        },
        source: 'system',
        type: 'transactional'
      });
    } catch (notifyErr) {
      console.warn('createTicket: failed to send ticket_created notification:', notifyErr?.message || notifyErr);
    }

    // Notify community team of the same building
    try {
      if (ticketData.client || ticketData.createdBy) {
        const Role = (await import("../models/roleModel.js")).default;
        const User = (await import("../models/userModel.js")).default;
        const Building = (await import("../models/buildingModel.js")).default;

        const communityRole = await Role.findOne({ roleName: { $regex: /^community$/i } });

        if (communityRole) {
          const buildingId = ticketData.building || (populated?.building?._id || populated?.building);

          if (buildingId) {
            const communityUsers = await User.find({
              role: communityRole._id,
              buildingId
            }).select('email').lean();

            const building = await Building.findById(buildingId).select('name').lean();

            for (const user of communityUsers) {
              if (user.email) {
                await sendNotification({
                  to: { email: user.email },
                  channels: { email: true, sms: false },
                  templateKey: 'community_ticket_created',
                  templateVariables: {
                    greeting: 'Ofis Square',
                    ticketId: populated?.ticketId || String(populated._id),
                    buildingName: building?.name || 'Your Building',
                    memberName: companyName || actualName || 'A Member',
                    Category: populated?.category?.categoryId?.name || '',
                    priority: populated?.priority || 'low',
                    description: populated?.description || '',
                    ctaLink: process.env.COMMUNITY_PANEL_LINK || 'https://ofis-square-community-team.vercel.app/'
                  },
                  title: 'New Support Ticket Raised',
                  metadata: {
                    category: 'ticket',
                    tags: ['ticket_created', 'community'],
                    route: `/tickets/${populated._id}`,
                    deepLink: `ofis://tickets/${populated._id}`,
                    routeParams: { id: String(populated._id) }
                  },
                  source: 'system',
                  type: 'transactional'
                });
              }
            }
          }
        }
      }
    } catch (communityNotifyErr) {
      console.warn('createTicket: failed to send community_ticket_created notification:', communityNotifyErr?.message || communityNotifyErr);
    }

    // Log activity
    await logCRUDActivity(req, "CREATE", "Ticket", ticket._id, null, {
      title: ticketData.subject,
      priority: ticketData.priority,
      categoryId: ticketData.category,
      clientId: ticketData.client,
      memberId: ticketData.member,
    });

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: populated,
    });
  } catch (error) {
    console.error("Error creating ticket:", error);
    await logErrorActivity(req, error, "Ticket Creation");
    res.status(500).json({
      success: false,
      message: "Failed to create ticket",
      error: error.message,
    });
  }
};

// GET /api/tickets/:id
export const getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate("assignedTo", "name email phone")
      .populate("building", "name city")
      .populate("cabin", "number floor")
      .populate("createdBy", "firstName lastName phone")
      .populate({ path: "category.categoryId", select: "name description subCategories" });

    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    res.json(ticket);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// PATCH /api/tickets/:id
export const updateTicket = async (req, res) => {
  try {
    const updates = { ...req.body };

    const currentTicket = await Ticket.findById(req.params.id);
    if (!currentTicket) return res.status(404).json({ message: "Ticket not found" });

    // Auto latestUpdate, unless provided
    if (!req.body.latestUpdate) {
      if (updates.status && currentTicket.status !== updates.status) {
        updates.latestUpdate = `Status changed from ${currentTicket.status} to ${updates.status}`;
      } else if (
        updates.assignedTo && String(currentTicket.assignedTo) !== String(updates.assignedTo)
      ) {
        updates.latestUpdate = `Ticket assigned`;
      }
    }

    const ticket = await Ticket.findByIdAndUpdate(req.params.id, updates, { new: true })
      .populate("assignedTo", "name email phone")
      .populate("building", "name city")
      .populate("cabin", "number floor")
      .populate("createdBy", "firstName lastName phone")
      .populate({ path: "category.categoryId", select: "name description subCategories" });

    // Log activity with proper ticket details
    await logCRUDActivity(req, "UPDATE", "Ticket", ticket._id, {
      before: {
        subject: currentTicket.subject,
        status: currentTicket.status,
        priority: currentTicket.priority,
        assignedTo: currentTicket.assignedTo
      },
      after: {
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        assignedTo: ticket.assignedTo
      }
    }, {
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      statusChange: currentTicket.status !== ticket.status ? `${currentTicket.status} → ${ticket.status}` : null,
      assignmentChange: String(currentTicket.assignedTo) !== String(ticket.assignedTo)
    });

    // Notify assigned user if assignment changed
    try {
      if (ticket.assignedTo && (!currentTicket.assignedTo || String(currentTicket.assignedTo) !== String(ticket.assignedTo._id))) {
        // Calculate member/client name
        let memberName = 'Member';
        if (ticket.createdBy) {
          const TicketMember = (await import("../models/memberModel.js")).default;
          const m = await TicketMember.findById(ticket.createdBy._id || ticket.createdBy).select('firstName lastName companyName client').populate('client', 'companyName').lean();
          if (m) {
            memberName = m?.client?.companyName || m?.companyName || `${m?.firstName || ''} ${m?.lastName || ''}`.trim() || 'Member';
          }
        } else if (ticket.client) {
          const TicketClient = (await import("../models/clientModel.js")).default;
          const c = await TicketClient.findById(ticket.client).select('companyName contactPerson').lean();
          if (c) {
            memberName = c?.companyName || c?.contactPerson || 'Client';
          }
        }

        if (ticket.assignedTo.email) {
          const buildingName = ticket.building?.name || 'Ofis Square';
          const categoryName = ticket.category?.categoryId?.name || 'General';

          await sendNotification({
            to: { email: ticket.assignedTo.email },
            channels: { email: true, sms: false },
            templateKey: 'ticket_assigned_to_user',
            templateVariables: {
              greeting: 'Ofis Square',
              ticketId: ticket.ticketId || String(ticket._id),
              memberName,
              buildingName,
              category: categoryName,
              priority: ticket.priority || 'low',
              description: ticket.description || '',
              ctaLink: 'https://office-square.vercel.app/'
            },
            title: 'Ticket Assigned',
            metadata: {
              category: 'ticket',
              tags: ['ticket_assigned'],
              route: `/tickets/${ticket._id}`,
              deepLink: `ofis://tickets/${ticket._id}`,
              routeParams: { id: String(ticket._id) }
            },
            source: 'system',
            type: 'transactional'
          });
        }
      }
    } catch (assignNotifyErr) {
      console.warn('updateTicket: failed to send ticket_assigned_to_user notification:', assignNotifyErr?.message || assignNotifyErr);
    }

    // If ticket just got resolved, notify requester using template 'ticket_resolved'
    try {
      if (String(currentTicket.status) !== 'resolved' && String(ticket.status) === 'resolved') {
        let to = {};
        let emailTo = null;
        let memberName = 'Member';

        if (ticket.createdBy) {
          const m = await Member.findById(ticket.createdBy).select('firstName companyName email client').lean();
          to.memberId = ticket.createdBy;
          if (m?.client) to.clientId = m.client;
          if (m?.email) emailTo = m.email;
          memberName = m?.companyName || m?.firstName || 'Member';
        } else if (ticket.client) {
          const c = await Client.findById(ticket.client).select('contactPerson companyName email').lean();
          to.clientId = ticket.client;
          if (c?.email) emailTo = c.email;
          memberName = c?.contactPerson || c?.companyName || 'Client';
        }
        if (emailTo) to.email = emailTo;

        await sendNotification({
          to,
          channels: { email: Boolean(emailTo), sms: false },
          templateKey: 'ticket_resolved',
          templateVariables: {
            greeting: "Ofis Square",
            memberName,
            companyName: 'Ofis Square',
            subject: ticket.subject,
            priority: ticket.priority || 'low',
            id: ticket.ticketId || String(ticket._id),
            category: ticket?.category?.categoryId?.name || undefined,
            status: ticket.status
          },
          title: 'Ticket Resolved',
          metadata: {
            category: 'ticket',
            tags: ['ticket_resolved'],
            route: `/tickets/${ticket._id}`,
            deepLink: `ofis://tickets/${ticket._id}`,
            routeParams: { id: String(ticket._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (notifyErr) {
      console.warn('updateTicket: failed to send ticket_resolved notification:', notifyErr?.message || notifyErr);
    }

    res.json(ticket);
  } catch (error) {
    console.error("Error updating ticket:", error);
    await logErrorActivity(req, error, "Ticket Update");
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/tickets/:id
export const deleteTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    await Ticket.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: "Ticket deleted successfully", deletedTicketId: req.params.id });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// GET /api/tickets/stats
export const getTicketStats = async (req, res) => {
  try {
    const { building: buildingId } = req.query || {};
    const match = {};
    if (buildingId) match.building = new mongoose.Types.ObjectId(buildingId);

    const stats = await Ticket.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          open: { $sum: { $cond: [{ $in: ["$status", ["open", "inprogress"]] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $in: ["$status", ["resolved", "closed"]] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ]);

    const out = stats[0] || { open: 0, closed: 0, total: 0 };
    res.json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/tickets/staff/:userId
export const getStaffTickets = async (req, res) => {
  try {
    const { userId } = req.params;
    const tickets = await Ticket.find({ assignedTo: userId })
      .populate("createdBy", "firstName lastName phone")
      .populate("assignedTo", "name email phone")
      .populate("building", "name city")
      .populate("cabin", "number floor")
      .populate({ path: "category.categoryId", select: "name description subCategories" })
      .sort({ createdAt: -1 });

    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get tickets by member ID with detailed information
export const getTicketsByMember = async (req, res) => {
  try {
    // Get memberId/guestId from middleware or params
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const isOnDemand = roleName === 'ondemanduser';

    const memberId = !isOnDemand ? (req.memberId || req.member?._id || req.params.memberId) : null;
    const guestId = isOnDemand ? (req.guestId || req.guest?._id) : null;

    if (!memberId && !guestId) {
      return res.status(400).json({
        success: false,
        message: isOnDemand ? "Guest ID is required" : "Member ID is required"
      });
    }

    const { status, priority, category, from, to, limit = 50, page = 1 } = req.query || {};

    // Build filter
    const filter = isOnDemand ? { guest: guestId } : { createdBy: memberId };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter["category.categoryId"] = category;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const skip = (page - 1) * limit;

    // Get tickets with full details
    const tickets = await Ticket.find(filter)
      .populate({
        path: 'category.categoryId',
        select: 'name description color icon subCategories'
      })
      .populate({
        path: 'assignedTo',
        select: 'name email phone role'
      })
      .populate({
        path: 'building',
        select: 'name address city'
      })
      .populate({
        path: 'cabin',
        select: 'number floor building'
      })
      .populate({
        path: 'createdBy',
        select: 'firstName lastName email phone companyName',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .populate({
        path: 'guest',
        select: 'name email phone companyName'
      })
      .populate({
        path: 'client',
        select: 'companyName contactPerson email phone'
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const totalCount = await Ticket.countDocuments(filter);

    // Format response with detailed ticket information
    const formattedTickets = tickets.map(ticket => ({
      id: ticket._id,
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category?.categoryId ? {
        id: ticket.category.categoryId._id,
        name: ticket.category.categoryId.name,
        description: ticket.category.categoryId.description,
        color: ticket.category.categoryId.color,
        icon: ticket.category.categoryId.icon,
        subCategory: ticket.category.subCategory
      } : null,
      assignedTo: ticket.assignedTo ? {
        id: ticket.assignedTo._id,
        name: ticket.assignedTo.name,
        email: ticket.assignedTo.email,
        phone: ticket.assignedTo.phone,
        role: ticket.assignedTo.role
      } : null,
      building: ticket.building ? {
        id: ticket.building._id,
        name: ticket.building.name,
        address: ticket.building.address,
        city: ticket.building.city
      } : null,
      cabin: ticket.cabin ? {
        id: ticket.cabin._id,
        number: ticket.cabin.number,
        floor: ticket.cabin.floor
      } : null,
      createdBy: ticket.createdBy ? {
        id: ticket.createdBy?._id,
        firstName: ticket.createdBy?.firstName,
        lastName: ticket.createdBy?.lastName,
        name: `${ticket.createdBy?.firstName || ''} ${ticket.createdBy?.lastName || ''}`.trim(),
        email: ticket.createdBy?.email,
        phone: ticket.createdBy?.phone,
        companyName: ticket.createdBy?.companyName
      } : (ticket.guest ? {
        id: ticket.guest._id,
        firstName: ticket.guest.name?.split(' ')[0],
        lastName: ticket.guest.name?.split(' ').slice(1).join(' '),
        name: ticket.guest.name,
        email: ticket.guest.email,
        phone: ticket.guest.phone,
        companyName: ticket.guest.companyName
      } : null),
      client: ticket.client ? {
        id: ticket.client._id,
        companyName: ticket.client.companyName,
        contactPerson: ticket.client.contactPerson,
        email: ticket.client.email,
        phone: ticket.client.phone
      } : null,
      images: ticket.images || [],
      latestUpdate: ticket.latestUpdate,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt
    }));

    return res.json({
      success: true,
      data: {
        tickets: formattedTickets,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get tickets by member error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
