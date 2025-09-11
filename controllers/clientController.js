import mongoose from "mongoose";
import Client from "../models/clientModel.js";
import imagekit from "../utils/imageKit.js";
import Contract from "../models/contractModel.js";
import Invoice from "../models/invoiceModel.js";
import Ticket from "../models/ticketModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Member from "../models/memberModel.js";
import Desk from "../models/deskModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import bcrypt from "bcrypt";
import { getClientPayments } from "./paymentController.js";

// Create client (standard create using model field names)
export const createClient = async (req, res) => {
  try {
    const body = req.body || {};
    // Map common inputs and enforce admin-driven flow defaults
    const payload = {
      companyName: body.companyName ?? body.company_name ?? undefined,
      contactPerson: body.contactPerson ?? body.contact_person ?? undefined,
      email: body.email ? String(body.email).toLowerCase().trim() : undefined,
      phone: body.phone ? String(body.phone).trim() : undefined,
      companyAddress: body.companyAddress ?? body.company_address ?? undefined,
      companyDetailsComplete: true,
      kycStatus: "pending",
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const client = await Client.create(payload);
    let createdOwnerUserId = null;
    let ownerUserInfo = undefined;
    try {
      if (client?.email && client?.phone) {
        // Find or create 'client' role (case-insensitive)
        let roleClient = await Role.findOne({ roleName: { $regex: /^client$/i } });
        if (!roleClient) {
          roleClient = await Role.create({ roleName: "client", permissions: [] });
        }

        // Try to find existing user by email or phone
        let user = await User.findOne({
          $or: [
            ...(client.email ? [{ email: client.email }] : []),
            ...(client.phone ? [{ phone: client.phone }] : []),
          ],
        });

        if (!user) {
          // Per requirement: do not hash; set a default plain password
          const name = client.contactPerson?.trim() || client.companyName?.trim() || "Client User";
          user = await User.create({
            role: roleClient._id,
            name,
            email: client.email || undefined,
            phone: client.phone || undefined,
            password: '123456',
          });
        } else if (!user.role) {
          // If user exists without a role, assign client role
          user.role = roleClient._id;
          await user.save();
        }

        client.ownerUser = user._id;
        createdOwnerUserId = user._id;
        await client.save();
      } else {
        ownerUserInfo = {
          note: "Owner user not created. Both email and phone are required to create a user.",
          hasEmail: Boolean(client?.email),
          hasPhone: Boolean(client?.phone)
        };
      }
    } catch (userErr) {
      console.error("createClient: failed to auto-create user:", userErr?.message || userErr);
    }

    return res.status(201).json({ message: "Client created", client, ownerUserId: createdOwnerUserId, ownerUserInfo });
  } catch (err) {
    console.error("createClient error:", err);
    return res.status(500).json({ error: "Failed to create client" });
  }
};

export const upsertBasicDetails = async (req, res) => {
  try {
    const clientId = req.clientId;
    const payload = {
      companyName: req.body?.company_name?.trim(),
      contactPerson: req.body?.contact_person?.trim(),
      email: req.body?.email?.toLowerCase().trim(),
      phone: req.body?.phone?.trim(),
      companyDetailsComplete: true,
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    if (!clientId) {
      const created = await Client.create(payload);
      return res.status(201).json({ message: "Client created from basic details", client: created });
    }
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: "Invalid client id in token" });
    }

    const client = await Client.findByIdAndUpdate(clientId, { $set: payload }, { new: true });
    if (!client) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "Client basic details updated", client });
  } catch (err) {
    console.error("upsertBasicDetails error:", err);
    return res.status(500).json({ error: "Failed to save client details" });
  }
};

