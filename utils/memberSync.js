import User from "../models/userModel.js";
import Member from "../models/memberModel.js";
import MatrixUser from "../models/matrixUserModel.js";
import ProvisioningJob from "../models/provisioningJobModel.js";
import { matrixApi } from "../utils/matrixApi.js";
import { ensureBhaifiForMember } from "../controllers/bhaifiController.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import AccessPoint from "../models/accessPointModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import { logErrorActivity } from "../utils/activityLogger.js";

/**
 * Synchronizes User details to Member and triggers integrations
 */
export const syncUserToMember = async (userId, userData, req) => {
    try {
        const member = await Member.findOne({ user: userId });
        if (!member) return;

        const memberUpdate = {};
        if (userData.name) {
            const parts = userData.name.trim().split(/\s+/);
            memberUpdate.firstName = parts[0];
            memberUpdate.lastName = parts.slice(1).join(" ");
        }
        if (userData.email) memberUpdate.email = userData.email.toLowerCase().trim();
        if (userData.phone) memberUpdate.phone = userData.phone.trim();

        const updatedMember = await Member.findByIdAndUpdate(member._id, { $set: memberUpdate }, { new: true });

        // Trigger integration updates
        await syncMemberIntegrations(updatedMember, req);

        return updatedMember;
    } catch (err) {
        console.error("syncUserToMember error:", err);
        if (req) await logErrorActivity(req, err, "SyncUserToMember", { userId });
    }
};

/**
 * Synchronizes Member details to User and triggers integrations
 */
export const syncMemberToUser = async (memberId, memberData, req) => {
    try {
        const member = await Member.findById(memberId);
        if (!member || !member.user) return;

        const userUpdate = {};
        if (memberData.firstName || memberData.lastName) {
            const fName = memberData.firstName || member.firstName || "";
            const lName = memberData.lastName || member.lastName || "";
            userUpdate.name = `${fName} ${lName}`.trim();
        }
        if (memberData.email) userUpdate.email = memberData.email.toLowerCase().trim();
        if (memberData.phone) userUpdate.phone = memberData.phone.trim();

        const updatedUser = await User.findByIdAndUpdate(member.user, { $set: userUpdate }, { new: true });

        // Trigger integration updates (member integration depends on member fields)
        await syncMemberIntegrations(member, req);

        return updatedUser;
    } catch (err) {
        console.error("syncMemberToUser error:", err);
        if (req) await logErrorActivity(req, err, "SyncMemberToUser", { memberId });
    }
};

export const syncMemberIntegrations = async (member, req) => {
    try {
        const name = `${member.firstName} ${member.lastName || ""}`.trim();
        const email = member.email;
        const phone = member.phone;
        const clientId = member.client;
        const matrixUserId = member.matrixExternalUserId;

        if (matrixUserId) {
            // Matrix Update
            try {
                await matrixApi.createUser({
                    id: matrixUserId,
                    name: name || undefined,
                    email: email || undefined,
                    phone: phone || undefined,
                    status: member.status === "active" ? "active" : "inactive",
                });

                await MatrixUser.findOneAndUpdate(
                    { externalUserId: matrixUserId },
                    {
                        $set: {
                            name: name || email || phone || "Unnamed",
                            email: email || undefined,
                            phone: phone || undefined,
                            status: member.status === "active" ? "active" : "inactive",
                        },
                    }
                );

                await ProvisioningJob.create({
                    vendor: "MATRIX_COSEC",
                    jobType: "UPSERT_USER",
                    memberId: member._id,
                    payload: {
                        externalUserId: matrixUserId,
                        name: name || undefined,
                        email: email || undefined,
                        phone: phone || undefined,
                        status: member.status === "active" ? "active" : "inactive",
                        source: "AUTO_MEMBER_SYNC",
                    },
                });
            } catch (e) {
                console.warn("Matrix sync failed during member update:", e.message);
            }
        }

        // Bhaifi Sync
        try {
            await ensureBhaifiForMember({ memberId: member._id });
        } catch (e) {
            console.warn("Bhaifi sync failed during member update:", e.message);
        }
    } catch (err) {
        console.error("syncMemberIntegrations error:", err);
    }
};
