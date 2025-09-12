import Ticket from "../models/ticketModel.js";
import mongoose from "mongoose";

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
      .populate("createdBy", "firstName lastName phone email")
      .populate("assignedTo", "name email phone")
      .populate("building", "name city")
      .populate("cabin", "number floor")
      .populate({ path: "category.categoryId", select: "name description subCategories" })
      .sort(sortOptions)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Ticket.countDocuments(filter);

    res.json({
      tickets,
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

    let ticketData = {
      ...req.body,
      status: req.body.status || "open",
      latestUpdate: req.body.latestUpdate || `Ticket created`,
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

    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ error: error.message });
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

    res.json(ticket);
  } catch (error) {
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