export const getClients = async (_req, res) => {
  try {
    const clients = await Client.aggregate([
      {
        $lookup: {
          from: "clientcreditwallets",
          localField: "_id",
          foreignField: "client",
          as: "wallet"
        }
      },
      {
        $lookup: {
          from: "credittransactions",
          localField: "_id",
          foreignField: "client",
          as: "transactions"
        }
      },
      {
        $lookup: {
          from: "contracts",
          localField: "_id",
          foreignField: "client",
          as: "contracts"
        }
      },
      {
        $lookup: {
          from: "cabins",
          localField: "_id",
          foreignField: "allocatedTo",
          as: "allocatedCabins"
        }
      },
      {
        $addFields: {
          wallet: { $arrayElemAt: ["$wallet", 0] },
          totalCredits: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$transactions",
                    cond: { $eq: ["$$this.type", "grant"] }
                  }
                },
                as: "transaction",
                in: "$$transaction.credits"
              }
            }
          },
          hasActiveContract: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$contracts",
                    cond: { $eq: ["$$this.status", "active"] }
                  }
                }
              },
              0
            ]
          },
          hasCabin: {
            $gt: [{ $size: "$allocatedCabins" }, 0]
          }
        }
      },
      {
        $sort: { createdAt: -1 }
      }
    ]);
    
    return res.json({ success: true, data: clients });
  } catch (err) {
    console.error("getClients error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
};

export const getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    return res.json(client);
  } catch (err) {
    console.error("getClientById error:", err);
    return res.status(500).json({ error: "Failed to fetch client" });
  }
};

export const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Client.findByIdAndUpdate(id, { $set: req.body || {} }, { new: true });
    if (!updated) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "Client updated", client: updated });
  } catch (err) {
    console.error("updateClient error:", err);
    return res.status(500).json({ error: "Failed to update client" });
  }
};

export const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Client.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "Client deleted" });
  } catch (err) {
    console.error("deleteClient error:", err);
    return res.status(500).json({ error: "Failed to delete client" });
  }
};

// Submit KYC documents: set kycDocuments and kycStatus=pending
export const submitKycDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const { kyc_documents } = req.body || {};

    // Upload incoming files to ImageKit and collect URLs by field
    const files = Array.isArray(req.files) ? req.files : [];
    const uploadsByField = {};
    await Promise.all(
      files.map(async (f) => {
        const folder = process.env.IMAGEKIT_KYC_FOLDER || "/ofis-square/kyc";
        const result = await imagekit.upload({
          file: f.buffer, // Buffer supported by SDK
          fileName: f.originalname || `${Date.now()}_${f.fieldname}`,
          folder,
        });
        const entry = {
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          url: result?.url,
          fileId: result?.fileId,
        };
        if (!uploadsByField[f.fieldname]) uploadsByField[f.fieldname] = [];
        uploadsByField[f.fieldname].push(entry);
      })
    );

    // Merge body-provided KYC data and uploaded file URLs
    const mergedKyc = {
      ...(kyc_documents ?? req.body?.kycDocuments ?? {}),
      ...(Object.keys(uploadsByField).length ? { files: uploadsByField } : {}),
    };

    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycDocuments: mergedKyc, kycStatus: "verified" } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "KYC submitted and set to verified", client: updated });
  } catch (err) {
    console.error("submitKycDocuments error:", err);
    return res.status(500).json({ error: "Failed to submit KYC documents" });
  }
};

export const verifyKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Client.findByIdAndUpdate(id, { $set: { kycStatus: "verified" } }, { new: true });
    if (!updated) return res.status(404).json({ error: "Client not found" });

    // After verification, create a draft Contract for this client
    try {
      const start = new Date();
      const end = new Date(start);
      end.setFullYear(start.getFullYear() + 1);

      await Contract.create({
        client: id,
        startDate: start,
        endDate: end,
        fileUrl: "placeholder",
        // status will default to 'draft' based on the model
      });
    } catch (e) {
      // Log but do not block the response
      console.error("verifyKyc: failed to create contract:", e);
    }

    return res.json({ message: "KYC verified", client: updated });
  } catch (err) {
    console.error("verifyKyc error:", err);
    return res.status(500).json({ error: "Failed to verify KYC" });
  }
};

export const rejectKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const updated = await Client.findByIdAndUpdate(
      id,
      { $set: { kycStatus: "rejected", ...(reason && { kycRejectionReason: reason }) } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Client not found" });
    return res.json({ message: "KYC rejected", client: updated });
  } catch (err) {
    console.error("rejectKyc error:", err);
    return res.status(500).json({ error: "Failed to reject KYC" });
  }
};

