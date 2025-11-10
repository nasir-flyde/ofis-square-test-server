import Ticket from "../models/ticketModel.js";
import TicketCategory from "../models/ticketCategoryModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import mongoose from "mongoose";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";

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
          const uploadResponse = await imagekit.upload({
            file: file.buffer,
            fileName: fileName,
            folder: "/tickets"
          });
          imageUrls.push(uploadResponse.url);
        }
      } catch (uploadError) {
        console.error("ImageKit upload error:", uploadError);
        return res.status(500).json({ 
          success: false,
          error: "Failed to upload images",
          details: uploadError.message 
        });
      }
    }

    let ticketData = {
      ...req.body,
      status: req.body.status || "open",
      latestUpdate: req.body.latestUpdate || `Ticket created`,
      images: imageUrls.length > 0 ? imageUrls : (req.body.images || [])
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
    // Get memberId from middleware or params
    const memberId = req.memberId || req.member?._id || req.params.memberId;

    if (!memberId) {
      return res.status(400).json({ 
        success: false, 
        message: "Member ID is required" 
      });
    }

    const { status, priority, category, from, to, limit = 50, page = 1 } = req.query || {};
    
    // Build filter
    const filter = { createdBy: memberId };
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
      createdBy: {
        id: ticket.createdBy?._id,
        firstName: ticket.createdBy?.firstName,
        lastName: ticket.createdBy?.lastName,
        name: `${ticket.createdBy?.firstName || ''} ${ticket.createdBy?.lastName || ''}`.trim(),
        email: ticket.createdBy?.email,
        phone: ticket.createdBy?.phone,
        companyName: ticket.createdBy?.companyName
      },
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
