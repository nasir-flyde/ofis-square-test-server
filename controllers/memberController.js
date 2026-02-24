import Member from "../models/memberModel.js";
import { createObjectCsvStringifier } from 'csv-writer';
import Building from "../models/buildingModel.js";
import Cabin from "../models/cabinModel.js";
import Client from "../models/clientModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import mongoose from "mongoose";
import MatrixUser from "../models/matrixUserModel.js";
import ProvisioningJob from "../models/provisioningJobModel.js";
import { matrixApi } from "../utils/matrixApi.js";
import { ensureBhaifiForMember } from "../controllers/bhaifiController.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import AccessPoint from "../models/accessPointModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import { sendNotification } from "../utils/notificationHelper.js";
import { syncMemberToUser } from "../utils/memberSync.js";

export const exportMembers = async (req, res) => {
  try {
    const { client, status, search } = req.query;
    const filter = {};
    if (client) filter.client = client;
    if (status) filter.status = status;
    if (search) {
      const regex = { $regex: search, $options: "i" };
      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { companyName: regex }
      ];
    }

    const members = await Member.find(filter)
      .populate('client', 'companyName')
      .sort({ createdAt: -1 });

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'name', title: 'Name' },
        { id: 'email', title: 'Email' },
        { id: 'phone', title: 'Phone' },
        { id: 'companyName', title: 'Company/Client' },
        { id: 'status', title: 'Status' },
        { id: 'createdAt', title: 'Created At' }
      ]
    });

    const records = members.map(m => ({
      name: `${m.firstName} ${m.lastName || ''}`.trim(),
      email: m.email || '',
      phone: m.phone || '',
      companyName: m.companyName || m.client?.companyName || '',
      status: m.status,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString().split('T')[0] : ''
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
    res.send(csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records));
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to export members");
  }
};

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

        // Notify member about platform access
        try {
          await sendNotification({
            to: { email, userId: createdUserId },
            channels: { email: true, sms: false },
            templateKey: 'platform_access_welcome',
            templateVariables: {
              greeting: 'Ofis Square',
              memberName: companyName || `${firstName} ${lastName || ''}`.trim(),
              companyName: 'Ofis Square',
              loginId: email,
              password: defaultPassword,
              portalLink: process.env.PORTAL_URL || 'https://portal.ofissquare.com'
            },
            title: 'Welcome to Ofis Square Portal',
            metadata: {
              category: 'onboarding',
              tags: ['platform_access', 'welcome'],
            },
            source: 'system',
            type: 'transactional'
          });
        } catch (notifyErr) {
          console.warn('createMember: failed to send platform_access_welcome notification:', notifyErr?.message || notifyErr);
        }
      } catch (userErr) {
        console.warn("Failed to create user for member:", userErr.message);
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
      // client,
      status: status || "active",
      client: clientId,
      desk: null,
      status: 'active',
      user: createdUserId
    });

    // Auto-provision Matrix COSEC user and Bhaifi WiFi user (best-effort, non-blocking)
    try {
      // Resolve a building for context if client has one
      let buildingIdForJobs = null;
      if (clientId) {
        try {
          const cli = await Client.findById(clientId).select('building').lean();
          buildingIdForJobs = cli?.building || null;
        } catch { }
      }

      // MATRIX: create/upsert user, attach to member, enqueue job
      try {
        let matrixUserId;
        try {
          const random6 = Math.floor(100000 + Math.random() * 900000);
          matrixUserId = `MEM${random6}`;
          await matrixApi.createUser({
            id: matrixUserId,
            name: name || undefined,
            email: email || undefined,
            phone: phone || undefined,
            status: "active",
          });
        } catch (apiErr) {
          console.warn("Matrix createUser failed (createMember)", String(member._id), apiErr?.message);
          if (!matrixUserId) {
            const fallbackRand = Math.floor(100000 + Math.random() * 900000);
            matrixUserId = `MEM${fallbackRand}`;
          }
        }

        try {
          await MatrixUser.findOneAndUpdate(
            { externalUserId: matrixUserId },
            {
              $setOnInsert: {
                externalUserId: matrixUserId,
                name: name || email || phone || 'Unnamed',
                email: email || undefined,
                phone: phone || undefined,
                status: 'active',
              },
              $set: {
                buildingId: buildingIdForJobs || undefined,
                clientId: clientId || undefined,
                memberId: member._id,
              },
            },
            { upsert: true, new: true }
          );
        } catch (e) {
          console.warn("MatrixUser upsert failed (createMember)", String(member._id), e?.message);
        }

        try {
          const mu = await MatrixUser.findOne({ externalUserId: matrixUserId, memberId: member._id })
            .select("_id externalUserId")
            .lean();
          if (mu?._id) {
            await Member.findByIdAndUpdate(member._id, {
              $set: { matrixUser: mu._id, matrixExternalUserId: mu.externalUserId },
            });
          }
        } catch (e) {
          console.warn("Failed to attach Matrix refs to member (createMember)", String(member._id), e?.message);
        }

        try {
          await ProvisioningJob.create({
            vendor: 'MATRIX_COSEC',
            jobType: 'UPSERT_USER',
            buildingId: buildingIdForJobs || null,
            memberId: member._id,
            payload: {
              externalUserId: matrixUserId,
              name: name || undefined,
              email: email || undefined,
              phone: phone || undefined,
              status: 'active',
              source: 'AUTO_MEMBER_CREATE',
            },
          });
        } catch (e) {
          console.warn("Failed to enqueue Matrix provisioning job (createMember)", String(member._id), e?.message);
        }

        // Mirror device assignment from finalApprove: assign Matrix user to devices from default access policy for building
        try {
          if (buildingIdForJobs) {
            // Find a default/appropriate access policy for this building
            const policyDoc = await AccessPolicy.findOne({
              $or: [
                { buildingId: buildingIdForJobs, isDefaultForBuilding: true },
                { buildingId: buildingIdForJobs }
              ]
            }).select('accessPointIds').lean();

            if (policyDoc?.accessPointIds?.length) {
              const aps = await AccessPoint.find({ _id: { $in: policyDoc.accessPointIds } })
                .select('deviceBindings')
                .lean();
              const devObjIds = [];
              for (const ap of aps) {
                const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
                for (const b of bindings) {
                  if (b?.vendor === 'MATRIX_COSEC' && b?.deviceId) {
                    devObjIds.push(String(b.deviceId));
                  }
                }
              }
              const uniqueDevObjIds = Array.from(new Set(devObjIds));
              if (uniqueDevObjIds.length) {
                const devs = await MatrixDevice.find({ _id: { $in: uniqueDevObjIds } })
                  .select('device_id')
                  .lean();
                let assignedCount = 0;
                for (const d of devs) {
                  const device_id = d?.device_id;
                  if (!device_id) continue;
                  try {
                    const assignRes = await matrixApi.assignUserToDevice({ device_id, externalUserId: matrixUserId });
                    if (assignRes?.ok) assignedCount += 1;
                  } catch (e) {
                    await logErrorActivity(req, e, 'CreateMember:DeviceAssign', { memberId: member._id, externalUserId: matrixUserId, device_id });
                  }
                }
                if (assignedCount > 0) {
                  await MatrixUser.findOneAndUpdate(
                    { externalUserId: matrixUserId },
                    { $set: { isDeviceAssigned: true, isEnrolled: true } }
                  );
                }
              }
            }
          }
        } catch (e) {
          console.warn('CreateMember device assignment failed:', e?.message);
        }
      } catch (e) {
        console.warn("Matrix provisioning flow failed (createMember)", String(member._id), e?.message);
      }

      // BHAIFI: provision WiFi user and attach refs on member
      try {
        const bhaifiDoc = await ensureBhaifiForMember({ memberId: member._id });
        if (bhaifiDoc?._id) {
          try {
            await Member.findByIdAndUpdate(member._id, {
              $set: { bhaifiUser: bhaifiDoc._id, bhaifiUserName: bhaifiDoc.userName },
            });
          } catch (e) {
            console.warn("Failed to attach Bhaifi refs to member (createMember)", String(member._id), e?.message);
          }
        }
      } catch (e) {
        console.warn('Bhaifi auto-provisioning failed (createMember):', e?.message);
      }
    } catch (integrationErr) {
      console.warn('Member integration provisioning encountered errors:', integrationErr?.message);
    }

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