// Client Dashboard API - Get dashboard stats and recent activity
export const getClientDashboard = async (req, res) => {
  try {
    const clientId = req.clientId; // from clientMiddleware
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    // Get client info
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Get active bookings count (meeting bookings use status: booked | cancelled | completed)
    const activeBookings = await MeetingBooking.countDocuments({
      client: clientId,
      status: { $in: ["booked"] }
    });

    // Get pending invoices count
    const pendingInvoices = await Invoice.countDocuments({
      client: clientId,
      status: { $in: ["issued", "overdue"] }
    });

    // Get open tickets count (tickets are associated by client)
    const openTickets = await Ticket.countDocuments({
      client: clientId,
      status: { $in: ["open", "inprogress", "pending"] }
    });

    // Get recent activity (last 10 items)
    const recentInvoices = await Invoice.find({ client: clientId })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('invoiceNumber status total createdAt');

    const recentBookings = await MeetingBooking.find({ client: clientId })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate('room', 'name')
      .select('room status start end createdAt');

    const recentTickets = await Ticket.find({ client: clientId })
      .sort({ createdAt: -1 })
      .limit(2)
      .select('subject status priority createdAt');

    // Format recent activity
    const recentActivity = [];
    
    recentInvoices.forEach(invoice => {
      recentActivity.push({
        type: 'invoice',
        title: `Invoice ${invoice.invoiceNumber} ${invoice.status}`,
        description: `Amount: ₹${invoice.total}`,
        timestamp: invoice.createdAt,
        status: invoice.status
      });
    });

    recentBookings.forEach(booking => {
      recentActivity.push({
        type: 'booking',
        title: `Meeting room booking ${booking.status}`,
        description: `Room: ${booking.room?.name || 'N/A'}`,
        timestamp: booking.createdAt,
        status: booking.status
      });
    });

    recentTickets.forEach(ticket => {
      recentActivity.push({
        type: 'ticket',
        title: `Support ticket: ${ticket.subject}`,
        description: `Priority: ${ticket.priority}`,
        timestamp: ticket.createdAt,
        status: ticket.status
      });
    });

    // Sort by timestamp and limit to 5 most recent
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedActivity = recentActivity.slice(0, 5);

    const dashboardData = {
      stats: {
        activeBookings,
        pendingInvoices,
        openTickets
      },
      recentActivity: limitedActivity,
      client: {
        companyName: client.companyName,
        contactPerson: client.contactPerson,
        email: client.email,
        kycStatus: client.kycStatus
      }
    };

    return res.json({ success: true, data: dashboardData });
  } catch (err) {
    console.error("getClientDashboard error:", err);
    return res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};

// Get client profile with cabin, invoice, and contract details
export const getClientProfile = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Get allocated cabin details
    const allocatedCabin = await mongoose.model('Cabin').findOne({ allocatedTo: clientId })
      .populate('building', 'name address')
      .populate('contract', 'startDate endDate monthlyRent status');

    // Get recent invoices (last 5)
    const recentInvoices = await Invoice.find({ client: clientId })
      .populate('building', 'name')
      .populate('cabin', 'number')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get active contracts
    const contracts = await Contract.find({ client: clientId })
      .populate('building', 'name address')
      .sort({ createdAt: -1 });

    const profileData = {
      ...client.toObject(),
      allocatedCabin,
      recentInvoices,
      contracts
    };

    return res.json({ success: true, data: profileData });
  } catch (err) {
    console.error("getClientProfile error:", err);
    return res.status(500).json({ error: "Failed to fetch client profile" });
  }
};

// Get client bookings
export const getClientBookings = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const bookings = await MeetingBooking.find(query)
      .populate('room', 'name capacity')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await MeetingBooking.countDocuments(query);

    return res.json({
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
    console.error("getClientBookings error:", err);
    return res.status(500).json({ error: "Failed to fetch client bookings" });
  }
};

// Get client invoices
export const getClientInvoices = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const invoices = await Invoice.find(query)
      .populate('building', 'name')
      .populate('cabin', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Invoice.countDocuments(query);

    return res.json({
      success: true,
      data: {
        invoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getClientInvoices error:", err);
    return res.status(500).json({ error: "Failed to fetch client invoices" });
  }
};

// Get client contracts
export const getClientContracts = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const contracts = await Contract.find({ client: clientId })
      .populate('building', 'name address')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: contracts });
  } catch (err) {
    console.error("getClientContracts error:", err);
    return res.status(500).json({ error: "Failed to fetch client contracts" });
  }
};

