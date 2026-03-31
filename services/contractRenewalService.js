import Contract from "../models/contractModel.js";
import { sendNotification } from "../utils/notificationHelper.js";
import Role from "../models/roleModel.js";
import User from "../models/userModel.js";
import mongoose from "mongoose";

/**
 * Find contracts expiring today with auto-renewal enabled and create new contracts.
 */
export async function processAutoRenewals() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    console.log(`[ContractRenewal] Checking for contracts expiring between ${today.toISOString()} and ${tomorrow.toISOString()} with auto-renewal enabled...`);

    // Find active contracts expiring today
    const expiringContracts = await Contract.find({
      status: "active",
      "renewal.isAutoRenewal": true,
      endDate: {
        $gte: today,
        $lt: tomorrow
      }
    }).populate("client", "companyName").populate("building", "name");

    if (expiringContracts.length === 0) {
      console.log("[ContractRenewal] No contracts found for auto-renewal today.");
      return;
    }

    console.log(`[ContractRenewal] Found ${expiringContracts.length} contracts for auto-renewal.`);

    for (const oldContract of expiringContracts) {
      await renewContract(oldContract);
    }
  } catch (error) {
    console.error("[ContractRenewal] Error in processAutoRenewals:", error);
  }
}

/**
 * Create a new contract based on an old one and notify the teams.
 * @param {Object} oldContract - The expiring contract document.
 */
async function renewContract(oldContract) {
  try {
    // 1. Calculate new dates
    const startDate = new Date(oldContract.endDate);
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);

    const renewalMonths = oldContract.renewal?.renewalTermMonths || 12;
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + renewalMonths);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);

    // 2. Prepare new contract data
    const newContractData = {
      client: oldContract.client?._id || oldContract.client,
      building: oldContract.building?._id || oldContract.building,
      startDate,
      endDate,
      billingStartDate: startDate,
      billingEndDate: endDate,
      commencementDate: startDate,
      capacity: oldContract.capacity,
      monthlyRent: oldContract.monthlyRent,
      printerCredits: oldContract.printerCredits,
      initialCredits: oldContract.initialCredits,
      legalExpenses: oldContract.legalExpenses,
      allocationSeatsNumber: oldContract.allocationSeatsNumber,
      parkingSpaces: oldContract.parkingSpaces,
      parkingFees: oldContract.parkingFees,
      durationMonths: renewalMonths,
      lockInPeriodMonths: oldContract.lockInPeriodMonths,
      noticePeriodDays: oldContract.noticePeriodDays,
      escalation: oldContract.escalation,
      renewal: oldContract.renewal,
      fullyServicedBusinessHours: oldContract.fullyServicedBusinessHours,
      freebies: oldContract.freebies,
      payAsYouGo: oldContract.payAsYouGo,
      gst_no: oldContract.gst_no,
      gst_treatment: oldContract.gst_treatment,
      place_of_supply: oldContract.place_of_supply,
      entityType: oldContract.entityType,
      type: oldContract.type || "New",
      billableSeats: oldContract.billableSeats,
      leadOwnerName: oldContract.leadOwnerName,
      broker: oldContract.broker,
      commission: oldContract.commission,
      status: "pushed", // Status for senior approval flow
      createdBy: new mongoose.Types.ObjectId("000000000000000000000000"), // System User
      lastActionBy: new mongoose.Types.ObjectId("000000000000000000000000"),
      lastActionAt: new Date(),
    };

    // Copy add-ons if they exist
    if (Array.isArray(oldContract.addOns) && oldContract.addOns.length > 0) {
      newContractData.addOns = oldContract.addOns.map(a => ({
        addonId: a.addonId,
        description: a.description,
        amount: a.amount,
        quantity: a.quantity,
        billingCycle: a.billingCycle,
        status: "active",
        zoho_item_id: a.zoho_item_id,
        startDate: startDate,
        endDate: endDate,
        addedAt: new Date(),
        addedBy: new mongoose.Types.ObjectId("000000000000000000000000"),
      }));
    }

    const newContract = await Contract.create(newContractData);
    console.log(`[ContractRenewal] Created new contract ${newContract._id} for client ${oldContract.client?.companyName || oldContract.client}`);

    // 3. Send Notifications
    await notifyTeams(newContract, oldContract);

  } catch (error) {
    console.error(`[ContractRenewal] Error renewing contract ${oldContract._id}:`, error);
  }
}

/**
 * Send notifications to Sales, System Admin, and Legal Team.
 */
async function notifyTeams(newContract, oldContract) {
  try {
    const rolesToNotify = ["Sales", "System Admin", "Legal Team"];
    const companyName = oldContract.client?.companyName || "Client";
    const buildingName = oldContract.building?.name || "Building";

    await sendNotification({
      to: { roleNames: rolesToNotify },
      channels: { email: true, inApp: true, push: true },
      title: "Contract Auto-Renewed",
      content: {
        smsText: `Contract for ${companyName} at ${buildingName} has been auto-renewed. New contract ID: ${newContract._id}`,
        emailSubject: `Contract Auto-Renewal: ${companyName} - ${buildingName}`,
        emailHtml: `
          <h3>Contract Auto-Renewal Notification</h3>
          <p>The contract for <strong>${companyName}</strong> at <strong>${buildingName}</strong> has reached its end date and was auto-renewed.</p>
          <p>A new "Sales Commercial" has been created automatically in <strong>pushed</strong> status and is awaiting review.</p>
          <ul>
            <li><strong>Old Contract ID:</strong> ${oldContract._id}</li>
            <li><strong>New Contract ID:</strong> ${newContract._id}</li>
            <li><strong>New Start Date:</strong> ${newContract.startDate.toLocaleDateString()}</li>
            <li><strong>New End Date:</strong> ${newContract.endDate.toLocaleDateString()}</li>
          </ul>
          <p>Please review the commercials and proceed with the workflow.</p>
        `,
        emailText: `Contract for ${companyName} at ${buildingName} has been auto-renewed. New contract ID: ${newContract._id}. New term: ${newContract.startDate.toLocaleDateString()} to ${newContract.endDate.toLocaleDateString()}.`
      },
      metadata: {
        category: "contract",
        tags: ["auto_renewal", "pushed"],
        route: `/contracts/${newContract._id}`,
        contractId: String(newContract._id)
      },
      source: "system",
      type: "transactional"
    });

    console.log(`[ContractRenewal] Sent auto-renewal notifications for contract ${newContract._id}`);
  } catch (error) {
    console.error("[ContractRenewal] Error sending notifications:", error);
  }
}