export const getMemberById = async (req, res) => {
  try {
    // Validate ObjectId for param-based access to avoid CastError
    if (req.params?.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid member ID format",
        details: { id: req.params.id }
      });
    }

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
    // Validate ObjectId for param-based access to avoid CastError
    if (req.params?.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid member ID format",
        details: { id: req.params.id }
      });
    }

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

    // Sync to User if exists
    try {
      await syncMemberToUser(id, updateData, req);
    } catch (syncErr) {
      console.warn("Failed to sync member update to user:", syncErr.message);
    }

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
    // Validate ObjectId for param-based access to avoid CastError
    if (req.params?.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid member ID format",
        details: { id: req.params.id }
      });
    }

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

    // Validate ObjectId for param-based access to avoid CastError
    if (req.params?.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid member ID format",
        details: { id: req.params.id }
      });
    }

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
      .populate('room', 'name capacity amenities images')
      .populate('visitors', 'name email phone company buildingAccess')
      .sort({ start: -1 })
      .limit(20);

    // Get tickets created by member
    const Ticket = (await import("../models/ticketModel.js")).default;
    const ticketFilter = {
      createdBy: memberId
    };
    if (member.client) {
      ticketFilter.client = member.client._id;
    }

    console.log('Ticket filter:', ticketFilter);

    const tickets = await Ticket.find(ticketFilter)
      .populate('category.categoryId', 'name description subCategories')
      .populate('assignedTo', 'name email')
      .populate('building', 'name')
      .populate('cabin', 'name')
      .sort({ createdAt: -1 })
      .limit(50);

    console.log('Tickets found:', tickets.length);

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

    const allEvents = await Event.find({
      status: { $in: ['published', 'completed'] }
    })
      .populate('category', 'name color')
      .populate('location.building', 'name address')
      .populate('location.room', 'name')
      .sort({ startDate: -1 })
      .limit(50);

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
      tickets: {
        total: tickets.length,
        tickets: tickets.map(ticket => ({
          id: ticket._id,
          ticketId: ticket.ticketId,
          subject: ticket.subject,
          description: ticket.description,
          priority: ticket.priority,
          status: ticket.status,
          category: ticket.category?.categoryId ? {
            id: ticket.category.categoryId._id,
            name: ticket.category.categoryId.name,
            subCategory: ticket.category.subCategory
          } : null,
          assignedTo: ticket.assignedTo ? {
            id: ticket.assignedTo._id,
            name: ticket.assignedTo.name,
            email: ticket.assignedTo.email
          } : null,
          building: ticket.building ? {
            id: ticket.building._id,
            name: ticket.building.name
          } : null,
          cabin: ticket.cabin ? {
            id: ticket.cabin._id,
            name: ticket.cabin.name
          } : null,
          images: ticket.images,
          latestUpdate: ticket.latestUpdate,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt
        }))
      },
      meetingBookings: {
        total: meetingBookings.length,
        bookings: meetingBookings.map(booking => ({
          id: booking._id,
          room: booking.room ? {
            name: booking.room.name,
            capacity: booking.room.capacity,
            amenities: booking.room.amenities,
            images: booking.room.images
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
        all: {
          total: allEvents.length,
          events: allEvents.map(event => {
            const obj = event.toObject({ virtuals: true });
            const memberIdStr = String(memberId);
            obj.userHasRSVP = Array.isArray(event.rsvps) && event.rsvps.some(id => String(id) === memberIdStr);
            obj.userHasAttended = Array.isArray(event.attendance) && event.attendance.some(id => String(id) === memberIdStr);
            return obj;
          })
        },
        rsvps: {
          total: rsvpEvents.length,
          events: rsvpEvents.map(event => event.toObject({ virtuals: true }))
        },
        attended: {
          total: attendedEvents.length,
          events: attendedEvents.map(event => event.toObject({ virtuals: true }))
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