// Get client tickets
export const getClientTickets = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const tickets = await Ticket.find(query)
      .populate('building', 'name')
      .populate('cabin', 'name')
      .populate('assignedTo', 'name')
      .populate('createdBy', 'firstName lastName email phone')
      .populate('category.categoryId', 'name description subCategories')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Ticket.countDocuments(query);

    return res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (err) {
    console.error('getClientTickets error:', err);
    return res.status(500).json({ error: 'Failed to fetch client tickets' });
  }
};

// Create client ticket
export const createClientTicket = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { subject, description, priority = "low", category, images } = req.body || {};
    
    if (!subject || !description) {
      return res.status(400).json({ error: "Subject and description are required" });
    }

    // Get building ID from client table
    const client = await Client.findById(clientId).select("building");
    if (!client || !client.building) {
      return res.status(400).json({ error: "Client building not found. Please contact admin." });
    }

    // Create ticket with client reference and building from client table
    const ticket = await Ticket.create({
      subject,
      description,
      priority,
      category,
      images: images || [],
      client: clientId,
      building: client.building,
      createdBy: null,
      status: "open"
    });

    return res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    console.error("createClientTicket error:", err);
    return res.status(500).json({ error: "Failed to create ticket" });
  }
};

// Get client members
export const getClientMembers = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { client: clientId };
    if (status) query.status = status;

    const members = await Member.find(query)
      .populate('desk', 'number status building cabin')
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Member.countDocuments(query);

    return res.json({
      success: true,
      data: {
        members,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getClientMembers error:", err);
    return res.status(500).json({ error: "Failed to fetch client members" });
  }
};

// Create member for client
export const createClientMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { firstName, lastName, email, phone, role, password } = req.body || {};
    
    if (!firstName) {
      return res.status(400).json({ error: "firstName is required" });
    }

    let userId = null;

    // Create user automatically if email is provided
    if (email) {
      try {
        // Find member role with specific ID
        const memberRole = await Role.findById("68bfc2b86ecb1276d721bf71");
        
        if (memberRole) {
          const rawPassword = '123456';
          // Remove password encryption - store as plain text
          
          const user = await User.create({
            name: `${firstName} ${lastName || ''}`.trim(),
            email: email,
            password: rawPassword, // Store password without encryption
            phone: phone,
            role: memberRole._id,
            isActive: true
          });

          userId = user._id;
        }
      } catch (userErr) {
        console.log("Failed to create user for member:", userErr.message);
      }
    }

    const member = await Member.create({
      firstName,
      lastName,
      email,
      phone,
      role,
      client: clientId,
      user: userId,
      status: "active"
    });

    return res.status(201).json({ success: true, data: member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("createClientMember error:", err);
    return res.status(500).json({ error: "Failed to create member" });
  }
};

// Update client member
export const updateClientMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { id } = req.params;
    
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { firstName, lastName, email, phone, role, status } = req.body || {};

    const member = await Member.findOneAndUpdate(
      { _id: id, client: clientId }, // Ensure member belongs to this client
      {
        firstName,
        lastName,
        email,
        phone,
        role,
        status
      },
      { new: true, runValidators: true }
    );

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    return res.json({ success: true, data: member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("updateClientMember error:", err);
    return res.status(500).json({ error: "Failed to update member" });
  }
};

// Delete client member
export const deleteClientMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { id } = req.params;
    
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const member = await Member.findOneAndDelete({ _id: id, client: clientId });
    
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    return res.json({ success: true, message: "Member deleted successfully" });
  } catch (err) {
    console.error("deleteClientMember error:", err);
    return res.status(500).json({ error: "Failed to delete member" });
  }
};

