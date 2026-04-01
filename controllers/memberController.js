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
import { ensureBhaifiForMember, autoSetBhaifiPassword } from "../controllers/bhaifiController.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import AccessPoint from "../models/accessPointModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import { sendNotification } from "../utils/notificationHelper.js";
import { syncMemberToUser } from "../utils/memberSync.js";
import Guest from "../models/guestModel.js";
import RFIDCard from "../models/rfidCardModel.js";

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
    const roleName = req.userRole?.roleName || req.user?.roleName || req.user?.role?.roleName;
    if (roleName !== 'System Admin') {
      return res.status(403).json({ success: false, message: "Forbidden: Only System Admin can create members." });
    }

    const { firstName, lastName, email, phone, companyName, role, client, status, cardId, isPostpaidAllowed } = req.body || {};

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
        // Resolve requested role or fallback to default "member"
        let roleDoc = null;
        if (role) {
          if (mongoose.Types.ObjectId.isValid(role)) {
            roleDoc = await Role.findById(role);
          } else {
            roleDoc = await Role.findOne({ roleName: new RegExp(`^${role.trim()}$`, 'i') });
          }
        }

        let memberRole = roleDoc;
        if (!memberRole) {
          memberRole = await Role.findOne({ roleName: "member" });
          if (!memberRole) {
            memberRole = await Role.create({
              roleName: "member",
              description: "Default member role with basic access",
              canLogin: true,
              permissions: ["member:read", "member:profile"]
            });
          }
        }
        // Find existing user by email OR phone to avoid duplicates
        let user = await User.findOne({
          $or: [
            { email: email.toLowerCase().trim() },
            { phone: phone }
          ]
        });

        if (user) {
          // Update existing user's role and name
          user.role = memberRole._id;
          user.name = `${firstName} ${lastName || ''}`.trim();
          await user.save();
          createdUserId = user._id;
          console.log(`Updated existing user for member: ${email} with role: ${memberRole.roleName}`);
        } else {
          // Create new user if not found
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
          console.log(`Created new user for member: ${email} with default password: ${defaultPassword}`);
        }

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
      user: createdUserId,
      isPostpaidAllowed: isPostpaidAllowed === true || isPostpaidAllowed === 'true'
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
        let matrixUserId = null;
        if (phone) {
          let p = String(phone).replace(/\D/g, "");
          p = p.replace(/^0+/, "");
          const last10 = p.length > 10 ? p.slice(-10) : p;
          if (last10.length === 10) matrixUserId = `91${last10}`;
          console.log(`createMember: normalized phone ${phone} to matrixUserId ${matrixUserId}`);
        }

        if (!matrixUserId) {
          const random6 = Math.floor(100000 + Math.random() * 900000);
          matrixUserId = `MEM${random6}`;
          console.log(`createMember: using random Matrix ID ${matrixUserId} (phone not provided or invalid)`);
        }

        try {
          await matrixApi.createUser({
            id: matrixUserId,
            name: name || undefined,
            email: email || undefined,
            phone: phone || undefined,
            status: "active",
          });
        } catch (apiErr) {
          console.warn("Matrix createUser failed (createMember)", String(member._id), apiErr?.message);
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
              buildingId: buildingIdForJobs,
              isDefaultForBuilding: true,
              status: "active"
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

      // RFID ASSIGNMENT LOGIC
      if (cardId) {
        let currentMatrixUserId = null;
        if (phone) {
          let p = String(phone).replace(/\D/g, "");
          p = p.replace(/^0+/, "");
          const last10 = p.length > 10 ? p.slice(-10) : p;
          if (last10.length === 10) currentMatrixUserId = `91${last10}`;
        }
        if (!currentMatrixUserId) {
          // It would be the random one generated during creation
          const mu = await MatrixUser.findOne({ memberId: member._id }).select("externalUserId").lean();
          currentMatrixUserId = mu?.externalUserId;
        }

        if (currentMatrixUserId) {
          try {
            const card = await RFIDCard.findById(cardId);
            if (card) {
              if (card.currentMemberId) {
                 // Revert member creation since card is already assigned
                 await Member.findByIdAndDelete(member._id);
                 if (createdUserId) await User.findByIdAndDelete(createdUserId);
                 return res.status(409).json({ success: false, message: "Conflict: This RFID card is already assigned to another member." });
              }
              // Link card to MatrixUser
              await MatrixUser.findOneAndUpdate(
                { externalUserId: currentMatrixUserId, memberId: member._id },
                { $addToSet: { cards: cardId }, $set: { isCardCredentialVerified: true } }
              );
              // Update RFID Card
              await RFIDCard.findByIdAndUpdate(cardId, {
                currentMemberId: member._id,
                clientId: clientId || null,
                status: "ACTIVE",
                activatedAt: new Date()
              });
              // Set credential in Matrix
              try {
                await matrixApi.setCardCredential({ externalUserId: currentMatrixUserId, data: card.cardUid });
              } catch (cardErr) {
                console.warn("createMember: Matrix setCardCredential failed:", cardErr.message);
              }
              // Enqueue provisioning job
              try {
                await ProvisioningJob.create({
                  vendor: "MATRIX_COSEC",
                  jobType: "ASSIGN_CARD",
                  memberId: member._id,
                  cardId: card._id,
                  payload: { cardUid: card.cardUid, memberId: member._id }
                });
              } catch (jobErr) {
                console.warn("createMember: failed to enqueue provisioning job:", jobErr.message);
              }
            }
          } catch(rfidErr) {
            console.warn("createMember: failed to assign RFID card:", rfidErr.message);
          }
        }
      }

      // BHAIFI: provision WiFi user and attach refs on member
      try {
        const activeContract = await mongoose.model('Contract').findOne({
          client: clientId,
          status: "active"
        }).sort({ createdAt: -1 }).select("_id").lean();

        if (activeContract) {
          console.log(`createMember: found active contract ${activeContract._id} for BHAiFi sync.`);
        }

        const bhaifiDoc = await ensureBhaifiForMember({
          memberId: member._id,
          contractId: activeContract?._id
        });
        if (bhaifiDoc?._id) {
          try {
            await Member.findByIdAndUpdate(member._id, {
              $set: { bhaifiUser: bhaifiDoc._id, bhaifiUserName: bhaifiDoc.userName },
            });
            await autoSetBhaifiPassword({ bhaifiDoc, buildingId: buildingIdForJobs });
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
      .populate({ 
        path: 'user', 
        select: 'name email role',
        populate: { path: 'role', select: 'roleName' }
      })
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
      .populate({ 
        path: 'user', 
        select: 'name email role',
        populate: { path: 'role', select: 'roleName' }
      });

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
    if (!oldMember) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    // RFID UPDATE LOGIC (Transient cardId field)
    if (updateData.cardId !== undefined) {
      const newCardId = updateData.cardId;
      try {
        // Find current assigned card for this member
        const currentCard = await RFIDCard.findOne({ currentMemberId: id });
        const currentCardId = currentCard ? String(currentCard._id) : null;

        if (String(newCardId || "") !== (currentCardId || "")) {
          // Get MatrixUser for this member
          let mu = await MatrixUser.findOne({ memberId: id });

          // 1. Unassign old card if it exists
          if (currentCard) {
            await RFIDCard.findByIdAndUpdate(currentCard._id, {
              $set: { currentMemberId: null, status: "ISSUED" }
            });
            if (mu) {
              await MatrixUser.findByIdAndUpdate(mu._id, {
                $pull: { cards: currentCard._id }
              });
            }
          }

          // 2. Assign new card if provided
          if (newCardId) {
            const card = await RFIDCard.findById(newCardId);
            if (card) {
              if (card.currentMemberId && String(card.currentMemberId) !== String(id)) {
                return res.status(409).json({ success: false, message: "Conflict: This RFID card is already assigned to another member." });
              }

              if (mu) {
                await MatrixUser.findByIdAndUpdate(mu._id, {
                  $addToSet: { cards: newCardId },
                  $set: { isCardCredentialVerified: true }
                });

                // Set credential in Matrix
                try {
                  await matrixApi.setCardCredential({
                    externalUserId: mu.externalUserId,
                    data: card.cardUid
                  });
                } catch (cardErr) {
                  console.warn("updateMember: Matrix setCardCredential failed:", cardErr.message);
                }

                // Enqueue provisioning job
                try {
                  await ProvisioningJob.create({
                    vendor: "MATRIX_COSEC",
                    jobType: "ASSIGN_CARD",
                    memberId: id,
                    cardId: card._id,
                    payload: { cardUid: card.cardUid, memberId: id }
                  });
                } catch (jobErr) {
                  console.warn("updateMember: failed to enqueue provisioning job:", jobErr.message);
                }
              }

              await RFIDCard.findByIdAndUpdate(newCardId, {
                $set: {
                  currentMemberId: id,
                  clientId: updateData.client || oldMember?.client || null,
                  status: "ACTIVE",
                  activatedAt: new Date()
                }
              });
            }
          }
        }
      } catch (rfidErr) {
        console.warn("updateMember: failed to update RFID card:", rfidErr.message);
      }
      delete updateData.cardId;
    }
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

    // Sync member changes to associated user
    if (member?.user) {
      await syncMemberToUser(member._id, updateData, req);
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
    const userRole = String((req.userRole?.roleName || req.user?.roleName || req.user?.role?.roleName || '')).toLowerCase();
    const isOnDemand = userRole === 'ondemanduser';
    const memberId = req.memberId || req.member?._id || req.user?.memberId || req.params.id;

    // Validate ObjectId for param-based access to avoid CastError
    if (req.params?.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid member ID format",
        details: { id: req.params.id }
      });
    }

    if (!isOnDemand && !memberId) {
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

    let member = null;
    let guest = null;
    let membershipStatus = null;
    let cabinType = null;
    let name = "";

    if (isOnDemand) {
      const guestId = req.guestId || req.params.id || req.query.guestId;
      guest = await Guest.findById(guestId).populate('buildingId', 'name address');
      if (!guest && req.user) {
        guest = await Guest.findOne({
          $or: [
            ...(req.user.email ? [{ email: req.user.email }] : []),
            ...(req.user.phone ? [{ phone: req.user.phone }] : [])
          ]
        }).populate('buildingId', 'name address');
      }

      if (!guest) {
        return res.status(404).json({ success: false, message: "Guest profile not found" });
      }

      name = guest.name;
      membershipStatus = guest.kycStatus === 'verified';
      cabinType = "On-demand";

    } else {
      // Find member with populated client details
      member = await Member.findById(memberId)
        .populate({
          path: 'client',
          select: 'companyName contactPerson email phone billingAddress shippingAddress membershipStatus building',
          populate: { path: 'building', select: 'name' }
        })
        .populate({
          path: 'desk',
          select: 'number floor',
          populate: [
            { path: 'building', select: 'name address' },
            { path: 'cabin', select: 'type' }
          ]
        })
        .populate({
          path: 'user',
          select: 'name email phone role',
          populate: { path: 'role', select: 'roleName' }
        });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      name = `${member.firstName} ${member.lastName || ''}`.trim();
      membershipStatus = !!member.client?.membershipStatus;
      cabinType = member.desk?.cabin?.type || null;

      if (!cabinType && member.client?._id) {
        const allocatedCabin = await Cabin.findOne({
          allocatedTo: member.client._id,
          status: { $ne: 'released' }
        }).select('type');
        if (allocatedCabin) {
          cabinType = allocatedCabin.type;
        }
      }

      // Map 'cabin' to 'Private' (case-insensitive)
      if (typeof cabinType === 'string' && cabinType.toLowerCase() === 'cabin') {
        cabinType = 'Private';
      }
    }

    // Get credit balance
    let creditBalance = null;
    if (!isOnDemand && member.client && member.allowedUsingCredits) {
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
    const ticketFilter = {};
    if (isOnDemand) {
      ticketFilter.guest = guest._id;
    } else {
      ticketFilter.createdBy = memberId;
      if (member.client) {
        ticketFilter.client = member.client._id;
      }
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
    const currentEntityId = isOnDemand ? guest._id : memberId;
    const rsvpEvents = await Event.find({
      rsvps: currentEntityId,
      status: { $in: ['published', 'completed'] }
    })
      .populate('category', 'name color')
      .populate('location.building', 'name address')
      .populate('location.room', 'name')
      .sort({ startDate: -1 })
      .limit(20);

    const attendedEvents = await Event.find({
      attendance: currentEntityId,
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
      member: isOnDemand ? {
        id: guest._id,
        name: guest.name,
        firstName: guest.name?.split(' ')[0] || "",
        lastName: guest.name?.split(' ').slice(1).join(' ') || "",
        email: guest.email,
        phone: guest.phone,
        role: 'ondemanduser',
        status: guest.kycStatus || 'active',
        membershipStatus,
        cabinType,
        building: guest.buildingId,
        createdAt: guest.createdAt,
        updatedAt: guest.updatedAt
      } : {
        id: member._id,
        firstName: member.firstName,
        lastName: member.lastName,
        name: `${member.firstName} ${member.lastName || ''}`.trim(),
        email: member.email,
        phone: member.phone,
        role: member.user?.role?.roleName || member.role,
        status: member.status,
        membershipStatus,
        cabinType,
        allowedUsingCredits: member.allowedUsingCredits,
        isPostpaidAllowed: member.isPostpaidAllowed,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      },
      company: (!isOnDemand && member.client) ? {
        id: member.client._id,
        name: member.client.companyName,
        buildingName: member.client.building?.name || null,
        contactPerson: member.client.contactPerson,
        email: member.client.email,
        phone: member.client.phone,
        billingAddress: member.client.billingAddress,
        shippingAddress: member.client.shippingAddress
      } : null,
      desk: (!isOnDemand && member.desk) ? {
        number: member.desk.number,
        floor: member.desk.floor,
        building: member.desk.building ? {
          name: member.desk.building.name,
          address: member.desk.building.address
        } : null,
        cabinType: cabinType // redundant but helpful
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
            const entityIdStr = String(currentEntityId);
            obj.userHasRSVP = Array.isArray(event.rsvps) && event.rsvps.some(id => String(id) === entityIdStr);
            obj.userHasAttended = Array.isArray(event.attendance) && event.attendance.some(id => String(id) === entityIdStr);
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

// Check email/phone uniqueness
export const checkUniqueness = async (req, res) => {
  try {
    const { email, phone, excludeId } = req.query;
    if (!email && !phone) {
      return res.status(400).json({ success: false, message: "Email or phone is required" });
    }

    const query = { _id: { $ne: excludeId } };
    const orCondition = [];
    if (email) orCondition.push({ email: email.toLowerCase().trim() });
    if (phone) orCondition.push({ phone: phone.trim() });

    if (orCondition.length > 0) {
      query.$or = orCondition;
    }

    const existingMember = await Member.findOne(query);
    return res.json({
      success: true,
      exists: !!existingMember,
      message: existingMember ? "Already in use" : "Available"
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};