// Get available desks for client's allocated cabin
export const getClientAvailableDesks = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    // Find client's allocated cabin
    const allocatedCabin = await mongoose.model('Cabin').findOne({ allocatedTo: clientId })
      .populate('building', 'name address');

    if (!allocatedCabin) {
      return res.status(404).json({ error: "No cabin allocated to this client" });
    }
    const activeContract = await Contract.findOne({ 
      client: clientId, 
      status: 'active' 
    }).sort({ createdAt: -1 });

    const contractCapacity = activeContract?.capacity || 0;
    const allDesks = await Desk.find({ cabin: allocatedCabin._id })
      .populate('building', 'name')
      .populate('cabin', 'number floor')
      .sort({ number: 1 });
    const allocatedDesksCount = await Member.countDocuments({ 
      client: clientId, 
      desk: { $ne: null } 
    });

    const availableDesks = allDesks.filter(desk => desk.status === 'available');
    const canAllocateMore = allocatedDesksCount < contractCapacity;
    const remainingCapacity = Math.max(0, contractCapacity - allocatedDesksCount);
    const desksToShow = canAllocateMore ? availableDesks.slice(0, remainingCapacity) : [];

    return res.json({
      success: true,
      data: {
        cabin: allocatedCabin,
        desks: allDesks,
        availableDesks: desksToShow,
        contractCapacity,
        allocatedDesksCount,
        remainingCapacity,
        canAllocateMore
      }
    });
  } catch (err) {
    console.error("getClientAvailableDesks error:", err);
    return res.status(500).json({ error: "Failed to fetch available desks" });
  }
};

// Allocate desk to member
export const allocateDeskToMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { memberId, deskId } = req.body || {};
    
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    if (!memberId || !deskId) {
      return res.status(400).json({ error: "memberId and deskId are required" });
    }

    // Get client's active contract to check capacity
    const activeContract = await Contract.findOne({ 
      client: clientId, 
      status: 'active' 
    }).sort({ createdAt: -1 });

    if (!activeContract) {
      return res.status(400).json({ error: "No active contract found for this client" });
    }

    const contractCapacity = activeContract.capacity || 0;

    // Count currently allocated desks for this client
    const allocatedDesksCount = await Member.countDocuments({ 
      client: clientId, 
      desk: { $ne: null } 
    });

    // Check if allocation would exceed contract capacity
    if (allocatedDesksCount >= contractCapacity) {
      return res.status(400).json({ 
        error: `Cannot allocate more desks. Contract capacity is ${contractCapacity} and ${allocatedDesksCount} desks are already allocated.` 
      });
    }

    // Verify member belongs to this client
    const member = await Member.findOne({ _id: memberId, client: clientId });
    if (!member) {
      return res.status(404).json({ error: "Member not found or does not belong to this client" });
    }

    // Check if member already has a desk
    if (member.desk) {
      return res.status(400).json({ error: "Member already has a desk allocated" });
    }

    // Verify desk exists and is available
    const desk = await Desk.findById(deskId).populate("building cabin");
    if (!desk) {
      return res.status(404).json({ error: "Desk not found" });
    }

    if (desk.status !== "available") {
      return res.status(400).json({ error: "Desk is not available" });
    }

    // Verify desk is in client's allocated cabin
    const allocatedCabin = await mongoose.model('Cabin').findOne({ allocatedTo: clientId });
    if (!allocatedCabin || String(desk.cabin._id) !== String(allocatedCabin._id)) {
      return res.status(403).json({ error: "Desk is not in your allocated cabin" });
    }

    // Update desk status and member desk reference
    desk.status = "occupied";
    desk.allocatedAt = new Date();
    desk.releasedAt = undefined;
    await desk.save();

    // Update member with desk reference
    member.desk = desk._id;
    await member.save();

    return res.json({ 
      success: true, 
      message: "Desk allocated to member successfully", 
      data: { member, desk, remainingCapacity: contractCapacity - allocatedDesksCount - 1 } 
    });
  } catch (err) {
    console.error("allocateDeskToMember error:", err);
    return res.status(500).json({ error: "Failed to allocate desk to member" });
  }
};

// Release desk from member
export const releaseDeskFromMember = async (req, res) => {
  try {
    const clientId = req.clientId;
    const { memberId } = req.body || {};
    
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    if (!memberId) {
      return res.status(400).json({ error: "memberId is required" });
    }

    // Verify member belongs to this client and has a desk
    const member = await Member.findOne({ _id: memberId, client: clientId }).populate('desk');
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    if (!member.desk) {
      return res.status(400).json({ error: "Member does not have an allocated desk" });
    }

    const desk = member.desk;

    // Update desk status
    desk.status = "available";
    desk.releasedAt = new Date();
    await desk.save();

    // Remove desk reference from member
    member.desk = null;
    await member.save();

    return res.json({ 
      success: true, 
      message: "Desk released from member successfully", 
      data: { member, desk } 
    });
  } catch (err) {
    console.error("releaseDeskFromMember error:", err);
    return res.status(500).json({ error: "Failed to release desk from member" });
  }
};

// Get client credit management data
export const getClientCreditManagement = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 20, type, member, startDate, endDate } = req.query;

    // Get client credit wallet
    const wallet = await ClientCreditWallet.findOne({ client: clientId });
    
    // Build transaction query
    const transactionQuery = { client: clientId };
    if (type && type !== 'all') transactionQuery.type = type;
    if (member && member !== 'all') transactionQuery.member = member;
    
    if (startDate || endDate) {
      transactionQuery.createdAt = {};
      if (startDate) transactionQuery.createdAt.$gte = new Date(startDate);
      if (endDate) transactionQuery.createdAt.$lte = new Date(endDate);
    }

    // Get transactions with pagination
    const transactions = await CreditTransaction.find(transactionQuery)
      .populate('member', 'firstName lastName email')
      .populate('refId')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const totalTransactions = await CreditTransaction.countDocuments(transactionQuery);

    // Get credit summary by type
    const creditSummary = await CreditTransaction.aggregate([
      { $match: { client: new mongoose.Types.ObjectId(clientId) } },
      {
        $group: {
          _id: '$type',
          totalCredits: { $sum: '$credits' },
          totalValue: { $sum: { $multiply: ['$credits', '$valuePerCredit'] } },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get top spending members
    const topSpenders = await CreditTransaction.aggregate([
      { 
        $match: { 
          client: new mongoose.Types.ObjectId(clientId),
          type: 'consume',
          member: { $ne: null }
        } 
      },
      {
        $group: {
          _id: '$member',
          totalCredits: { $sum: '$credits' },
          totalValue: { $sum: { $multiply: ['$credits', '$valuePerCredit'] } },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { totalCredits: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'members',
          localField: '_id',
          foreignField: '_id',
          as: 'member'
        }
      },
      { $unwind: '$member' }
    ]);

    // Get monthly credit usage trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyTrend = await CreditTransaction.aggregate([
      { 
        $match: { 
          client: new mongoose.Types.ObjectId(clientId),
          createdAt: { $gte: sixMonthsAgo }
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            type: '$type'
          },
          credits: { $sum: '$credits' },
          value: { $sum: { $multiply: ['$credits', '$valuePerCredit'] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    return res.json({
      success: true,
      data: {
        wallet: wallet || { balance: 0, creditValue: 200, currency: 'INR' },
        transactions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: totalTransactions,
          pages: Math.ceil(totalTransactions / Number(limit))
        },
        summary: {
          creditSummary,
          topSpenders,
          monthlyTrend
        }
      }
    });
  } catch (err) {
    console.error("getClientCreditManagement error:", err);
    return res.status(500).json({ error: "Failed to fetch credit management data" });
  }
};

// Get current client profile (for settings page)
export const getCurrentClientProfile = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const client = await Client.findById(clientId).select('-ownerUser -kycDocuments');
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    return res.json({ success: true, data: client });
  } catch (err) {
    console.error("getCurrentClientProfile error:", err);
    return res.status(500).json({ error: "Failed to fetch client profile" });
  }
};

// Update current client profile (for settings page)
export const updateCurrentClientProfile = async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const {
      companyName,
      contactPerson,
      email,
      phone,
      companyAddress,
      documentName,
      documentLink
    } = req.body || {};

    // Validate required fields
    if (!companyName || !contactPerson || !email || !phone) {
      return res.status(400).json({ 
        error: "Company name, contact person, email, and phone are required" 
      });
    }

    // Update client profile
    const updatedClient = await Client.findByIdAndUpdate(
      clientId,
      {
        $set: {
          companyName: companyName.trim(),
          contactPerson: contactPerson.trim(),
          email: email.toLowerCase().trim(),
          phone: phone.trim(),
          companyAddress: companyAddress?.trim() || "",
          documentName: documentName?.trim() || "",
          documentLink: documentLink?.trim() || ""
        }
      },
      { new: true, runValidators: true }
    ).select('-ownerUser -kycDocuments');

    if (!updatedClient) {
      return res.status(404).json({ error: "Client not found" });
    }

    return res.json({ 
      success: true, 
      message: "Profile updated successfully",
      data: updatedClient 
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("updateCurrentClientProfile error:", err);
    return res.status(500).json({ error: "Failed to update client profile" });
  }
};
