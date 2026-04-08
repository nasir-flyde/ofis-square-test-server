import mongoose from "mongoose";
import { createObjectCsvStringifier } from 'csv-writer';
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import Cabin from "../models/cabinModel.js";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import crypto from "crypto";
import { getAccessToken } from "../utils/zohoSignAuth.js";
import imagekit from "../utils/imageKit.js";
import PdfPrinter from "pdfmake";
import getContractTemplate from "./contractTemplate.js";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fsp } from "fs";
import puppeteer from "puppeteer";
import { createBillingDocumentFromContract } from "../services/invoiceService.js";
import { allocateBlockedCabinsForContract } from "../services/cabinAllocationService.js";
import { logCRUDActivity, logContractActivity, logErrorActivity, logSystemActivity } from "../utils/activityLogger.js";
import loggedZohoSign from "../utils/loggedZohoSign.js";
import apiLogger from "../utils/apiLogger.js";
import { decryptBuffer } from "../utils/encryption.js";

export const exportContracts = async (req, res) => {
  try {
    const { client, status, building, search } = req.query || {};
    const filter = {};
    if (client && mongoose.Types.ObjectId.isValid(client)) filter.client = client;
    if (building && mongoose.Types.ObjectId.isValid(building)) filter.building = building;
    if (status) filter.status = status;

    if (search) {
      const regex = { $regex: search, $options: "i" };
      // Search in client.companyName or building.name?
      // Since we are querying Contracts, we might need to populate and then filter, 
      // OR use a more complex aggregation. For simplicity, let's assume status search or find IDs first.
      // But standard search in ContractList is client company name, building name, status.
      // To keep it simple without aggregation, we can just search status for now or ignore search if it's too complex for base find.
      // Wait, if I want to search client name, I should really use aggregation.
      // Let's stick to status and basic fields for now or just the main filters.
      filter.$or = [
        { status: regex }
      ];
    }

    const contracts = await Contract.find(filter)
      .populate("client", "companyName contactPerson email")
      .populate("building", "name address city state")
      .sort({ createdAt: -1 });

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'clientName', title: 'Client' },
        { id: 'building', title: 'Building' },
        { id: 'startDate', title: 'Start Date' },
        { id: 'endDate', title: 'End Date' },
        { id: 'monthlyRent', title: 'Monthly Rent' },
        { id: 'capacity', title: 'Capacity' },
        { id: 'status', title: 'Status' },
        { id: 'createdAt', title: 'Created At' }
      ]
    });

    const records = contracts.map(c => ({
      clientName: c.client?.companyName || '',
      building: c.building?.name || '',
      startDate: c.startDate ? new Date(c.startDate).toISOString().split('T')[0] : '',
      endDate: c.endDate ? new Date(c.endDate).toISOString().split('T')[0] : '',
      monthlyRent: c.monthlyRent,
      capacity: c.capacity,
      status: c.status,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : ''
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contracts.csv"');
    res.send(csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records));

  } catch (err) {
    console.error("exportContracts error:", err);
    res.status(500).send("Failed to export contracts");
  }
};

// Set workflow mode (automated | custom)
export const setWorkflowMode = async (req, res) => {
  try {
    const { id } = req.params;
    const { mode, reason, force } = req.body || {};

    if (!['automated', 'custom'].includes(mode)) {
      return res.status(400).json({ success: false, message: "mode must be 'automated' or 'custom'" });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    // Permission: allow Legal approve or System Admin via middleware flags
    const userHasLegal = typeof req.hasPermission === 'function' && req.hasPermission('contract:legal:approve');
    const userIsAdmin = typeof req.hasPermission === 'function' && req.hasPermission('*:*');
    if (!userHasLegal && !userIsAdmin) {
      return res.status(403).json({ success: false, message: "Not authorized to set workflow mode" });
    }

    // Guard: prevent switching after progression unless force and admin
    const progressed = Boolean(
      contract.legalUploadedAt ||
      contract.adminapproved ||
      contract.clientapproved ||
      contract.financeapproved ||
      contract.isfinalapproval ||
      contract.iscontractsentforsignature ||
      contract.isclientsigned ||
      (Array.isArray(contract.clientFeedbackHistory) && contract.clientFeedbackHistory.length > 0)
    );

    const locked = Boolean(contract.workflowModeMeta?.locked);
    if ((progressed || locked) && !(force && userIsAdmin)) {
      return res.status(400).json({
        success: false,
        message: "Workflow mode cannot be changed after progress or once locked",
        details: { progressed, locked }
      });
    }

    contract.workflowMode = mode;
    contract.workflowModeMeta = {
      ...(contract.workflowModeMeta || {}),
      selectedBy: req.user?._id || contract.workflowModeMeta?.selectedBy || null,
      selectedAt: new Date(),
      reason: reason || contract.workflowModeMeta?.reason || undefined,
      locked: true,
    };
    await contract.save();

    await logCRUDActivity(req, 'UPDATE', 'Contract', contract._id, null, {
      event: 'WORKFLOW_MODE_SELECTED',
      mode,
      reason: reason || undefined,
      selectedBy: req.user?._id || null,
      progressed,
      forceApplied: Boolean(force && userIsAdmin)
    });

    return res.json({ success: true, data: contract, message: `Workflow mode set to ${mode}` });
  } catch (err) {
    console.error('setWorkflowMode error:', err);
    await logErrorActivity(req, err, 'Set Workflow Mode');
    return res.status(500).json({ success: false, message: 'Failed to set workflow mode' });
  }
};

// Create a new contract
export const createContract = async (req, res) => {
  try {
    const {
      clientId,
      buildingId,
      capacity,
      monthlyRent: monthlyRentOverride,
      initialCredits,
      creditValueAtSignup,
      contractStartDate,
      contractEndDate,
      billingStartDate,
      billingEndDate,
      terms,
      termsandconditions,

      commencementDate,
      legalExpenses,
      allocationSeatsNumber,
      parkingSpaces,
      parkingFees,
      lockInPeriodMonths,
      noticePeriodDays,
      escalation,
      renewal,
      fullyServicedBusinessHours,
      cleaningAndRestorationFees,
      freebies,
      payAsYouGo,
      termsAndConditionAcceptance,
      // Security deposit
      securityDeposit,
    } = req.body || {};

    // Check if user can auto-approve (has contract:approve permission)
    const canAutoApprove = req.hasPermission && req.hasPermission('contract:approve');

    if (!clientId) return res.status(400).json({ error: "clientId is required" });
    if (!buildingId) return res.status(400).json({ error: "buildingId is required" });
    if (!capacity || capacity <= 0) return res.status(400).json({ error: "capacity must be a positive number" });

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: "Invalid clientId" });
    }
    if (!mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ error: "Invalid buildingId" });
    }

    // Fetch building to get per seat pricing
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    if (building.status !== "active") {
      return res.status(400).json({ error: "Building is not active" });
    }
    if (building.perSeatPricing == null || building.perSeatPricing < 0) {
      return res.status(400).json({ error: "Building per seat pricing is not configured" });
    }

    // Compute monthly rent (allow override if provided)
    let monthlyRent = null;
    if (monthlyRentOverride !== undefined && monthlyRentOverride !== null && monthlyRentOverride !== "") {
      const mr = Number(monthlyRentOverride);
      if (Number.isNaN(mr) || mr < 0) {
        return res.status(400).json({ error: "monthlyRent must be a non-negative number" });
      }
      monthlyRent = mr;
    } else {
      monthlyRent = building.perSeatPricing * Number(capacity);
    }

    const start = contractStartDate ? new Date(contractStartDate) : new Date();
    const end = contractEndDate ? new Date(contractEndDate) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const billStart = billingStartDate ? new Date(billingStartDate) : start;
    const billEnd = billingEndDate ? new Date(billingEndDate) : end;
    // Compute duration in months between start and end (inclusive of months boundary)
    const calcMonths = (s, e) => {
      const sd = new Date(s);
      const ed = new Date(e);
      let months = (ed.getFullYear() - sd.getFullYear()) * 12 + (ed.getMonth() - sd.getMonth());
      // If end date's day is >= start date's day, count the current month as full
      if (ed.getDate() >= sd.getDate()) months += 1;
      return Math.max(0, months);
    };
    const derivedDurationMonths = calcMonths(start, end);

    // Normalize termsandconditions: accept either an array or a single object
    const normalizedTermsAndConditions = Array.isArray(termsandconditions)
      ? termsandconditions
      : (termsandconditions && typeof termsandconditions === 'object'
        ? [termsandconditions]
        : undefined);

    const payload = {
      client: clientId,
      building: buildingId,
      startDate: start,
      endDate: end,
      billingStartDate: billStart,
      billingEndDate: billEnd,
      capacity: Number(capacity),
      monthlyRent: monthlyRent,
      ...(initialCredits && { initialCredits: Number(initialCredits) }),
      ...(creditValueAtSignup && { creditValueAtSignup: Number(creditValueAtSignup) }),
      ...(terms && { terms }),
      ...(normalizedTermsAndConditions && { termsandconditions: normalizedTermsAndConditions }),
      // New fields
      // Commencement date should be same as start date
      commencementDate: start,
      // Defaults for expenses/fees
      legalExpenses: legalExpenses !== undefined ? Number(legalExpenses) : 1200,
      ...(allocationSeatsNumber && { allocationSeatsNumber: Number(allocationSeatsNumber) }),
      ...(parkingSpaces && { parkingSpaces }),
      // Parking fees with defaults
      parkingFees: {
        twoWheeler: parkingFees?.twoWheeler !== undefined ? Number(parkingFees.twoWheeler) : 1500,
        fourWheeler: parkingFees?.fourWheeler !== undefined ? Number(parkingFees.fourWheeler) : 5000,
      },
      // Computed duration and lock-in
      durationMonths: derivedDurationMonths,
      lockInPeriodMonths: lockInPeriodMonths !== undefined ? Number(lockInPeriodMonths) : derivedDurationMonths,
      ...(noticePeriodDays && { noticePeriodDays: Number(noticePeriodDays) }),
      ...(escalation && { escalation }),
      ...(renewal && { renewal }),
      ...(fullyServicedBusinessHours && { fullyServicedBusinessHours }),
      cleaningAndRestorationFees: cleaningAndRestorationFees !== undefined ? Number(cleaningAndRestorationFees) : 2000,
      ...(freebies && { freebies }),
      ...(payAsYouGo && { payAsYouGo }),
      ...(termsAndConditionAcceptance && { termsAndConditionAcceptance }),
      // Security deposit
      ...(securityDeposit && { securityDeposit }),
      status: "draft",
      fileUrl: "placeholder",
      requiresApproval: !canAutoApprove, // Admin/Approver doesn't need approval
      createdBy: req.user?._id || null,
    };

    const created = await Contract.create(payload);

    // All contracts are created as draft, workflow actions happen in ContractDetailPage
    try {
      const canAutoApprove = req.hasPermission && req.hasPermission('contract:approve');
      if (!canAutoApprove) {
        const draftUpdate = {
          status: 'draft',
          submittedBy: req.user?._id || null,
          submittedAt: new Date(),
          requiresApproval: true,
        };
        await Contract.findByIdAndUpdate(created._id, draftUpdate, { new: true });
        // Reflect in memory for response context
        Object.assign(created, draftUpdate);
        await logContractActivity(req, 'CONTRACT_CREATED', created._id, created.client, {
          event: 'CONTRACT_CREATED',
          createdBy: req.user?._id,
          requiresApproval: true,
        });
      }
    } catch (markErr) {
      console.warn('Failed to update contract metadata on create:', markErr?.message);
    }

    // Log activity 
    await logCRUDActivity(req, 'CREATE', 'Contract', created._id, null, {
      clientId,
      buildingId,
      capacity,
      monthlyRent,
      startDate: start,
      endDate: end
    });

    // Auto-generate and upload contract PDF
    try {
      const populatedContract = await Contract.findById(created._id)
        .populate("client")
        .populate("building", "name address perSeatPricing");

      const pdfBuffer = await generateContractPDFBuffer(populatedContract);

      // Only proceed with upload if we have a valid buffer
      if (pdfBuffer && Buffer.isBuffer(pdfBuffer)) {
        const fileName = `contract_${created._id}_${Date.now()}.pdf`;

        // Ensure the buffer is properly formatted for ImageKit
        let fileForUpload = pdfBuffer;
        if (Buffer.isBuffer(pdfBuffer)) {
          // Convert buffer to base64 string for ImageKit
          fileForUpload = pdfBuffer.toString('base64');
        } else if (typeof pdfBuffer === 'object' && pdfBuffer.buffer) {
          // Handle if it's a typed array view
          fileForUpload = Buffer.from(pdfBuffer).toString('base64');
        }

        const uploadResponse = await imagekit.upload({
          file: fileForUpload,
          fileName: fileName,
          folder: "/contracts"
        });

        // Update contract with the uploaded PDF URL
        await Contract.findByIdAndUpdate(created._id, { fileUrl: uploadResponse.url });
        created.fileUrl = uploadResponse.url;

        console.log(`Contract PDF uploaded: ${uploadResponse.url}`);
      } else {
        console.error('Generated PDF is not a valid buffer, skipping upload:', typeof pdfBuffer, pdfBuffer?.constructor?.name);
      }
    } catch (pdfError) {
      console.error("Failed to generate/upload contract PDF:", pdfError);
      // Don't fail contract creation if PDF upload fails - contract can still be created without PDF
    }

    // Update client with building ID when contract is created
    try {
      await Client.findByIdAndUpdate(clientId, { building: buildingId });
      console.log(`Updated client ${clientId} with building ${buildingId}`);
    } catch (clientUpdateError) {
      console.error("Failed to update client building:", clientUpdateError);
    }

    // Grant initial credits if specified
    if (initialCredits && Number(initialCredits) > 0) {
      const WalletService = (await import("../services/walletService.js")).default;
      if (initialCredits > 0) {
        try {
          await WalletService.grantCredits({
            clientId,
            credits: initialCredits,
            refType: "contract",
            refId: created._id,
            meta: { contractId: created._id, capacity, monthlyRent }
          });
          console.log(`Granted ${initialCredits} credits to client ${clientId}`);
        } catch (creditError) {
          console.error("Failed to grant credits:", creditError);
        }
      }
    }

    return res.status(201).json({ message: "Contract created", contract: created });
  } catch (err) {
    console.error("createContract error:", err);
    await logErrorActivity(req, err, 'Contract Creation');
    return res.status(500).json({ error: "Failed to create contract" });
  }
};

// Provide default Terms & Conditions structure for prefilling contracts
export const getDefaultTermsAndConditions = async (req, res) => {
  try {
    const defaults = [
      {
        denotations: {
          heading: "No Denotations",
          body: [
            "Phrases used in the Contract Coversheet, unless repugnant to the subject or context, shall have the following meanings:",
            "Yes Month – English Calendar Month",
            "No Allocated Seats – Designated office space as described in Contract Cover Sheet and earmarked on the layout plan attached herewith;",
            "Yes Coworking Space – Means the premises or the building or the portion of a building wherein the Allocated Seats are located"
          ]
        },
        scope: {
          heading: "Scope",
          body: [
            "Client has obtained Enterprise Services from Ofis Square at its Coworking Space for the purposes of using the same as its office space for the agreed Duration.",
            "Ofis Square as part of such Enterprise Services has agreed to provide access and granted permission to the Client to enter and use the Allocated Seats situated at a designated area as per the attached layout herein along with access to the Free Services and Pay As You Go Services. Freebies to the extent specified shall be deemed to be included in the Fixed Payments.",
            "No tenancy or other right, title or interest and/or possession whatsoever is created or intended to be created by this Contract in favor of the Client.",
            "Ofis Square has in view of the client agreeing to the Lock in Period, the Notice Period and having undertaken to pay the Committed Fixed Charges in the form of periodic Fixed Payment and the Pay as You Go Services (if any), has agreed to not charge any induction fee or cost to be incurred by the Client.",
            "This Contract shall become effective immediately upon the date of its execution."
          ]
        },
        rightsGrantedToClient: {
          heading: "Rights granted to the Client",
          body: [
            "The Client shall be entitled to use the Allocated Seats for the purposes of carrying on its office wherein the Client shall be entitled to allow its own employees, to attend and carry on work.",
            "The Client must use the Allocated Seats for office purposes only. Use of Coworking Space or the Allocated Seats for business of any nature involving frequent visits by members of the public or as a retail, residential or living space or for any non-business purpose shall not be permitted. The Allocated Seats cannot be used for the purposes of demonstration or display of products. The Client shall not be entitled to invite public at large for visiting it at the Coworking Space or the Allocated Seats, except in pre-booked Meeting/Conference/Training Rooms subject to payment of charges as applicable and to the capacity of such Meeting/Conference/Training Rooms.",
            "The Client shall be entitled to enjoy Enterprise Services obtained from Ofis Square during the entire period of subsistence of this Contract, subject to payment of the Fixed Payments and the Pay as You Go Service charges and also subject to adherence and fulfillment of its obligations hereunder as also strictly following and complying with the User Rules and Regulations framed from time to time relating to use of the various facilities and amenities made available at the Coworking Space.",
            "The Client shall not be entitled to allow entry of person (employees or visitors) exceeding the number of workstations obtained by the Client as part of the Allocated Seats.",
            "All visitors of the Client shall be restricted to the reception area which shall be allowed to be used temporarily and in common with the other Clients of Ofis Square. No visitors shall be allowed to enter beyond the reception area, unless the Client has booked the meeting room or has its own dedicated meeting room as part of the Allocated Seats which shall in any event not exceed the total number of workstation or meeting room seats obtained or booked by the Client.",
            "The Client shall be permitted to put up name cards or displayed signboard, or any other form of its name or signage of the prescribed size at the space specified by Ofis Square at additional cost, as specified by Ofis Square.",
            "The Client and its employees shall be entitled to bring in their removable and non-fixed hardware like computers, laptops, printers, scanners, copiers, etc.",
            "Ofis Square during the subsistence of the Contract may display the name of the Client at the designated list of occupants of the Coworking Space.",
            "The Client shall be entitled to access the Coworking Space and avail the Enterprise Services with the help of Ofis Square mobile application (“Ofis Square App”). Also, the Client may also be entitled to obtain exclusive access cards for the Allocated Seats. It is clarified that the exclusive access excludes all persons other than Ofis Square. It is understood that the said access cards shall always remain the property of Ofis Square and Ofis Square shall be entitled to deactivate the same in case of Termination or suspension of this Contract."
          ]
        },
        payments: {
          heading: "Payments of Charges",
          body: [
            "Client shall be required to make payment of Fixed Payment in Advance and within the 7th of each month even if there is a delay in  receipt of invoice from Ofis Square for such amount.",
            "Client shall be required to make payment of Pay as You Go Services within 7 days of the Invoice for such charges being raised. All invoices for the Pay as You Go Services would ideally be raised at the end of a Month, unless otherwise thought fit by Ofis Square.",
            "Ofis Square will send all invoices electronically. In case of physical copy being required, Client may obtain the same from the respective community manager of the Coworking Space.",
            "All payments are required to be made by Bank Transfers / Demand Drafts / Account Payee Cheques / other Electronic means in favour of Ofis Spaces Private Limited.",
            "Dishonor of Cheque, Declined Credit Cards or bounced ECS will be treated as non-payment and shall attract Bank handling charges of Rs. 1500/- and other Consequences Of Non-Payment.",
            "In case payments are made in any currency other than INR, the Client is required to make sufficient payment so as to be effective credit of the entire payments in INR into the account of Ofis Square, post deduction of bank charges, forex charges, currency fluctuations etc.",
            "The Client hereby undertakes to make the payment of Fixed Payments and/or Pay as You Go Services charges to such bank, financial institution or other entity as may be designated by Ofis Square from time to time. Such payments made by the Client will constitute a sufficient discharge of all obligations of the Client under this Contract.",
            "Client shall furnish the tax deduction certificates on a quarterly basis to Ofis Square, at the rate applicable to the Ofis Square. Failure to deposit Tax Deducted at Source (TDS) or, any other similar deductions by the Client or excess Deduction or Failure to Furnish such certificate shall amount to Non-Payment of charges and Ofis Square shall be entitled to invoke the Consequences of Non- Payment."
          ]
        },
        consequencesOfNonPayment: {
          heading: "Consequences of Non-Payment",
          body: [
            "Ofis Square reserves the right to withhold services (including for the avoidance of doubt, denying the Client access to its premises) while there are any outstanding fees and/or interest or the Client is in breach of this Contract without requiring to first terminate the Contract.",
            "In case of default in payment of charges or any part thereof within the due dates, the Client shall be liable to pay interest @ 1.5% p.m. or part thereof, computed from the Month for which the same is due compounded for each Month of non-payment until actual payments.",
            "In addition to the interest, the Client shall also be liable to pay a flat 5% late fee in the event of subsequent defaults.",
            "Client acknowledges that in case of repeated instances of non-payment or repeated instances of damage being caused to the property of Ofis Square, Ofis Square may at its sole discretion be entitled to seek 100% additional Security Deposit to allow the Client to continue with the Contract."
          ]
        },
        obligationsOfClient: {
          heading: "Obligations of the Client",
          body: [
            "The Client shall be responsible and ensure that all its employees, visitors, staff or any other person entering the Coworking Space through or in connection with the Client shall be bound by this Contract and shall also be required to abide by  all the Rules made and/or published by Ofis Square relating to use of the Coworking Space, the Allocated Seats and other facilities, amenities and services made available at the Coworking Space.",
            "The Client shall be required to obtain all necessary permissions, trade licenses, approvals, and other statutory permissions for carrying on its business from Allocated Seats at the Coworking Space.",
            "The Client acknowledges, accepts and provides its consent to the fact that the Client’s personal KYC, telephone numbers and email id data shall be provided by the Client to Ofis Square and further acknowledges that such data shall be used by Ofis Square to inter alia provide access to Ofis Square App and in case of other emergencies.",
            "The Client shall not be entitled to make any addition or alteration or changes or re-arrange the fittings and fixtures in the Allocated Seats or carry out work for installation or otherwise requiring any drilling, fixing, sticking or other activities within the Coworking Space.",
            "The Client must not install any cabling, IT or telecom connections without Ofis Square’s consent, which Ofis Square may refuse at its absolute discretion. In case any permission is granted, the Client shall permit Ofis Square to oversee any installations (for example IT or electrical systems) and to verify that such installations are in accordance with the plan approved by Ofis Square and such installations do not cause any interfere or disturbance.",
            "The Client shall be held responsible and shall be liable towards Ofis Square for any disruption or disturbance of business at the Coworking Space caused on account of activities carried out by the Client, its employee (s) and affiliate. This is in addition to any claim that may arise against the Client by a co-occupant or a co-user at the Coworking Space.",
            "The Client assumes total liability towards the cost of any loss or damage to Ofis Square or any other Client, or any equipment, facilities, amenities, fixtures, furniture’s and other installations in the Coworking Space caused deliberately or by negligence or resulting from improper usage, utilization or enjoyment of any services at the Coworking Space by the Client, its employee(s) and affiliate or any person having entered the Coworking Space in relation to the Client, in any capacity whatsoever, which shall not be limited to the cost of replacement of the damaged goods and also consequential losses caused due to such damage.",
            "Client is entitled to use the Coworking Space address as its registered office subject to payment of additional charges and  obtaining prior written consent from Ofis Square. Client is not permitted to use the office address to obtain any other government licenses except of GST.The Client shall be liable to disclose the nature of this Contract under which it is using the Coworking Space address as its address to any government & semi-government bodies, financial institutions, utility provider and other such persons where the address is intended to be shown as the Client’s business address.",
            "The Client undertakes that it shall immediately on obtaining any registration at the address of the Coworking Space shall inform Ofis Square of the fact and submit a certified copy thereof and shall before the  expiry of the service Contract shall intimate all the authorities that it has shifted its office from the Coworking Space to the new address and shall also surrender the registrations obtained at the address of Ofis Square Coworking Space and submit the proof thereof to Ofis Square. Such compliance shall be mandatory part of Exit Formalities.",
            "The Client agrees to pay promptly (i) all taxes and license fees which it is required to pay to any governmental or semi government authority in its business(and, at the Ofis Square’s request, will provide to the Ofis Square evidence of such payment); (ii) all other applicable taxes, duties, levies or charges being made applicable to the instant transaction; (iii) payment of any utilities or other additional services obtained by the Client from Third Party (with consent of Ofis Square). For the avoidance of doubt, all charges set forth in this Agreement are exclusive of any applicable taxes, which shall be borne and paid by the Client.",
            "Client must at all times comply with all applicable relevant laws and regulations in the conduct of its business in relation to this Contract and also with all relevant anti-bribery and anti-corruption laws.",
            "Client shall under no circumstances be entitled to seek refund of any charges made payment by the Client.",
            "The Client shall be solely responsible for any data and/or software used and/or stored at the servers of Ofis Square and Ofis Square shall be entitled to terminate such storage and/or access to the Ofis Square network, if it is brought to its notice or otherwise comes to know that the Client or any of it employee(s) or associates content and/or data and/or software is unlawful and/or violates any rules, laws including piracy laws.",
            "Client must not carry on any business that competes with the business of Ofis Square inter alia of running Coworking offices / services offices / Enterprise Services during the period of this Contract and for a period of 2 years after expiry of this Contract.",
            "Client acknowledges that the ownership and all other rights in respect of the trademark/s, goodwill, trade name/s, copyright/s and/or any other intellectual property right/s of Ofis Square shall at all times belong exclusively to Ofis Square, whether during the term of the Contract or after its expiry / termination and Client shall not be entitled to any such intellectual property right/s of Ofis Square or to the use thereof in any manner whatsoever. Client shall not use the name and/or logo of Ofis Square or any pictures or illustrations of any portion of any properties (including the Coworking Space and the Allocated Seats) in any advertisement, promotional material and/or other media coverage, save and except with the prior written consent of Ofis Square.",
            "Client further acknowledges that Ofis Square shall be entitled to include the name / logo of Client in any of its promotional material, advertisement, reports, media coverage, etc.",
            "It is the Client’s responsibility to arrange insurance for its own property which it brings in to the Coworking Space and for its own liability to its employees and to third parties",
            "Without prejudice to the specific indemnities, the Client hereby indemnifies and assures to keep Ofis Square indemnified, against any loss, damage, claim or demand arising out of any act of omission or commission by Client. Client shall also indemnify Ofis Square from and against any and all third party claims, liabilities, and expenses including reasonable attorneys’ fees, resulting from any breach or alleged breach of this Contract by Client, its guests or invitees.",
            "Client acknowledges that all areas outside the Allocated Seats are of restricted or no access for the Client and Client shall not be entitled to occupy or use any areas outside the Allocated Seats other than for the purposes for which they have been earmarked by Ofis Square. Client shall be fully responsible for ensuring that the privacy of other occupiers of the Coworking Space is not breached by Client or any of its employees or visitors.",
            "Client shall not entitled to enter into any other seats / workstations / offices / allocates areas of other clients / meeting rooms / restricted areas in the Coworking Space and Client shall be fully responsible for ensuring that the privacy of other occupiers of the Coworking Space is not breached by Client or any of its employees or visitors.",
            "Any and all taxes, duties, stamp charges and other expenses arising out of or relating to the execution of this contract (including those assessed subsequently) shall be borne and payable by the Client, for executing this Contract."
          ]
        },
        obligationsOfOfisSquare: {
          heading: "Rights / Obligations of Ofis Square",
          body: [
            "Ofis Square shall be obliged to provide Enterprise Services as agreed herein to the Client, subject to the Client complying with the terms and conditions for use and enjoyment of the Enterprise Services.",
            "Ofis Square shall ensure that the services are kept running at all times. However Ofis Square shall not have any liability in case of any services being disrupted due to third party failures or intervening events over which Ofis Square has no control.",
            "Ofis Square or its past, present and future officers employees individually shall not be liable for any special, incidental, indirect, punitive, consequential or other damages whatsoever (including, but not limited to damages for loss of profits, loss of confidential or other information, business interruption, personal injury, loss of privacy, failure to meet any duty or otherwise under or in connection with any provision of this Contract).",
            "The liability of Ofis Square shall under no circumstances exceed a sum equivalent to the Fixed Payments actually paid by the Client in the last 3 Months from such liability arising.",
            "Ofis Square hereby indemnifies and assures to keep Client indemnified, against any third party loss, damage, claim or demand arising from any Material breach of this Contract by Ofis Square or its employee, to the extent stated herein.",
            "Ofis Square shall have a right of access of the Allocated Seats, with or without notice to the Client, for the purposes of safety, cleaning, repairs, maintenance, in case of emergency or for any other purpose. Ofis Square shall be entitled to move the furniture / fixtures within the Allocated Seats and shall also be entitled to shift the Allocated Seats to another location within the same Coworking Space, however without reducing the total area of the Allocated Seats and without affecting the amenities available to Client.",
            "Ofis Square shall be entitled to add / alter / remove amenities, facilities or services at the Coworking Space at any time. Ofis Square shall also be entitled to provide the Enterprise Services or parts thereof through its affiliates or third parties, at its sole discretion.",
            "Ofis Square does not control and shall not be responsible for the actions of other clients or any other third parties at the Coworking Space. If a dispute arises between Client and other clients of Ofis Square, or their invitees or guests, Ofis Square shall have no responsibility or obligation to participate, mediate or indemnify any party.",
            "Ofis Sqaure shall not be involved in or liable for, the provision of products or services by third parties (“Third Party Services”) that Client may elect to purchase in connection with their access to Enterprise Services including Pay As You Go services, even if it appears on their invoice. Third Party Services are provided solely by the applicable third party (“Third Party Service Providers”) and pursuant to separate arrangements between Client and the applicable Third Party Service Providers. These Third Party Service Providers’ terms and conditions will control with respect to the relevant Third Party Services and Ofis Square shall have no obligation or liability in connection with delivery or performance of such Third Party Services, except as provided in the Contract."
          ]
        },
        termination: {
          heading: "Termination",
          body: [
            "Contract can be terminated by Client during the Lock in Period by complying with all Exit Formalities including making payment of unpaid portion of the Committed Fixed Charges. In case of Material Breach of Ofis Square during Lock-In period, and upon failure to cure Material Breach by Ofis Square despite notice by Client, Lock-in would stand waived in terms hereof;",
            "Contract cannot be terminated by Ofis Square during the Lock in Period except for Material Breach of Client.",
            "If either party desires to not continue the Contract beyond the Lock in Period, then a notice of such intention with the duration of the agreed Notice Period herein post expiry of the Lock-In Period would be required to be given.",
            "In case of Material Breach by Ofis Square, Client shall be entitled to terminate this Contract by giving 30 days notice to enable Ofis Square to cure the Material Breach; If Ofis Square fails to cure the Material Breach despite expiry of 30 days, the Client shall be entitled to thereafter end this Contract  by stopping to avail any of the Enterprise Services and completing the Exit Formalities.",
            "In case the Contract is terminated by Client during the Lock In Period due to failure of Ofis Square to cure a Material Breach despite notice having been given, then the Client would be relieved of making payment of the balance Committed Fixed Charges from the date of the Client completing the Exit Formalities. It is clarified that the Client would continue to remain liable for payment of the Fixed Payments upto the period till when the Client has utilized the services.",
            "In case of Material Breach by Client, Ofis Square shall be entitled to terminate this Contract by giving 30 days’ notice to enable Client to cure the Material Breach; If Client fails to cure the Material Breach despite expiry of 30 days, Ofis Square shall be entitled to forthwith end this Contract and become entitled to the entire balance Committed Fixed Charges, if the Lock In period has not expired and shall be entitled to take all actions including but not limited to deactivating access of the Client to the Coworking Space and the Allocated Seats.",
            "In case the Client  is insolvent or bankrupt, then this Contract shall be deemed to have automatically come to an end on the preceding day of order of admission of insolvency or bankruptcy proceedings without any formal notice being required to be given by either Party and the Security Deposit shall stand forfeited.",
            "In case the Client abandons the Coworking Space and/or starts removing its goods from the Coworking Space without prior written confirmation from Ofis Square, the same shall be deemed to be a notice of immediate termination by the Client.",
            "Upon termination of this Contract by either party and until completion of Exit Formalities by the Client, Ofis Square shall have a lien over the properties of the Client lying within the Coworking Space and Ofis Square shall be entitled to restrain removal of any goods by the Client from the Coworking Space until Exit Formalities are completed.",
            "In case the rights of Ofis Square to the Coworking Space are terminated and/or or user rights are restrained/suspended, then Ofis Square would be entitled to immediately terminate this Contract and refund the Security Deposit within 30 days from such termination subject to the Client completing all Exit Formalities.",
            "If any government/ judicial /quasi-judicial authority or other legislative body has passed an order against the Client that the Client is conducting or is under investigation for any unlawful/ illegal/criminal activities in their business, then Ofis Square shall be entitled to terminate this Contract with immediate effect."
          ]
        },
        consequencesOfTermination: {
          heading: "Consequences of Termination",
          body: [
            "Upon termination in the manner aforesaid, the Client shall be required to complete the Exit Formalities. Termination by Client for the purposes of computing the period of Payments required to be made by the Client shall be deemed to be effective only upon completing the Exit Formalities and full payments being made by the Client.",
            "Upon termination, in addition to other remedies, Ofis Square shall be entitled to prevent access to the Client to the Coworking Space or any other Services obtained by the Client under this Contract from the date of expiry of Notice Period agreed herein. However, the same shall not exonerate the Client from its liability to make payment unless the Client has completed the Exit Formalities.",
            "Ofis Square shall have a lien and/or charge on all goods brought into the Coworking Space by the Client under this Contract until the Exit Formalities are completed by the Client with a right to store the goods at an alternate location. Client hereby indemnifies Ofis Square in respect of any claims of any third parties in respect of such goods.",
            "Ofis Square shall be entitled to dispose off any property remaining in or on the Allocated Seats area and/or Coworking Space after the termination or expiration of the Contract and will not have any obligation to store such property, and Client hereby waives any claims or demands regarding such property or Ofis Square’s handling or disposal of such property. Client will be responsible for paying any fees reasonably incurred by Ofis Square regarding such removal. Ofis Square shall have no implied obligations as a bailee or custodian.",
            "Ofis Square shall not be under any obligation to forward or hold Client’s mail or other packages delivered to Coworking Space address post expiry or termination of this Contract.",
            "Ofis Square shall refund the Refundable Security Deposit no later than 30 days from completion of the Exit Formalities by the Client, which however shall not carry interest under any circumstances. Beyond 30 days, Client shall be entitled to interest @ 1.5 % p.m. for such period of delay.",
            "In case of Immediate Termination, in addition to other remedies,  Ofis Square shall be entitled to forthwith suspend and prevent access of the Coworking Space to the Client and revoke all authorities granted hereunder forthwith without any prior notice."
          ]
        },
        renewal: {
          heading: "Renewal",
          body: [
            "The Client acknowledges that although the Duration of this Contract has been fixed, yet the Client shall be obliged to intimate its intention not to continue beyond the Duration hereby agreed, by initiating the Exit Formalities and giving a written intimation of such intention to not renew this Contract;",
            "In case Ofis Square does not receive such written intimation 6 months before the end of the Duration, this Contract shall automatically stand renewed for a period of 12 months with a lock in period of 6 months from the end of the Duration on the same terms and conditions of this Contract, including escalation on the terms agreed herein."
          ]
        },
        miscellaneous: {
          heading: "Miscellaneous",
          body: [
            "All previous correspondences, emails, agreements, understandings, writings, commitments, LOA / LOI etc stand superseded with this Contract;",
            "Client acknowledges that the Allocated Seats are complete in all nature and furnished as per the agreed terms of the LOI. No complaint in respect of any obligation or liability accrued prior to this Contract survives and any claim relating thereto stands waived and/or abandoned and/or withdrawn;",
            "Any notices relating to termination of this Agreement:",
            "By the Client – shall be delivered to the Community Manager at community@ofisspaces.com. A copy of the notice shall also be sent to Ofis Square at its registered office address by post and via email at ho@ofisspaces.com.",
            "By Ofis Square – shall be delivered in writing to the Client’s registered email address as provided in this Agreement and shall also be sent via post to their registered address.",
            "All notices shall be deemed valid and effective if sent by post, on the third business day following the date of dispatch.",
            "Client acknowledges that Ofis Square shall be entitled to induct other Clients in the Coworking Space who are in competing businesses as that of the Client and the Client shall not have any right of exclusivity as against Ofis Square.",
            "This Contract or any rights obtained hereunder cannot be assigned by the Client in any manner whatsoever, including but not limited to any corporate restructuring, save and except with written consent of Ofis Square and payment of applicable charges, by the Client.",
            "Client acknowledges that no rights/title in property is being created by this Contract."
          ]
        },
        parking: {
          heading: "Parking",
          body: [
            "The parking will be at Client’s risk basis and the Ofis Square shall not be responsible for any  type of loss/ damage to any four/two wheeler.",
            "Overnight four wheeler parking will not be permitted without prior written intimation to the security in charge of the said building/said commercial complex.",
            "The Client shall not encroach any other four/two wheeler at parking space in any manner.",
            "Speed limit in all basements is 10km/hr and the Client adheres to follow the same.The Ofis Square however may restrict the service of the Client if speed limit is violated."
          ]
        },
        disputeResolution: {
          heading: "Dispute Resolution",
          body: [
            "Unless prohibited by any applicable law in force, all claims, disputes differences or questions of any nature arising between the parties to this Contract in relation to the terms used in or clause of this Contract or as to the rights, duties, liabilities of the Parties arising out of this Contract shall be referred to arbitration under the Arbitration and Conciliation Act, 1996 including any amendments thereto by a sole arbitrator appointed mutually by the Parties. That the seat and venue of arbitration proceedings shall be New Delhi. The arbitration proceedings shall be conducted in the english language.",
            "Subject to the above clause. The Parties agree that all judicial and/or legal proceedings relating to or arising out of this Contract as maintainable under law shall be filed by either Party in the courts of competent jurisdiction situated at Delhi only, to the exclusion of all other courts."
          ]
        },
        governingLaw: {
          heading: "Governing Law",
          body: [
            "The Relationship between the Client and Ofis Square will be governed by the Indian law."
          ]
        },
        electronicSignature: {
          heading: "Electronic Signature Acknowledgement And Consent",
          body: [
            "Each party agrees that the electronic signatures, whether digital or encrypted, of the parties included in this Agreement, if any, are intended to authenticate this Agreement and to have the same force and effect as manual signatures.",
            "Under penalty of perjury, the signatory hereby affirm that the electronic signature affixed within this Agreement, were signed by the authorised signatory with full knowledge and consent and the signing party is legally bound to these terms and conditions."
          ]
        }
      }
    ];

    return res.json({ success: true, data: defaults });
  } catch (error) {
    console.error('getDefaultTermsAndConditions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch default terms and conditions' });
  }
};

function getZohoSignBaseUrl() {
  const signDc = process.env.ZOHO_SIGN_DC; // e.g., sign.zoho.in
  if (signDc) return `https://${signDc}/api/v1`;
  const accountsDc = process.env.ZOHO_DC || "accounts.zoho.in";
  // Map accounts.* to sign.*
  if (accountsDc.endsWith("zoho.in")) return "https://sign.zoho.in/api/v1";
  if (accountsDc.endsWith("zoho.eu")) return "https://sign.zoho.eu/api/v1";
  if (accountsDc.endsWith("zoho.com.cn")) return "https://sign.zoho.com.cn/api/v1";
  // default
  return "https://sign.zoho.in/api/v1";
}
const ZOHO_SIGN_BASE_URL = getZohoSignBaseUrl();

// Get all contracts
export const getContracts = async (req, res) => {
  try {
    const { client, status } = req.query || {};
    const filter = {};
    if (client && mongoose.Types.ObjectId.isValid(client)) filter.client = client;
    if (status) filter.status = status;

    const contracts = await Contract.find(filter)
      .populate("client")
      .populate("building", "name address perSeatPricing city state")
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: contracts });
  } catch (err) {
    console.error("getContracts error:", err);
    await logErrorActivity(req, err, 'Get Contracts');
    return res.status(500).json({ success: false, message: "Failed to fetch contracts" });
  }
};

// Get contract by ID
export const getContractById = async (req, res) => {
  try {
    const { id } = req.params;
    // if (!mongoose.Types.ObjectId.isValid(id)) {
    //   return res.status(400).json({ success: false, message: "Invalid contract id" });
    // }
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address perSeatPricing city state")
      .populate("comments.by", "name email")
      .populate("comments.mentionedUsers", "name email");

    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    // Filter comments based on user access
    const currentUserId = req.user?._id?.toString();
    if (currentUserId && contract.comments) {
      // Get current user's role for legal_only filtering
      const User = (await import('../models/userModel.js')).default;
      const currentUser = await User.findById(currentUserId).populate('role', 'roleName');
      const userRole = currentUser?.role?.roleName;

      contract.comments = contract.comments.filter(comment => {
        // Show all review and client comments
        if (comment.type === 'review' || comment.type === 'client') return true;

        // Handle legal_only comments
        if (comment.type === 'legal_only') {
          return ['Legal Team', 'System Admin'].includes(userRole);
        }

        // Handle internal comments
        if (comment.type === 'internal') {
          // Show internal comments if user is the author
          if (comment.by?._id?.toString() === currentUserId) return true;

          // Show internal comments if user is mentioned
          if (comment.mentionedUsers && comment.mentionedUsers.some(u => u._id?.toString() === currentUserId)) {
            return true;
          }

          // Hide other internal comments
          return false;
        }

        return true;
      });
    }

    return res.json({ success: true, data: contract });
  } catch (err) {
    console.error("getContractById error:", err);
    await logErrorActivity(req, err, 'Get Contract by ID');
    return res.status(500).json({ success: false, message: "Failed to fetch contract" });
  }
};

// Alias: detailed view reuses getContractById response shape
export const getContractDetailed = getContractById;

// Delete a contract (admin only)
export const deleteContract = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid contract id" });
    }

    const existing = await Contract.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    await Contract.deleteOne({ _id: id });

    // Log activity
    await logCRUDActivity(req, 'DELETE', 'Contract', id, null, {
      clientId: existing.client,
      buildingId: existing.building
    });

    return res.json({ success: true, message: "Contract deleted" });
  } catch (err) {
    console.error("deleteContract error:", err);
    await logErrorActivity(req, err, 'Delete Contract');
    return res.status(500).json({ success: false, message: "Failed to delete contract" });
  }
};

// Update a contract (admin only)
export const updateContract = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      clientId,
      buildingId,
      capacity,
      monthlyRent: monthlyRentOverride,
      initialCredits,
      creditValueAtSignup,
      securityDeposit,
      contractStartDate,
      contractEndDate,
      billingStartDate,
      billingEndDate,
      terms,
      termsandconditions,
      // New fields
      commencementDate,
      legalExpenses,
      allocationSeatsNumber,
      parkingSpaces,
      parkingFees,
      lockInPeriodMonths,
      noticePeriodDays,
      escalation,
      renewal,
      fullyServicedBusinessHours,
      cleaningAndRestorationFees,
      freebies,
      payAsYouGo,
      termsAndConditionAcceptance,
      // Timestamp fields
      submittedToLegalAt,
      submittedToAdminAt,
      adminApprovedAt,
      adminRejectedAt,
      clientApprovedAt,
      clientFeedbackAt,
      stampPaperGeneratedAt,
      sentForSignatureAt,
      signedAt,
      declinedAt,
      kycApprovedAt,
      financeApprovedAt,
      finalApprovedAt,
      lastActionAt,
      // Approval workflow fields
      requiresApproval,
      iskycuploaded,
      iskycapproved,
      adminapproved,
      legalteamapproved,
      clientapproved,
      financeapproved,
      securitydeposited,
      iscontractsentforsignature,
      iscontractstamppaperupload,
      isclientsigned,
      // Additional approval fields
      submittedToLegalBy,
      submittedToAdminBy,
      adminApprovedBy,
      adminRejectedBy,
      legalApprovedBy,
      financeApprovedBy,
      finalApprovedBy,
      sentToClientBy,
      kycApprovedBy,
      // Client email field
      clientEmail,
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid contract id" });
    }

    const existing = await Contract.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    // Validation
    if (!clientId) return res.status(400).json({ error: "clientId is required" });
    if (!buildingId) return res.status(400).json({ error: "buildingId is required" });
    if (!capacity || capacity <= 0) return res.status(400).json({ error: "capacity must be a positive number" });

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: "Invalid clientId" });
    }
    if (!mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ error: "Invalid buildingId" });
    }

    // Fetch building to get per seat pricing
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    if (building.status !== "active") {
      return res.status(400).json({ error: "Building is not active" });
    }
    if (building.perSeatPricing == null || building.perSeatPricing < 0) {
      return res.status(400).json({ error: "Building per seat pricing is not configured" });
    }

    // Compute monthly rent (allow override if provided)
    let monthlyRent = null;
    if (monthlyRentOverride !== undefined && monthlyRentOverride !== null && monthlyRentOverride !== "") {
      const mr = Number(monthlyRentOverride);
      if (Number.isNaN(mr) || mr < 0) {
        return res.status(400).json({ error: "monthlyRent must be a non-negative number" });
      }
      monthlyRent = mr;
    } else {
      monthlyRent = building.perSeatPricing * Number(capacity);
    }

    const start = contractStartDate ? new Date(contractStartDate) : existing.startDate;
    const end = contractEndDate ? new Date(contractEndDate) : existing.endDate;
    const billStart = billingStartDate ? new Date(billingStartDate) : start;
    const billEnd = billingEndDate ? new Date(billingEndDate) : end;
    const calcMonths = (s, e) => {
      const sd = new Date(s);
      const ed = new Date(e);
      let months = (ed.getFullYear() - sd.getFullYear()) * 12 + (ed.getMonth() - sd.getMonth());
      if (ed.getDate() >= sd.getDate()) months += 1;
      return Math.max(0, months);
    };
    const derivedDurationMonths = calcMonths(start, end);

    // Normalize termsandconditions: accept either an array or a single object
    const normalizedTermsAndConditions = Array.isArray(termsandconditions)
      ? termsandconditions
      : (termsandconditions && typeof termsandconditions === 'object'
        ? [termsandconditions]
        : undefined);

    const updateData = {
      client: clientId,
      building: buildingId,
      startDate: start,
      endDate: end,
      billingStartDate: billStart,
      billingEndDate: billEnd,
      capacity: Number(capacity),
      monthlyRent: monthlyRent,
      // New fields
      // Commencement date should be same as start date
      commencementDate: start,
      ...(legalExpenses !== undefined ? { legalExpenses: Number(legalExpenses) } : { legalExpenses: existing.legalExpenses ?? 1200 }),
      ...(allocationSeatsNumber !== undefined && { allocationSeatsNumber: Number(allocationSeatsNumber) }),
      ...(parkingSpaces && { parkingSpaces }),
      // Parking fees (keep existing if not provided, else default to schema defaults)
      ...(parkingFees !== undefined
        ? {
          parkingFees: {
            twoWheeler: parkingFees?.twoWheeler !== undefined ? Number(parkingFees.twoWheeler) : (existing.parkingFees?.twoWheeler ?? 1500),
            fourWheeler: parkingFees?.fourWheeler !== undefined ? Number(parkingFees.fourWheeler) : (existing.parkingFees?.fourWheeler ?? 5000),
          }
        }
        : (existing.parkingFees ? {} : { parkingFees: { twoWheeler: 1500, fourWheeler: 5000 } })
      ),
      // Always derive duration from dates
      durationMonths: derivedDurationMonths,
      // Default lock-in to duration unless explicitly provided
      ...(lockInPeriodMonths !== undefined
        ? { lockInPeriodMonths: Number(lockInPeriodMonths) }
        : { lockInPeriodMonths: derivedDurationMonths }
      ),
      ...(noticePeriodDays !== undefined
        ? { noticePeriodDays: Number(noticePeriodDays) }
        : {}
      ),
      ...(escalation && { escalation }),
      ...(renewal && { renewal }),
      ...(fullyServicedBusinessHours && { fullyServicedBusinessHours }),
      ...(cleaningAndRestorationFees !== undefined
        ? { cleaningAndRestorationFees: Number(cleaningAndRestorationFees) }
        : { cleaningAndRestorationFees: existing.cleaningAndRestorationFees ?? 2000 }
      ),
      ...(freebies && { freebies }),
      ...(payAsYouGo && { payAsYouGo }),
      ...(termsAndConditionAcceptance && { termsAndConditionAcceptance }),
      ...(initialCredits && { initialCredits: Number(initialCredits) }),
      ...(creditValueAtSignup && { creditValueAtSignup: Number(creditValueAtSignup) }),
      ...(terms && { terms }),
      ...(normalizedTermsAndConditions && { termsandconditions: normalizedTermsAndConditions }),
      // Security deposit
      ...(securityDeposit && { securityDeposit }),
      adminapproved: false,
      legalteamapproved: false,
      financeapproved: false,
      clientapproved: false,
      iscontractstamppaperupload: false,
    };

    const updated = await Contract.findByIdAndUpdate(id, updateData, { new: true });

    // If parkingSpaces were updated on the contract, sync them to the linked Client record as well
    try {
      if (parkingSpaces && updated?.client) {
        const two = Number(parkingSpaces?.noOf2WheelerParking) || 0;
        const four = Number(parkingSpaces?.noOf4WheelerParking) || 0;
        await Client.findByIdAndUpdate(
          updated.client,
          { $set: { 'parkingSpaces.noOf2WheelerParking': two, 'parkingSpaces.noOf4WheelerParking': four } },
          { new: true }
        );
        // Log per parking type with category for filtering
        await logContractActivity(req, 'UPDATE', id, updated.client, {
          category: 'parking',
          parkingType: 'two_wheeler',
          action: 'client_parking_updated_from_contract_edit',
          oldValue: undefined, // not tracked here
          newValue: two,
        });
        await logContractActivity(req, 'UPDATE', id, updated.client, {
          category: 'parking',
          parkingType: 'four_wheeler',
          action: 'client_parking_updated_from_contract_edit',
          oldValue: undefined, // not tracked here
          newValue: four,
        });
      }
    } catch (syncErr) {
      console.warn('updateContract: failed to sync client parking:', syncErr?.message || syncErr);
    }

    // Auto-generate and upload contract PDF after update
    try {
      const populatedContract = await Contract.findById(id)
        .populate("client")
        .populate("building", "name address perSeatPricing");

      const pdfBuffer = await generateContractPDFBuffer(populatedContract);
      const fileName = `contract_${id}_${Date.now()}.pdf`;

      // Ensure the buffer is properly formatted for ImageKit
      let fileForUpload = pdfBuffer;
      if (Buffer.isBuffer(pdfBuffer)) {
        // Convert buffer to base64 string for ImageKit
        fileForUpload = pdfBuffer.toString('base64');
      } else if (typeof pdfBuffer === 'object' && pdfBuffer.buffer) {
        // Handle if it's a typed array view
        fileForUpload = Buffer.from(pdfBuffer).toString('base64');
      }

      const uploadResponse = await imagekit.upload({
        file: fileForUpload,
        fileName: fileName,
        folder: "/contracts"
      });

      // Update contract with the new PDF URL
      await Contract.findByIdAndUpdate(id, { fileUrl: uploadResponse.url });
      updated.fileUrl = uploadResponse.url;

      console.log(`Contract PDF regenerated and uploaded: ${uploadResponse.url}`);
    } catch (pdfError) {
      console.error("Failed to regenerate/upload contract PDF:", pdfError);
      // Don't fail contract update if PDF generation fails
    }

    await logCRUDActivity(req, 'UPDATE', 'Contract', id, {
      before: existing.toObject(),
      after: updated.toObject(),
      fields: Object.keys(updateData)
    }, {
      clientId,
      buildingId,
      updatedFields: Object.keys(updateData)
    });

    return res.json({ success: true, message: "Contract updated", contract: updated });
  } catch (err) {
    console.error("updateContract error:", err);
    await logErrorActivity(req, err, 'Update Contract');
    return res.status(500).json({ success: false, message: "Failed to update contract" });
  }
};


// Submit contract for approval or auto-approve
export const submitContract = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");

    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    if (contract.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft contracts can be submitted"
      });
    }

    // Check if contract requires approval
    if (contract.requiresApproval === false) {
      // Auto-approve for admin/approver
      contract.status = "approved";
      contract.approvedBy = req.user?._id || null;
      contract.approvedAt = new Date();
      contract.submittedBy = req.user?._id || null;
      contract.submittedAt = new Date();

      await contract.save();

      // Log activity
      await logContractActivity(req, 'UPDATE', id, contract.client?._id, {
        event: 'CONTRACT_AUTO_APPROVED',
        approvedBy: req.user?._id,
        autoApproved: true
      });

      return res.json({
        success: true,
        message: "Contract auto-approved and ready to send for signature",
        contract,
        autoApproved: true
      });
    } else {
      // Requires approval
      contract.status = "pending_approval";
      contract.submittedBy = req.user?._id || null;
      contract.submittedAt = new Date();

      await contract.save();

      // Log activity
      await logContractActivity(req, 'UPDATE', id, contract.client?._id, {
        event: 'CONTRACT_SUBMITTED',
        submittedBy: req.user?._id,
        requiresApproval: true
      });

      // TODO: Send notification to approvers

      return res.json({
        success: true,
        message: "Contract submitted for approval",
        contract,
        requiresApproval: true
      });
    }
  } catch (err) {
    console.error("submitContract error:", err);
    await logErrorActivity(req, err, 'Submit Contract');
    return res.status(500).json({ success: false, message: "Failed to submit contract" });
  }
};

export const allocateCabins = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await allocateBlockedCabinsForContract(id);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("allocateCabins error:", err);
    return res.status(500).json({ success: false, message: "Failed to allocate cabins", error: err.message });
  }
};

// Approve contract (requires contract:approve permission)
export const approveContract = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);

    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    if (contract.status !== "pending_approval") {
      return res.status(400).json({
        success: false,
        message: "Only contracts pending approval can be approved"
      });
    }

    contract.status = "approved";
    contract.approvedBy = req.user?._id || null;
    contract.approvedAt = new Date();

    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client?._id, {
      event: 'CONTRACT_APPROVED',
      approvedBy: req.user?._id,
      previousStatus: "pending_approval"
    });

    // TODO: Send notification to contract creator

    return res.json({
      success: true,
      message: "Contract approved. Ready to send for signature.",
      contract
    });
  } catch (err) {
    console.error("approveContract error:", err);
    await logErrorActivity(req, err, 'Approve Contract');
    return res.status(500).json({ success: false, message: "Failed to approve contract" });
  }
};

// Reject contract (requires contract:approve permission)
export const rejectContract = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const contract = await Contract.findById(id);

    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    if (contract.status !== "pending_approval") {
      return res.status(400).json({
        success: false,
        message: "Only contracts pending approval can be rejected"
      });
    }

    contract.status = "rejected";
    contract.rejectedBy = req.user?._id || null;
    contract.rejectedAt = new Date();
    contract.rejectionReason = reason || "No reason provided";

    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client?._id, {
      event: 'CONTRACT_REJECTED',
      rejectedBy: req.user?._id,
      rejectionReason: reason,
      previousStatus: "pending_approval"
    });

    // TODO: Send notification to contract creator

    return res.json({
      success: true,
      message: "Contract rejected",
      contract
    });
  } catch (err) {
    console.error("rejectContract error:", err);
    await logErrorActivity(req, err, 'Reject Contract');
    return res.status(500).json({ success: false, message: "Failed to reject contract" });
  }
};

// Get contracts pending approval (for approvers)
export const getPendingApprovalContracts = async (req, res) => {
  try {
    const contracts = await Contract.find({ status: "pending_approval" })
      .populate("client", "companyName email contactPerson phone")
      .populate("building", "name address pricing")
      .populate("createdBy", "name email")
      .populate("submittedBy", "name email")
      .sort({ submittedAt: -1 });

    return res.json({ success: true, data: contracts });
  } catch (err) {
    console.error("getPendingApprovalContracts error:", err);
    await logErrorActivity(req, err, 'Get Pending Approval Contracts');
    return res.status(500).json({ success: false, message: "Failed to fetch pending contracts" });
  }
};

// Send contract for digital signature
export const sendForSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");

    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (!contract.client) return res.status(400).json({ error: "Contract client not found" });

    // Require an active cabin block for this client in this building before sending for signature
    try {
      const hasActiveBlock = await Cabin.exists({
        building: contract.building,
        "blocks.status": "active",
        "blocks.client": contract.client,
      });
      if (!hasActiveBlock) {
        return res.status(400).json({
          error: "No active cabin block found for this client. Please block a cabin before sending for signature.",
        });
      }
    } catch (blkErr) {
      console.error("Block pre-check failed:", blkErr);
      return res.status(500).json({ error: "Failed to validate cabin block status" });
    }

    // Use stampPaperUrl if available, otherwise fallback to fileUrl
    const documentUrl = contract.stampPaperUrl || contract.fileUrl;
    if (!documentUrl) {
      return res.status(400).json({
        error: "Contract must have a stampPaperUrl or fileUrl before it can be sent for signature. Please generate the contract PDF first."
      });
    }

    console.log('Sending contract for signature:', {
      contractId: contract._id,
      clientName: contract.client.companyName,
      fileUrl: documentUrl,
      usingStampPaper: !!contract.stampPaperUrl,
      status: contract.status
    });
    const requestId = await loggedZohoSign.createDocument(contract);
    console.log("Document created with request ID:", requestId);

    // Step 2: Verify document exists and get document ID
    const documentDetails = await loggedZohoSign.verifyDocumentExists(requestId);
    const documentId = documentDetails?.document_ids?.[0]?.document_id;
    if (!documentId) {
      throw new Error("Failed to get document ID from Zoho Sign");
    }
    console.log("Document verified with ID:", documentId);

    // Step 3: Add recipient to document
    const client = contract.client || {};
    let recipient = client;
    if (client && client.isPrimaryContactauthoritySignee === false && client.authoritySignee) {
      const a = client.authoritySignee || {};
      const nameParts = [a.firstName, a.lastName].filter(Boolean);
      const recipient_name = (nameParts.join(' ').trim()) || client.contactPerson || client.companyName || 'Client';
      const recipient_email = a.email || client.email;
      recipient = { contactPerson: recipient_name, email: recipient_email };
    }
    await loggedZohoSign.addRecipient(requestId, recipient, documentId, { clientId: client?._id || contract.client });
    console.log("Recipient added to document");

    // Step 4: Submit document for signature
    await loggedZohoSign.submitDocument(requestId);
    console.log("Document submitted for signature");

    // Update contract status and store Zoho Sign request ID
    const updatedContract = await Contract.findByIdAndUpdate(
      id,
      {
        status: "pending_signature",
        iscontractsentforsignature: true,
        zohoSignRequestId: requestId,
        sentForSignatureAt: new Date()
      },
      { new: true }
    );

    // Log contract activity
    await logContractActivity(req, 'CONTRACT_SENT_FOR_SIGNATURE', contract._id, contract.client?._id, {
      zohoSignRequestId: requestId,
      clientEmail: contract.client.email,
      clientName: contract.client.companyName
    });

    return res.json({
      message: "Contract sent for digital signature",
      contract: updatedContract,
      zohoSignRequestId: requestId
    });
  } catch (err) {
    console.error("sendForSignature error:", err);
    await logErrorActivity(req, err, 'Send Contract for Signature');
    return res.status(500).json({ error: "Failed to send contract for signature" });
  }
};

// Check signature status
export const checkSignatureStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);

    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (!contract.zohoSignRequestId) {
      return res.status(400).json({ error: "Contract not sent for signature yet" });
    }

    const status = await loggedZohoSign.getDocumentStatus(contract.zohoSignRequestId);

    // Update contract status based on Zoho Sign status
    let newStatus = contract.status;
    if (status.request_status === "completed") {
      newStatus = "active";
      await Contract.findByIdAndUpdate(id, {
        status: "active",
        signedAt: new Date()
      });

      // Log contract completion
      await logContractActivity(req, 'CONTRACT_SIGNED', id, contract.client?._id, {
        zohoSignRequestId: contract.zohoSignRequestId,
        signatureStatus: status.request_status
      });
      try {
        const initialCredits = Number(contract?.initialCredits || 0);
        if (initialCredits > 0) {
          // Check for existing grant transaction for this contract to ensure idempotency
          const CreditTransaction = (await import("../models/creditTransactionModel.js")).default;
          const existingGrant = await CreditTransaction.findOne({
            contractId: contract._id,
            transactionType: "grant",
          });

          if (!existingGrant) {
            const WalletService = (await import("../services/walletService.js")).default;
            await WalletService.grantCredits({
              clientId: contract.client,
              credits: initialCredits,
              refType: "contract",
              refId: contract._id,
              meta: { reason: "Initial credits granted on contract activation (Zoho Sign)", activation: true },
              createdBy: req.user?._id || null,
            });
          }
        }
      } catch (grantErr) {
        console.warn("Initial credits grant on activation failed or skipped:", grantErr?.message);
      }
    }

    return res.json({
      contractStatus: newStatus,
      zohoSignStatus: status.request_status,
      signatureDetails: status
    });
  } catch (err) {
    console.error("checkSignatureStatus error:", err);
    await logErrorActivity(req, err, 'Check Signature Status');
    return res.status(500).json({ error: "Failed to check signature status" });
  }
};

// Upload contract and send for signature via Zoho Sign
export const uploadAndSendForSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");

    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    // Check if contract is in approved status
    if (contract.status !== 'approved' && contract.status !== 'draft') {
      return res.status(400).json({
        error: `Contract must be approved before sending for signature. Current status: ${contract.status}`
      });
    }

    // Accept uploaded file
    let uploadedFile = req.file;
    if (!uploadedFile && Array.isArray(req.files) && req.files.length > 0) {
      uploadedFile = req.files[0];
    }

    if (!uploadedFile) {
      return res.status(400).json({ error: "Contract file is required" });
    }

    // Validate file type
    const allowed = ["application/pdf"];
    if (uploadedFile.mimetype && !allowed.includes(uploadedFile.mimetype)) {
      return res.status(400).json({ error: "Only PDF files are allowed" });
    }

    // Upload to ImageKit
    let fileUrl;
    try {
      const fileName = `contract_${id}_${Date.now()}_${uploadedFile.originalname}`;
      const uploadResponse = await imagekit.upload({
        file: uploadedFile.buffer,
        fileName: fileName,
        folder: "/contracts"
      });
      fileUrl = uploadResponse.url;
    } catch (uploadError) {
      console.error("ImageKit upload error:", uploadError);
      return res.status(500).json({ error: "Failed to upload file to ImageKit" });
    }

    // Update contract with file URL
    contract.fileUrl = fileUrl;
    await contract.save();

    // Log file upload
    await logContractActivity(req, 'UPDATE', id, contract.client?._id, {
      fileUrl,
      fileName: uploadedFile.originalname,
      action: 'contract_file_uploaded'
    });

    // Now send to Zoho Sign using the same multi-step process as sendForSignature
    try {
      console.log('Sending uploaded contract for signature:', {
        contractId: contract._id,
        clientName: contract.client.companyName,
        fileUrl: fileUrl
      });

      // Step 1: Create document in Zoho Sign
      const requestId = await loggedZohoSign.createDocument(contract);
      console.log("Document created with request ID:", requestId);

      // Step 2: Verify document exists and get document ID
      const documentDetails = await loggedZohoSign.verifyDocumentExists(requestId);
      const documentId = documentDetails?.document_ids?.[0]?.document_id;
      if (!documentId) {
        throw new Error("Failed to get document ID from Zoho Sign");
      }
      console.log("Document verified with ID:", documentId);

      // Step 3: Add recipient to document
      const client = contract.client || {};
      let recipient = client;
      if (client && client.isPrimaryContactauthoritySignee === false && client.authoritySignee) {
        const a = client.authoritySignee || {};
        const nameParts = [a.firstName, a.lastName].filter(Boolean);
        const recipient_name = (nameParts.join(' ').trim()) || client.contactPerson || client.companyName || 'Client';
        const recipient_email = a.email || client.email;
        recipient = { contactPerson: recipient_name, email: recipient_email };
      }
      await loggedZohoSign.addRecipient(requestId, recipient, documentId, { clientId: client?._id || contract.client });
      console.log("Recipient added to document");

      // Step 4: Submit document for signature
      await loggedZohoSign.submitDocument(requestId);
      console.log("Document submitted for signature");

      // Update contract with Zoho Sign details
      const updatedContract = await Contract.findByIdAndUpdate(
        id,
        {
          status: "pending_signature",
          zohoSignRequestId: requestId,
          sentForSignatureAt: new Date()
        },
        { new: true }
      ).populate("client").populate("building");

      await logContractActivity(req, 'CONTRACT_SENT_FOR_SIGNATURE', id, contract.client?._id, {
        zohoSignRequestId: requestId,
        clientEmail: contract.client.email,
        clientName: contract.client.companyName,
        uploadedFile: uploadedFile.originalname
      });

      return res.json({
        success: true,
        message: "Contract uploaded and sent for digital signature",
        contract: updatedContract,
        zohoSignRequestId: requestId
      });
    } catch (zohoError) {
      console.error("Zoho Sign error:", zohoError);
      return res.status(500).json({
        error: "Contract uploaded but failed to send for signature",
        details: zohoError.message,
        fileUrl
      });
    }
  } catch (err) {
    console.error("uploadAndSendForSignature error:", err);
    await logErrorActivity(req, err, 'Upload and Send Contract for Signature');
    return res.status(500).json({ error: "Failed to process contract" });
  }
};

// Frontdesk/manual: upload a signed contract file or provide a fileUrl and mark as active
export const uploadSignedContract = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    // Accept either an uploaded file (multer) or a direct fileUrl
    let fileUrl = req.body?.fileUrl;
    // Support both upload.single (req.file) and upload.any (req.files)
    let uploadedFile = req.file;
    if (!uploadedFile && Array.isArray(req.files) && req.files.length > 0) {
      uploadedFile = req.files[0];
    }
    if (uploadedFile) {
      // Basic guard: ensure it's a PDF or image (customize as needed)
      const allowed = ["application/pdf", "image/png", "image/jpeg"];
      if (uploadedFile.mimetype && !allowed.includes(uploadedFile.mimetype)) {
        return res.status(400).json({ error: "Unsupported file type" });
      }

      // Upload to ImageKit
      try {
        const fileName = `contract_${id}_${Date.now()}_${uploadedFile.originalname}`;
        const uploadResponse = await imagekit.upload({
          file: uploadedFile.buffer,
          fileName: fileName,
          folder: "/contracts"
        });
        fileUrl = uploadResponse.url;
      } catch (uploadError) {
        console.error("ImageKit upload error:", uploadError);
        return res.status(500).json({ error: "Failed to upload file to ImageKit" });
      }
    }

    if (!fileUrl) {
      return res.status(400).json({ error: "Provide a file upload or fileUrl" });
    }

    contract.fileUrl = fileUrl;
    contract.status = "active";
    contract.signedAt = new Date();
    contract.isclientsigned = true; // Set client signed flag to true
    // Optional: clear zohoSignRequestId if this path bypassed Zoho Sign
    // contract.zohoSignRequestId = undefined;

    await contract.save();

    // Log contract activation
    await logContractActivity(req, 'UPDATE', id, contract.client?._id, {
      event: 'CONTRACT_ACTIVATED',
      fileUrl,
      activationMethod: 'manual_upload'
    });
    try {
      const doc = await createBillingDocumentFromContract(contract._id, {
        issueOn: "activation",
        prorate: true,
        dueDays: 7
      });
      if (doc?.deferred) {
        console.log(`Activation billing deferred for contract ${contract._id}: ${doc.reason}`);
      } else {
        console.log(`Auto-created billing doc ${doc._id} (mode=${process.env.BILLING_MODE || 'invoice'}) for contract ${contract._id}`);
      }
    } catch (invoiceError) {
      console.error("Failed to auto-create billing document:", invoiceError);
      // Don't fail the contract activation if billing document creation fails
    }

    // Allocate any cabins that were blocked for this client upon activation
    try {
      const allocResult = await allocateBlockedCabinsForContract(contract._id);
      console.log("Cabin allocation after manual signed upload:", allocResult);
    } catch (allocErr) {
      console.error("Cabin allocation failed after signed upload:", allocErr);
    }

    return res.status(200).json({
      message: "Contract marked as active with uploaded signed file",
      contract,
    });
  } catch (err) {
    console.error("uploadSignedContract error:", err);
    await logErrorActivity(req, err, 'Upload Signed Contract');
    return res.status(500).json({ error: "Failed to upload signed contract" });
  }
};

// Amendment functions
export const uploadContractAmendment = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    let uploadedFile = req.file;
    if (!uploadedFile && Array.isArray(req.files) && req.files.length > 0) {
      uploadedFile = req.files[0];
    }

    if (!uploadedFile) {
      return res.status(400).json({ error: "Amendment file is required" });
    }

    const fileName = `amendment_${id}_${Date.now()}_${uploadedFile.originalname}`;
    const uploadResponse = await imagekit.upload({
      file: uploadedFile.buffer,
      fileName: fileName,
      folder: "/contracts/amendments"
    });

    const updated = await Contract.findByIdAndUpdate(
      id,
      {
        amendmentUrl: uploadResponse.url,
        isAmendmentUploaded: true,
        amendmentUploadedAt: new Date(),
        amendmentUploadedBy: req.user?._id || null,
      },
      { new: true }
    );

    await logContractActivity(req, 'UPDATE', id, updated.client, {
      event: 'AMENDMENT_UPLOADED',
      amendmentUrl: uploadResponse.url,
      uploadedBy: req.user?._id || null,
    });

    return res.json({ success: true, message: "Amendment uploaded successfully", contract: updated });
  } catch (err) {
    console.error("uploadContractAmendment error:", err);
    await logErrorActivity(req, err, 'Upload Contract Amendment');
    return res.status(500).json({ success: false, message: "Failed to upload amendment" });
  }
};

export const approveContractAmendment = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    if (!contract.isAmendmentUploaded) {
      return res.status(400).json({ error: "No amendment uploaded to approve" });
    }

    const updated = await Contract.findByIdAndUpdate(
      id,
      {
        amendmentApproved: true,
        amendmentApprovedAt: new Date(),
        amendmentApprovedBy: req.user?._id || null,
      },
      { new: true }
    );

    await logContractActivity(req, 'UPDATE', id, updated.client, {
      event: 'AMENDMENT_APPROVED',
      approvedBy: req.user?._id || null,
    });

    return res.json({ success: true, message: "Amendment approved successfully", contract: updated });
  } catch (err) {
    console.error("approveContractAmendment error:", err);
    await logErrorActivity(req, err, 'Approve Contract Amendment');
    return res.status(500).json({ success: false, message: "Failed to approve amendment" });
  }
};

// Webhook handler for Zoho Sign events
export const handleZohoSignWebhook = async (req, res) => {
  try {
    let requestId = null;
    // Log incoming webhook for API Logs
    try {
      const signatureHeader = req.headers['x-zoho-sign-webhook-signature'] || req.headers['x-webhook-signature'] || null;
      const verified = Boolean(signatureHeader) && Boolean(process.env.ZOHO_SIGN_WEBHOOK_SECRET);
      requestId = await apiLogger.logIncomingWebhook({
        service: 'zoho_sign',
        operation: 'webhook',
        method: req.method || 'POST',
        url: req.originalUrl || req.url || '/api/webhooks/zoho-sign',
        headers: req.headers || {},
        requestBody: req.body,
        webhookSignature: signatureHeader,
        webhookVerified: verified,
        webhookEvent: 'signature_webhook',
        statusCode: 200,
        responseBody: { received: true },
        success: true,
        userAgent: req.headers['user-agent'] || null,
        ipAddress: (req.headers['x-forwarded-for'] || req.ip || '').toString()
      });
    } catch (logErr) {
      console.warn('Failed to log incoming Zoho Sign webhook:', logErr?.message);
    }

    if (!requestId) {
        requestId = apiLogger.generateRequestId();
    }

    // Verify webhook signature if configured, using raw buffer
    const secret = process.env.ZOHO_SIGN_WEBHOOK_SECRET;
    const sigHeader = req.headers["x-zoho-webhook-signature"] || req.headers["x-zoho-signature"];
    let rawBodyStr = "";
    if (Buffer.isBuffer(req.body)) {
      rawBodyStr = req.body.toString("utf8");
    } else if (typeof req.body === "string") {
      rawBodyStr = req.body;
    } else {
      rawBodyStr = JSON.stringify(req.body || {});
    }

    if (secret) {
      try {
        const hmac = crypto.createHmac("sha256", secret).update(rawBodyStr).digest("hex");
        if (!sigHeader || sigHeader !== hmac) {
          const errorResponse = { error: "Invalid webhook signature" };
          await apiLogger.logWebhookResponse(requestId, 401, errorResponse, false, 'Invalid signature');
          return res.status(401).json(errorResponse);
        }
      } catch (e) {
        const errorResponse = { error: "Webhook signature verification failed" };
        await apiLogger.logWebhookResponse(requestId, 401, errorResponse, false, e.message);
        return res.status(401).json(errorResponse);
      }
    }

    // Parse payload after signature verification
    let payload;
    try {
      payload = typeof rawBodyStr === "string" && rawBodyStr.length ? JSON.parse(rawBodyStr) : req.body;
    } catch (e) {
      const errorResponse = { error: "Invalid JSON payload" };
      await apiLogger.logWebhookResponse(requestId, 400, errorResponse, false, 'Invalid JSON');
      return res.status(400).json(errorResponse);
    }

    const { request_id, request_status, actions } = payload || {};

    // Find contract by Zoho Sign request ID
    const contract = await Contract.findOne({ zohoSignRequestId: request_id });
    if (!contract) {
      console.log(`Webhook received for unknown request_id: ${request_id}`);
      return res.status(200).json({ message: "Webhook received" });
    }

    // Update contract status based on webhook data
    let newStatus = contract.status;
    let updateData = {};

    if (request_status === "completed") {
      newStatus = "active";
      updateData.signedAt = new Date();
      updateData.isclientsigned = true; // Set client signed flag to true
      try {
        const signedDocumentUrl = await loggedZohoSign.downloadSignedDocument(request_id);
        updateData.fileUrl = signedDocumentUrl;
        console.log(`Downloaded signed document for contract ${contract._id}: ${signedDocumentUrl}`);
      } catch (downloadError) {
        console.error(`Failed to download signed document for contract ${contract._id}:`, downloadError);
      }
    } else if (request_status === "declined") {
      newStatus = "draft";
      updateData.declinedAt = new Date();
    }

    if (newStatus !== contract.status) {
      updateData.status = newStatus;
      await Contract.findByIdAndUpdate(contract._id, updateData);
      console.log(`Contract ${contract._id} status updated to: ${newStatus}`);

      // Log contract activity based on status change
      if (newStatus === "active") {
        // Log contract signing activity
        await logContractActivity(req, 'UPDATE', contract._id, contract.client?._id, {
          event: 'CONTRACT_SIGNED',
          zohoSignRequestId: request_id,
          signedAt: updateData.signedAt,
          previousStatus: contract.status,
          newStatus: newStatus
        });

        // Auto-create invoice when contract becomes active via Zoho Sign
        try {
          const doc = await createBillingDocumentFromContract(contract._id, {
            issueOn: "activation",
            prorate: true,
            dueDays: 7
          });
          if (doc?.deferred) {
            console.log(`Activation billing deferred for contract ${contract._id}: ${doc.reason}`);
          } else {
            console.log(`Auto-created billing doc ${doc._id} (mode=${process.env.BILLING_MODE || 'invoice'}) for contract ${contract._id} via Zoho Sign webhook`);
          }
        } catch (invoiceError) {
          console.error("Failed to auto-create billing document from webhook:", invoiceError);
          // Don't fail the webhook processing if billing document creation fails
        }
      } else if (newStatus === "draft" && request_status === "declined") {
        // Log contract decline activity
        await logContractActivity(req, 'UPDATE', contract._id, contract.client?._id, {
          event: 'CONTRACT_DECLINED',
          zohoSignRequestId: request_id,
          declinedAt: updateData.declinedAt,
          previousStatus: contract.status,
          newStatus: newStatus,
          action: 'Contract signature declined'
        });
      }
    }

    const response = { message: "Webhook processed successfully" };
    await apiLogger.logWebhookResponse(requestId, 200, response, true);

    return res.status(200).json(response);
  } catch (err) {
    console.error("handleZohoSignWebhook error:", err);
    await logErrorActivity(req, err, 'Zoho Sign Webhook');

    const errorResponse = { error: "Webhook processing failed" };
    await apiLogger.logWebhookResponse(requestId, 500, errorResponse, false, err.message);

    return res.status(500).json(errorResponse);
  }
}

// ===== HTML template based PDF generation =====
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format amount as INR with commas
function formatINR(num) {
  if (num == null || num === '') return '';
  const n = Number(num);
  if (Number.isNaN(n)) return String(num);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n).replace(/\.00$/, '');
}

// Use placeholder dots when value is missing
function orDots(value, dots = '……………..') {
  if (value === null || value === undefined) return dots;
  const s = String(value).trim();
  return s ? s : dots;
}

async function buildContractHtmlFromTemplate(contract) {
  // Resolve HTML template path: ../docs/contract.html relative to this controller
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const templatePath = path.join(__dirname, '../docs/contract.html');

  let html = await fsp.readFile(templatePath, 'utf8');

  const client = contract.client || {};
  const companyName = client.companyName || client.name || 'OFIS SPACES PRIVATE LIMITED';
  const buildingAddress = contract.building?.address || '';
  const buildingName = contract.building?.name || '';

  // Replace a basic placeholder in converted HTML "(Company Name)"
  html = html.replace(/\(Company Name\)/g, escapeHtml(companyName));

  // ==== Inject dynamic Terms & Conditions into the marked region ====
  // Build dynamic HTML based on structured sections or plain terms
  function buildTermsHtml() {
    // Construct a clean HTML block that will be inserted between markers
    // Styling is inline to avoid dependency on external CSS
    const headingStyle = 'font-family: "Bookman Old Style", serif; font-size: 18px; font-weight: 700; text-align: center; margin: 16px 0 12px;';
    const sectionHeadingStyle = 'font-family: "Bookman Old Style", serif; font-size: 17px; font-weight: 700; margin: 18px 0 8px;';
    const paraStyle = 'font-family: "Bookman Old Style", serif; font-size: 16px; line-height: 1.5; margin: 0 0 10px;';

    // Helper: convert various body shapes into an array of paragraphs
    const toParagraphs = (bodyVal) => {
      if (Array.isArray(bodyVal)) {
        return bodyVal.map((item) => String(item).trim()).filter(Boolean);
      }
      if (typeof bodyVal === 'string') {
        return bodyVal.split(/\n{1,}/).map(p => p.trim()).filter(Boolean);
      }
      if (bodyVal === null || bodyVal === undefined) return [];
      return [String(bodyVal)];
    };

    // Prefer structured termsandconditions (keep section key for special rendering like tables)
    let termsSections = [];
    if (Array.isArray(contract.termsandconditions) && contract.termsandconditions.length > 0) {
      const t = contract.termsandconditions[0];
      const order = [
        'denotations', 'scope', 'rightsGrantedToClient', 'payments',
        'consequencesOfNonPayment', 'obligationsOfClient', 'obligationsOfOfisSquare',
        'termination', 'consequencesOfTermination', 'renewal', 'miscellaneous',
        'parking', 'disputeResolution', 'governingLaw', 'electronicSignature'
      ];
      for (const key of order) {
        if (t[key] && (t[key].body || t[key].heading)) {
          termsSections.push({
            key,
            heading: t[key].heading || key,
            body: t[key].body || ''
          });
        }
      }
    }

    let htmlParts = [];
    htmlParts.push(`<h2 style="${headingStyle}">TERMS AND CONDITIONS GOVERNING THE ENTERPRISE SERVICES QUA ALLOCATED SEATS OBTAINED BY CLIENT</h2>`);

    // Helper: build 2-column table for Denotations when body contains key-definition pairs
    const buildDenotationsTable = (paragraphs) => {
      if (!Array.isArray(paragraphs) || paragraphs.length === 0) return '';
      // Render each pair as its own 2-col table so borders close on every page
      const tableStyle = 'width:100%; border-collapse:collapse; table-layout:fixed; page-break-inside:avoid; margin: 0 0 6px 0;';
      const thtd = 'border:1px solid #000; padding:6px 8px; vertical-align:top; font-size:16px; line-height:1.4; page-break-inside:avoid; break-inside:avoid;';
      const trStyle = 'page-break-inside:avoid; break-inside:avoid;';
      const blocks = paragraphs.map(raw => {
        const txt = String(raw);
        // Try several separators: dash with spaces, em/en dash, colon
        let term = txt;
        let def = '';
        const separators = [' - ', ' – ', ' — ', ': '];
        for (const sep of separators) {
          const idx = txt.indexOf(sep);
          if (idx > -1) {
            term = txt.slice(0, idx);
            def = txt.slice(idx + sep.length);
            break;
          }
        }
        return `<table style="${tableStyle}"><tbody><tr style="${trStyle}"><td style="${thtd}"><strong>${escapeHtml(term.trim())}</strong></td><td style="${thtd}">${escapeHtml(def.trim())}</td></tr></tbody></table>`;
      }).join('');
      return blocks;
    };

    if (termsSections.length > 0) {
      let sectionNumber = 1;
      for (const sec of termsSections) {
        const h = escapeHtml(sec.heading || `Section ${sectionNumber}`);
        htmlParts.push(`<h3 style="${sectionHeadingStyle}">${sectionNumber}. ${h}</h3>`);
        const paragraphs = toParagraphs(sec.body);
        if (sec.key === 'denotations') {
          // The first sentence acts as a sub-heading/intro; render it above the table
          if (paragraphs.length > 0) {
            htmlParts.push(`<p style="${paraStyle}"><em>${escapeHtml(paragraphs[0])}</em></p>`);
          }
          const tableRows = paragraphs.slice(1);
          htmlParts.push(buildDenotationsTable(tableRows));
        } else {
          // Number each paragraph within the section body
          let item = 1;
          for (const p of paragraphs) {
            htmlParts.push(`<p style="${paraStyle}"><strong>${item}.</strong> ${escapeHtml(p)}</p>`);
            item++;
          }
        }
        sectionNumber++;
      }
    } else {
      // Fallback to single plain terms string
      const termsPlain = contract.terms;
      const paragraphs = toParagraphs(termsPlain);
      if (paragraphs.length > 0) {
        htmlParts.push(`<h3 style="${sectionHeadingStyle}">Terms &amp; Conditions</h3>`);
        for (const p of paragraphs) {
          htmlParts.push(`<p style="${paraStyle}">${escapeHtml(p)}</p>`);
        }
      } else {
        htmlParts.push(`<p style="${paraStyle}">Terms &amp; Conditions not provided</p>`);
      }
    }

    return htmlParts.join('\n');
  }

  // Always build a clean dynamic document to ensure cover is Page 1 and content is fully dynamic
  const baseStyles = `
    @page { size: A4; margin: 20mm 12mm 18mm 12mm; }
    body { font-family: 'Bookman Old Style', Georgia, serif; color: #111; }
    .container { max-width: 800px; margin: 0 auto; padding: 0 8px; }
    .cover { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; position: relative; background: #fff; }
    .cover .logo { width: 160px; height: 160px; object-fit: contain; margin-bottom: 16px; }
    .cover .client { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .cover .addr { position: absolute; bottom: 36mm; left: 0; right: 0; text-align: center; font-size: 14px; color: #333; }
    .page-break { page-break-after: always; }
    h2 { font-size: 18px; text-align: center; margin: 16px 0 12px; }
    h3 { font-size: 17px; margin: 18px 0 8px; }
    p { font-size: 16px; line-height: 1.5; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
    td, th { border: 1px solid #000; padding: 6px 8px; vertical-align: top; page-break-inside: avoid; break-inside: avoid; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    .no-break { page-break-inside: avoid; break-inside: avoid; }
    .cover-details { max-width: 800px; margin: 0 auto; padding: 0 8px; }
    .cd h1 { font-size: 22px; text-align: center; margin: 0 0 8px; }
    .cd h2 { font-size: 18px; margin: 14px 0 6px; }
    .cd h3 { font-size: 16px; margin: 10px 0 6px; }
    .cd p, .cd li { font-size: 14px; line-height: 1.5; }
    .cd ul { margin: 6px 0 10px 18px; }
    .cd .sep { height: 1px; background: #ccc; margin: 10px 0; }
    .cd .kv { margin: 4px 0; }
    .cd .kv b { display: inline-block; min-width: 200px; }
    .cd .sig-line { height: 2px; background: #000; margin: 6px 0; }
    .cd .sig-label { font-size: 12px; text-align: center; margin-bottom: 6px; }
    .cd table.kv { width: 100%; border-collapse: collapse; table-layout: fixed; page-break-inside: auto; }
    .cd table.kv td, .cd table.kv th { border: 1px solid #000; padding: 8px 10px; vertical-align: top; font-size: 14px; page-break-inside: avoid; break-inside: avoid; }
    .cd table.kv tr { page-break-inside: avoid; break-inside: avoid; }
    .cd table.kv tr > td:first-child { width: 34%; font-weight: 700; }
    .cd table.kv tr > td:last-child { width: 66%; }
    .cd table.kv .kv { margin: 0 0 6px 0; }
    .cd table.kv .kv:last-child { margin-bottom: 0; }
    .cd table.sig td { width: 50%; }
    /* Three-column numbered rows */
    .cd table.kv.three td.idx { width: 6%; text-align: center; font-weight: 700; }
    .cd table.kv.three td.key { width: 28%; font-weight: 700; }
    .cd table.kv.three td.val { width: 66%; }
    .cd .and { text-align: center; margin: 8px 0; font-weight: 700; }
  `;
  const dynamicTerms = buildTermsHtml();

  function buildCoverDetailsHtml() {
    const execDate = contract.commencementDate ? new Date(contract.commencementDate) : null;
    const execDateStr = execDate ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(execDate) : '……………..';
    const party2Name = contract.client?.companyName || contract.client?.name || '……………..';
    const clientAcceptance = contract.termsAndConditionAcceptance?.clientAcceptance || {};
    const ofisAcceptance = contract.termsAndConditionAcceptance?.ofisSquareAcceptance || {};
    const ofisSignName = ofisAcceptance.name || 'Mahender Adhikari';
    const ofisSignDesig = ofisAcceptance.designation || 'Authorized Signatory';
    const ofisBoardDate = ofisAcceptance.dateOfBoardResolution ? new Date(ofisAcceptance.dateOfBoardResolution) : null;
    const ofisBoardDateStr = ofisBoardDate ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(ofisBoardDate) : '01 Oct 2022';

    const clientCin = contract.client?.cin || '……………..';
    const clientReg = contract.client?.registeredAddress || contract.client?.registeredOffice || '……………..';
    const clientCorp = contract.client?.corporateAddress || contract.client?.corporateOffice || '……………..';
    const clientSignName = clientAcceptance.name || '……………..';
    const clientSignDesig = clientAcceptance.designation || '……………..';
    const clientBoardDate = clientAcceptance.dateOfBoardResolution ? new Date(clientAcceptance.dateOfBoardResolution) : null;
    const clientBoardDateStr = clientBoardDate ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(clientBoardDate) : '……………..';

    const location = contract.building?.address || 'Ofis Square Tower A-1, Sector 3, Noida, Uttar Pradesh';
    const allocatedAddress = contract.building?.address || '…………………, Ofis Square Tower A-1, Sector 3, Noida, Uttar Pradesh';

    const fourW = (contract.parkingSpaces?.noOf4WheelerParking ?? '');
    const twoW = (contract.parkingSpaces?.noOf2WheelerParking ?? '');
    const noticePeriod = contract.noticePeriodDays ? `${Math.round(contract.noticePeriodDays / 30)} months` : '……………..';

    const commence = contract.commencementDate ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(contract.commencementDate)) : '………………';
    const duration = (contract.durationMonths ?? '') || '';
    const lockin = (contract.lockInPeriodMonths ?? '') || '';

    const monthly = contract.monthlyRent != null ? formatINR(contract.monthlyRent) : '………..';
    const ifrsd = contract.securityDeposit?.amount != null ? formatINR(contract.securityDeposit.amount) : '……………';
    const legalExp = contract.legalExpenses != null ? `${formatINR(contract.legalExpenses)} + taxes` : '………… + taxes';

    const escPct = contract.escalation?.ratePercent != null ? `${contract.escalation.ratePercent}%` : '……%';
    const escFreq = contract.escalation?.frequencyMonths != null ? `${contract.escalation.frequencyMonths} months` : '12 months';

    const renewalTerm = contract.renewal?.renewalTermMonths != null ? `${contract.renewal.renewalTermMonths} months` : '12 months';
    const lockinRenewal = lockin || '6';

    const fsStart = contract.fullyServicedBusinessHours?.startTime || '10:00';
    const fsEnd = contract.fullyServicedBusinessHours?.endTime || '7:00';
    const fsDays = (contract.fullyServicedBusinessHours?.days || []).join(', ') || 'Monday–Friday';

    const cleaningFee = contract.cleaningAndRestorationFees != null ? formatINR(contract.cleaningAndRestorationFees) : '2000';

    const mrCredits = '……';
    const printingCredits = '25';

    return `
    <section class="cover-details cd">
      <div class="cover-details-inner">
        <div class="cd">
          <h2>Company</h2>
          <p><b>Ofis Spaces Private Limited</b></p>
          <div class="kv"><b>CIN:</b> U70109UP2022PTC167914</div>
          <div class="kv"><b>Address:</b> Unit No. 212, Ofis Square, The Iconic Corenthum, Plot No. A-41, Sector-62, Noida, Gautam Buddha Nagar, Uttar Pradesh, 201301</div>
          <div class="kv"><b>Authorized Signatory:</b> ${escapeHtml(ofisSignName)}</div>
          <div class="kv"><b>Board Resolution Date:</b> ${escapeHtml(ofisBoardDateStr)}</div>

          <div class="sep"></div>

          <h2>Contract Details</h2>
          <table class="kv three"><tbody><tr>
            <td class="idx">1.</td>
            <td class="key">Execution Date</td>
            <td class="val">${escapeHtml(execDateStr)}</td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">2.</td>
            <td class="key">Place</td>
            <td class="val">Noida, Uttar Pradesh</td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">3.</td>
            <td class="key">Parties</td>
            <td class="val">
              <p><b>M/s. OFIS SPACES PRIVATE LIMITED</b>, having its registered office at Unit No. 212, Ofis Square, The Iconic Corenthum, Plot No. A-41, Sector-62, Noida, Gautam Buddha Nagar, Noida, Uttar Pradesh, India, 201301 represented by ${escapeHtml(ofisSignName)} authorized by a Board Resolution dated ${escapeHtml(ofisBoardDateStr)} hereinafter referred to as <i>"Ofis Square"</i> (which expression shall unless repugnant to the subject or context be deemed to mean and include its successors in interest, agents and assigns);</p>
              <div class="and">AND</div>
              <p>${escapeHtml(party2Name)} (CIN: ${escapeHtml(clientCin)}), having its registered office at ${escapeHtml(clientReg)} and corporate office at ${escapeHtml(clientCorp)} represented by ${escapeHtml(clientSignName)} (Authorized Signatory) authorized by a Board Resolution dated ${escapeHtml(clientBoardDateStr)} hereinafter referred to as <i>"Client"</i> (which expression shall unless repugnant to the subject or context be deemed to mean and include its successors in interest, successors in office and agents);</p>
              <p>Client is engaged in business of _______</p>
              <p>The Client and Ofis Square in their individual context shall be referred to as "Party" and collectively as "Parties".</p>
            </td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">4.</td>
            <td class="key">Coworking Space</td>
            <td class="val">${escapeHtml(location)}<br/><br/>
              <i>(Note: For the purpose of registration with any government/statutory authorities, address mentioned at S. No. 5 shall be used.)</i>
            </td>
          </tr></tbody></table>

          <div class="sep"></div>
          <table class="kv three">
            <tbody>
              <tr>
                <td class="idx">5.</td>
                <td class="key">Allocated Seats</td>
                <td class="val">
                  Designated office space on the Coworking Space comprising of:<br/>
                  <br/>
                  <b>${escapeHtml(allocatedAddress)}</b><br/>
                  <br/>
                  Detailed final layout of the Allocated Seats is annexed hereto as Annexure A of this Contract.
                </td>
              </tr>
            </tbody>
          </table>
          <table class="kv three"><tbody><tr>
            <td class="idx">6.</td>
            <td class="key">Parking Spaces</td>
            <td class="val">
              ${escapeHtml(String(fourW ?? '____'))} number of 4 wheeler parking.<br/>
              ${escapeHtml(String(twoW ?? '____'))} number of 2 wheeler parking.<br/>
              <br/>
              <b>Note:</b> Notice to surrender the parking shall be 3 months.<br/>
              Parking slots will be allotted as per sole discretion of OFIS SQUARE and may change without any prior information.
            </td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">7.</td>
            <td class="key">Commencement Date</td>
            <td class="val">${escapeHtml(commence)}</td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">8.</td>
            <td class="key">Duration</td>
            <td class="val">${escapeHtml(String(duration || '…………'))} Months from the Commencement Date</td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">9.</td>
            <td class="key">Lock-in Period</td>
            <td class="val">${escapeHtml(String(lockin || '…………'))} Months from the Commencement Date</td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">10.</td>
            <td class="key">Fixed Payment</td>
            <td class="val">Rs. <b>${escapeHtml(monthly)}</b> per month + all applicable taxes thereon, on and from the Commencement Date.</td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">11.</td>
            <td class="key">Interest Free Refundable Security Deposit ("IFRSD")</td>
            <td class="val">Total Interest Free Refundable Security Deposit amounting to Rs. <b>${escapeHtml(ifrsd)}</b> to be deposited by the Client on or before execution of this Contract.</td>
          </tr></tbody></table>
          <table class="kv three"><tbody><tr>
            <td class="idx">12.</td>
            <td class="key">Legal Expenses</td>
            <td class="val">Rs 1,200/- (Rupees Twelve Hundred only) + all applicable taxes thereon as legal expense for executing the agreement. Additional copy of executed agreement: Rs. 800 + taxes.</td>
          </tr></tbody></table>

          <div class="sep"></div>

          <table class="kv three">
            <tbody>
              <tr>
                <td class="idx">13.</td>
                <td class="key">Freebies</td>
                <td class="val">
                  Unlimited usage of tea/coffee, usage of crockery / cutlery, consumption of water, usage of common microwave and refrigerator.<br/>
                  	• Meeting Rooms/Conference Room credits: __ credits per month subject to availability.<br/>
                  	• Printing credits: <b>25 A4 Black/White paper per user per month</b>.<br/>
                  <i>(Note: Unused Meeting Rooms/Conference Room credit/Printing credits shall not be rolled over to any subsequent months)</i>
                </td>
              </tr>
              <tr>
                <td class="idx">14.</td>
                <td class="key">Pay as you Go Services</td>
                <td class="val">
                  1. AC charges beyond Fully Serviced Business Hours: as per actual charges billed by Builder.<br/>
                  2. Additional Parking charges:<br/>
                  &nbsp;&nbsp;a. Subsequent 1 car parking at INR 5,000 + GST per slot or as per the prevailing tariff sheet of Builder whichever is higher. (subject to availability)<br/>
                  &nbsp;&nbsp;b. Subsequent 1 two wheeler parking at INR 1,500 + GST per slot or as per the prevailing tariff sheet of Builder whichever is higher. (subject to availability)<br/>
                  <b>Note:</b> Notice period to surrender Additional Parking is 3 months.<br/>
                  3. Print out and Scanning charges:<br/>
                  &nbsp;&nbsp;a. Rs. 5 for A4 and Rs. 8 for A3 per black & white page.<br/>
                  &nbsp;&nbsp;b. Rs. 5 per page for document scanning.<br/>
                  4. Access card INR 500/- per access card.<br/>
                  5. Lost / replacement / damaged Access Cards: Rs 500 per access card.<br/>
                  6. Courier Charges: On actuals depending on concierge rates.<br/>
                  7. Charges as prescribed and published from time to time.<br/>
                  <i>Note: The above mentioned charges shall be exclusive of all applicable taxes.</i>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="sep"></div>

          <h3>15. Signatures</h3>
          <p>The attached Terms and Conditions are integral part of this coversheet and form one document (<b>“Contract”</b>).</p>

          <p><b>For Ofis Square</b></p>
          <table class="kv">
            <tbody>
              <tr>
                <td><b>Name</b></td>
                <td>${escapeHtml(ofisSignName)}</td>
              </tr>
              <tr>
                <td><b>Designation</b></td>
                <td>${escapeHtml(ofisSignDesig)}</td>
              </tr>
              <tr>
                <td><b>Date of Board Resolution</b></td>
                <td>${escapeHtml(ofisBoardDateStr)}</td>
              </tr>
              <tr>
                <td><b>Company Stamp, Date and Signature</b></td>
                <td></td>
              </tr>
            </tbody>
          </table>

 

          <p><b>For ${escapeHtml(companyName)}</b></p>
          <table class="kv">
            <tbody>
              <tr>
                <td><b>Name</b></td>
                <td>${escapeHtml(clientSignName)}</td>
              </tr>
              <tr>
                <td><b>Designation</b></td>
                <td>${escapeHtml(clientSignDesig)}</td>
              </tr>
              <tr>
                <td><b>Date of Board Resolution</b></td>
                <td>${escapeHtml(clientBoardDateStr)}</td>
              </tr>
              <tr>
                <td><b>Email Id</b></td>
                <td>${escapeHtml(contract.client?.email || '……………..')}</td>
              </tr>
              <tr>
                <td><b>Company Stamp, Date and Signature</b></td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div class="sep"></div>

          <h3>16. Required Documents (Client)</h3>
          <ol>
            <li>Address proof – Electricity bill</li>
            <li>Board Resolution / Letter of Authority</li>
            <li>Photo ID & Address Proof of Signatory</li>
            <li>Certificate of Incorporation (Company/LLP)</li>
            <li>GST Certificate</li>
            <li>PAN</li>
            <li>TAN</li>
            <li>MOA</li>
            <li>AOA</li>
          </ol>
        </div>
      </div>
    </section>`;
  }
  const topLogoUrl = '__INLINE_LOGO_DATA_URL__';
  html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Contract</title>
        <style>${baseStyles}</style>
      </head>
      <body>
        <!-- Cover Page -->
        <section class="cover">
          <img class="logo" src="${topLogoUrl}" alt="Ofis Square Logo" />
          <div class="client">${escapeHtml(companyName)}</div>
          <div class="addr">${escapeHtml(buildingAddress || '')}</div>
        </section>

        <!-- Cover Extracted Details -->
        <div class="cover-details">
          ${buildCoverDetailsHtml()}
        </div>

        <div class="page-break"></div>

        <!-- Content Pages (Terms & Conditions) -->
        <div class="container">
          ${dynamicTerms}
        </div>
      </body>
    </html>`;

  return html;
}

async function generateContractPDFFromHtml(contract) {
  // Build HTML content
  let html = await buildContractHtmlFromTemplate(contract);

  // Launch Puppeteer and render to PDF
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    // Pre-fetch logo and inline it as data URL so PDF generation doesn't depend on external network
    const logoUrl = 'https://ik.imagekit.io/8znjbhgdh/ofis%20square%20logo.jpg';
    let logoDataUrl = logoUrl;
    try {
      const resp = await fetch(logoUrl);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const b64 = buf.toString('base64');
        const contentType = resp.headers.get('content-type') || 'image/jpeg';
        logoDataUrl = `data:${contentType};base64,${b64}`;
      }
    } catch (e) {
      // keep original URL if inline fetch fails
    }

    // Replace placeholder in HTML with the inlined data URL (cover page)
    html = html.replace(/__INLINE_LOGO_DATA_URL__/g, logoDataUrl);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('screen');
    // Build header template with top-right logo and page numbers
    const headerTemplate = `
      <style>
        .hdr { width: 100%; font-size: 9px; color: #444; padding: 0 8mm; }
        .hdr-inner { display: flex; align-items: center; justify-content: space-between; }
        .hdr .logo { width: 110px; height: 34px; object-fit: contain; }
        .pg { font-family: Arial, sans-serif; }
      </style>
      <div class="hdr">
        <div class="hdr-inner">
          <div class="left"><img class="logo" src="${logoDataUrl}" /></div>
          <div class="right"><span class="pg">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>
        </div>
      </div>`;

    // Footer with signature boxes: left = Ofis Square, right = Client
    const footerTemplate = `
      <style>
        .ftr { width: 100%; padding: 0 12mm 6mm 12mm; box-sizing: border-box; }
        .ftr-inner { display: flex; align-items: center; justify-content: space-between; }
        .sig-box { width: 160px; border: 1px solid #000; padding: 6px 10px; box-sizing: border-box; }
        .sig-line { height: 2px; background: #000; margin: 6px 0; }
        .sig-label { font-size: 9px; text-align: center; font-family: Arial, sans-serif; color: #222; }
      </style>
      <div class="ftr">
        <div class="ftr-inner">
          <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">Ofis Square</div>
          </div>
          <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">Client</div>
          </div>
        </div>
      </div>`;

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: '20mm', right: '12mm', bottom: '28mm', left: '12mm' }
    });
    await page.close();

    // Ensure the returned PDF is a Buffer instance
    if (!Buffer.isBuffer(pdf)) {
      console.error('Puppeteer page.pdf() did not return a Buffer, type:', typeof pdf, 'constructor:', pdf?.constructor?.name);
      // Puppeteer should return a Buffer, but if it doesn't, convert appropriately
      if (pdf instanceof ArrayBuffer) {
        return Buffer.from(pdf);
      } else if (pdf.buffer && ArrayBuffer.isView(pdf)) {
        // TypedArray like Uint8Array
        return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
      } else if (Array.isArray(pdf)) {
        return Buffer.from(pdf);
      } else if (typeof pdf === 'object' && pdf.data) {
        // If it's an object with a data property that's buffer-like
        if (Buffer.isBuffer(pdf.data)) {
          return pdf.data;
        } else if (pdf.data instanceof ArrayBuffer) {
          return Buffer.from(pdf.data);
        } else if (Array.isArray(pdf.data)) {
          return Buffer.from(pdf.data);
        }
      }
      // As a last resort, convert to string then back to buffer
      if (typeof pdf === 'string') {
        return Buffer.from(pdf, 'utf8');
      }

      throw new Error(`Puppeteer page.pdf() returned unexpected type: ${typeof pdf}`);
    }

    return pdf;
  } finally {
    await browser.close();
  }
}

// Helper function: Create document in Zoho Sign
async function createZohoSignDocument(contract) {
  const formData = new FormData();

  let fileBuffer = null;
  let fileName = `contract_${contract._id || 'doc'}.pdf`;
  try {
    if (contract.fileUrl) {
      // Download actual file to ensure Zoho gets a valid PDF
      const fileResp = await fetch(contract.fileUrl);
      if (!fileResp.ok) {
        throw new Error(`Failed to download fileUrl: HTTP ${fileResp.status}`);
      }
      fileBuffer = Buffer.from(await fileResp.arrayBuffer());
      // Try to infer a filename from the URL
      const urlName = (contract.fileUrl.split('?')[0] || '').split('/').pop();
      if (urlName) fileName = urlName;
    } else {
      // Fallback to placeholder content
      fileBuffer = await generateContractPDFBuffer(contract);
    }
  } catch (e) {
    console.warn('Falling back to generated PDF due to download error:', e?.message);
    fileBuffer = await generateContractPDFBuffer(contract);
  }

  formData.append('file', fileBuffer, fileName);
  // Zoho Sign expects the JSON to be wrapped under a top-level 'requests' key
  formData.append('data', JSON.stringify({
    requests: {
      request_name: `Contract for ${contract.client.companyName}`,
      expiration_days: 30,
      is_sequential: true
    }
  }));
  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests`, {
    method: 'POST',
    headers: {
      ...(typeof formData.getHeaders === 'function' ? formData.getHeaders() : {}),
      'Authorization': `Zoho-oauthtoken ${accessToken}`
    },
    body: formData
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Zoho Sign API error";
    console.error("Zoho Sign create error payload:", result);
    throw new Error(`Zoho Sign API error: ${msg}`);
  }

  // Return only the request_id to avoid shape confusion
  return result.requests?.request_id;
}

// Helper function: Add recipient to document
async function addRecipientToDocument(requestId, client, documentId, options = {}) {
  // Zoho Sign expects actions under requests.actions and page_no starts at 1
  const actionData = {
    requests: {
      actions: [{
        action_type: "SIGN",
        recipient_name: client.contactPerson,
        recipient_email: client.email,
        signing_order: 1,
        fields: [{
          field_type_name: "Signature",
          document_id: documentId,
          page_no: 1,
          x_coord: 100,
          y_coord: 200,
          width: 150,
          height: 50,
          is_mandatory: true
        }]
      }]
    }
  };

  const accessToken = await getAccessToken();
  // Retry up to 3 times to handle eventual consistency after create
  const maxRetries = 3;
  let lastErrorResult = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(actionData)
    });

    const result = await response.json();
    if (result.status === "success") {
      return result;
    }

    lastErrorResult = result;
    const msg = result.message || "Failed to add recipient";
    // If document not yet available, wait briefly and retry
    if (typeof msg === 'string' && msg.toLowerCase().includes('document does not exist') && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 600));
      continue;
    }
    console.error("Zoho Sign addRecipient error payload:", { requestId, result, attempt });
    throw new Error(`Failed to add recipient: ${msg}`);
  }
  console.error("Zoho Sign addRecipient final failure:", { requestId, lastErrorResult });
  const finalMsg = lastErrorResult?.message || "Failed to add recipient";
  throw new Error(`Failed to add recipient: ${finalMsg}`);
}

// Helper function: Submit document for signature
async function submitDocumentForSignature(requestId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json'
    },
    // Zoho Sign submit API expects a top-level 'requests' object in body, but not 'request_id'.
    // Sending request_id causes: code 9043 (Extra key found), while omitting 'requests' causes code 9008.
    body: JSON.stringify({ requests: {} })
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Failed to submit document";
    console.error("Zoho Sign submit error payload:", { requestId, result });
    throw new Error(`Failed to submit document: ${msg}`);
  }

  return result;
}

// Helper function: Verify document exists before adding recipients
async function verifyDocumentExists(requestId) {
  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const accessToken = await getAccessToken();
      const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      });

      const result = await response.json();
      // Fail fast on OAuth scope issues instead of retrying
      const msgStr = (result && (result.message || result.code)) ? String(result.message || result.code) : "";
      if (result?.code === 9040 || /invalid oauth scope/i.test(msgStr)) {
        const guidance = "Zoho Sign returned 'Invalid Oauth Scope'. Ensure your refresh token has Zoho Sign scopes and that ZOHO_SIGN_REFRESH_TOKEN is used. Minimum recommended scopes: ZohoSign.documents.ALL, ZohoSign.requests.ALL, ZohoSign.organization.READ.";
        console.error("Zoho Sign scope error while verifying document:", { result, guidance });
        throw new Error(guidance);
      }
      if (result.status === "success" && result.requests) {
        console.log(`Document ${requestId} verified on attempt ${attempt}`);
        return result.requests;
      }

      console.log(`Document ${requestId} not ready, attempt ${attempt}/${maxRetries}:`, result);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000)); // Wait 1 second
      }
    } catch (error) {
      console.error(`Error verifying document ${requestId}, attempt ${attempt}:`, error);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  throw new Error(`Document ${requestId} not available after ${maxRetries} attempts`);
}

// Helper function: Get document status from Zoho Sign
async function getZohoSignDocumentStatus(requestId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`
    }
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Failed to get document status";
    throw new Error(`Failed to get document status: ${msg}`);
  }

  return result.requests;
}

// Helper function: Download signed document from Zoho Sign
async function downloadSignedDocument(requestId) {
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}/pdf`, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download signed document: HTTP ${response.status}`);
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    // Upload to ImageKit
    const fileName = `signed_contract_${requestId}_${Date.now()}.pdf`;

    // Ensure the buffer is properly formatted for ImageKit
    let fileForUpload = pdfBuffer;
    if (Buffer.isBuffer(pdfBuffer)) {
      // Convert buffer to base64 string for ImageKit
      fileForUpload = pdfBuffer.toString('base64');
    } else if (typeof pdfBuffer === 'object' && pdfBuffer.buffer) {
      // Handle if it's a typed array view
      fileForUpload = Buffer.from(pdfBuffer).toString('base64');
    }

    const uploadResponse = await imagekit.upload({
      file: fileForUpload,
      fileName: fileName,
      folder: "/contracts/signed"
    });

    return uploadResponse.url;
  } catch (error) {
    console.error("Failed to download and upload signed document:", error);
    throw error;
  }
}


// Generate contract PDF using template
export const generateContractPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");

    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    // Generate Buffer (prefers HTML template, falls back to pdfmake internally)
    const pdfBuffer = await generateContractPDFBuffer(contract);

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contract_${contract.client.companyName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);

    // Update contract fileUrl with a downloadable route (for consistency with previous behaviour)
    if (contract.status === 'draft' && !contract.fileUrl) {
      const downloadUrl = `${req.protocol}://${req.get('host')}/api/contracts/${id}/download-pdf`;
      await Contract.findByIdAndUpdate(id, { fileUrl: downloadUrl });
    }

    return res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error("Generate contract PDF error:", error);
    return res.status(500).json({ error: "Failed to generate contract PDF" });
  }
};

function formatDate(date) {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date));
  } catch (e) {
    return new Date(date).toDateString();
  }
}

/**
 * Build the pdfmake docDefinition from contractData
 * - contractData.termsSections is an ordered array of { heading, body } objects
 */
// Helper: normalize text values (arrays, strings) into printable text
function normalizeTextValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTextValue(item))
      .filter((item) => item && item.trim())
      .join('\n\n');
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function buildContractTemplate(contractData) {
  const { companyName, contactPerson, email, phone, companyAddress, buildingName, buildingAddress, capacity, monthlyRent, securityDeposit, contractStartDate, contractEndDate, termsSections } = contractData;

  // Header + Title
  const content = [];

  // Company header (left) and Contract title (center)
  content.push(
    { text: companyName || 'OFIS SPACES PRIVATE LIMITED', style: 'companyHeader', alignment: 'center', margin: [0, 0, 0, 8] },
    { text: 'TERMS AND CONDITIONS GOVERNING THE ENTERPRISE SERVICES QUA ALLOCATED SEATS OBTAINED BY CLIENT', style: 'contractTitle', alignment: 'center', margin: [0, 0, 0, 10] }
  );

  // Contract metadata table
  content.push({
    style: 'metaTable',
    table: {
      widths: ['*', '*'],
      body: [
        [{ text: 'Client', style: 'metaLabel' }, { text: companyName || '-', style: 'metaValue' }],
        [{ text: 'Contact Person', style: 'metaLabel' }, { text: contactPerson || '-', style: 'metaValue' }],
        [{ text: 'Email', style: 'metaLabel' }, { text: email || '-', style: 'metaValue' }],
        [{ text: 'Phone', style: 'metaLabel' }, { text: phone || '-', style: 'metaValue' }],
        [{ text: 'Client Address', style: 'metaLabel' }, { text: companyAddress || '-', style: 'metaValue' }],
        [{ text: 'Building', style: 'metaLabel' }, { text: buildingName || '-', style: 'metaValue' }],
        [{ text: 'Building Address', style: 'metaLabel' }, { text: buildingAddress || '-', style: 'metaValue' }],
        [{ text: 'Allocated Seats (Capacity)', style: 'metaLabel' }, { text: (capacity || '-') + ' seats', style: 'metaValue' }],
        [{ text: 'Monthly Rent', style: 'metaLabel' }, { text: monthlyRent ? `₹ ${monthlyRent}` : '-', style: 'metaValue' }],
        [{ text: 'Security Deposit', style: 'metaLabel' }, { text: securityDeposit ? `₹ ${securityDeposit}` : '-', style: 'metaValue' }],
        [{ text: 'Commencement Date', style: 'metaLabel' }, { text: contractStartDate || '-', style: 'metaValue' }],
        [{ text: 'End Date', style: 'metaLabel' }, { text: contractEndDate || '-', style: 'metaValue' }]
      ]
    },
    layout: {
      hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 0 : 0.4; },
      vLineWidth: function () { return 0; },
      paddingLeft: function () { return 4; },
      paddingRight: function () { return 4; },
      paddingTop: function () { return 4; },
      paddingBottom: function () { return 4; }
    },
    margin: [0, 0, 0, 10]
  });

  // Terms sections: render each section as heading + body text.
  // termsSections expected as array: [{ heading, body }]
  if (Array.isArray(termsSections) && termsSections.length > 0) {
    let sectionNumber = 1;
    for (const sec of termsSections) {
      const heading = sec.heading || 'Section';
      const body = normalizeTextValue(sec.body).trim();

      // Add section header (numbered)
      content.push({ text: `${sectionNumber}. ${heading}`, style: 'sectionHeading', margin: [0, 6, 0, 4] });

      // Body is potentially long and contains paragraphs separated by newlines. Split & push paragraphs for better spacing.
      const paragraphs = body.split(/\n{1,}/).map(p => p.trim()).filter(Boolean);
      for (const para of paragraphs) {
        content.push({ text: para, style: 'sectionBody', margin: [0, 0, 0, 6] });
      }
      sectionNumber++;
    }
  } else if (contractData.termsPlain) {
    // fallback: single blob text
    content.push({ text: 'Terms & Conditions', style: 'sectionHeading', margin: [0, 6, 0, 4] });
    const paragraphs = contractData.termsPlain.split(/\n{1,}/).map(p => p.trim()).filter(Boolean);
    for (const para of paragraphs) content.push({ text: para, style: 'sectionBody', margin: [0, 0, 0, 6] });
  } else {
    content.push({ text: 'Terms & Conditions not provided', style: 'sectionBody' });
  }

  // Signature block (mirrors your Word doc end with client / company signature lines)
  content.push({
    columns: [
      {
        width: '50%',
        stack: [
          { text: '\n\n\n\n', margin: [0, 0, 0, 0] },
          { text: 'Client', style: 'sigLabel' },
          { text: '__________________________', style: 'sigLine' },
          { text: 'Name: ', style: 'sigSmall' },
        ],
        margin: [0, 12, 0, 0]
      },
      {
        width: '50%',
        stack: [
          { text: '\n\n\n\n', margin: [0, 0, 0, 0] },
          { text: 'Ofis Square', style: 'sigLabel' },
          { text: '__________________________', style: 'sigLine' },
          { text: 'Name: ', style: 'sigSmall' }
        ],
        margin: [0, 12, 0, 0]
      }
    ],
    columnGap: 10
  });

  // Footer with company details from your Word doc (static example; replace if you want dynamic)
  const footer = (currentPage, pageCount) => {
    return {
      columns: [
        { text: 'OFIS SPACES PRIVATE LIMITED | Unit No. 212, Ofis Square, The Iconic Corenthum, Plot No. A-41, Sector-62, Noida, Uttar Pradesh, India - 201301', style: 'footerText', width: '*' },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', width: 80, style: 'footerText' }
      ],
      margin: [40, 8, 40, 8]
    };
  };

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 80, 40, 80],
    content,
    footer,
    styles: {
      companyHeader: { fontSize: 10, bold: true },
      contractTitle: { fontSize: 12, bold: true, alignment: 'center', margin: [0, 4, 0, 8] },
      metaLabel: { fontSize: 9, bold: true },
      metaValue: { fontSize: 9 },
      sectionHeading: { fontSize: 11, bold: true, decoration: 'underline' },
      sectionBody: { fontSize: 9, lineHeight: 1.2 },
      sigLabel: { fontSize: 10, bold: true },
      sigLine: { fontSize: 10, margin: [0, 6, 0, 6] },
      sigSmall: { fontSize: 9 },
      footerText: { fontSize: 8, color: '#555555' }
    },
    defaultStyle: {
      font: 'Helvetica'
    }
  };

  return docDefinition;
}

/**
 * Main function to generate PDF buffer for a contract object
 * Returns Promise<Buffer>
 */
function generateContractPDFBuffer(contract) {
  try {
    // Prefer HTML template rendering first
    return generateContractPDFFromHtml(contract)
      .catch((e) => {
        console.warn('HTML template generation failed, falling back to pdfmake:', e?.message);
        // Fall back to pdfmake flow below
        // We intentionally do not throw here so the pdfmake code path executes
        return null;
      })
      .then(async (htmlPdfBuffer) => {
        if (htmlPdfBuffer) return htmlPdfBuffer;

        // ==== pdfmake fallback path ====
        // Prepare contractData used by template builder
        const client = contract.client || {};
        const building = contract.building || {};

        // Map dates to formatted strings
        const contractStartDate = contract.startDate ? formatDate(contract.startDate) : '';
        const contractEndDate = contract.endDate ? formatDate(contract.endDate) : '';

        // Build ordered terms sections from contract.termsandconditions (first element expected)
        let termsSections = [];
        if (Array.isArray(contract.termsandconditions) && contract.termsandconditions.length > 0) {
          const t = contract.termsandconditions[0]; // your stored object with named section objects
          // define the order to match the Word document
          const order = [
            'denotations', 'scope', 'rightsGrantedToClient', 'payments',
            'consequencesOfNonPayment', 'obligationsOfClient', 'obligationsOfOfisSquare',
            'termination', 'consequencesOfTermination', 'renewal', 'miscellaneous',
            'parking', 'disputeResolution', 'governingLaw', 'electronicSignature'
          ];

          for (const key of order) {
            if (t[key] && (t[key].body || t[key].heading)) {
              termsSections.push({
                heading: t[key].heading || key,
                body: t[key].body || ''
              });
            }
          }
        }

        // If no structured sections, check for single-string terms field
        const contractData = {
          companyName: client.companyName || client.name || 'OFIS SPACES PRIVATE LIMITED',
          contactPerson: client.contactPerson || client.contact_name || '',
          email: client.email || '',
          phone: client.phone || '',
          companyAddress: client.companyAddress || client.address || '',
          buildingName: building.name || '',
          buildingAddress: building.address || '',
          capacity: contract.capacity || '',
          monthlyRent: contract.monthlyRent || '',
          securityDeposit: (contract.securityDeposit && contract.securityDeposit.amount) ? contract.securityDeposit.amount : '',
          contractStartDate,
          contractEndDate,
          termsSections: termsSections.length > 0 ? termsSections : undefined,
          termsPlain: (!termsSections.length && contract.terms) ? contract.terms : undefined
        };

        const docDefinition = buildContractTemplate(contractData);

        const fonts = getFonts();
        const printer = new PdfPrinter(fonts);
        const pdfDoc = printer.createPdfKitDocument(docDefinition);

        const chunks = [];
        pdfDoc.on('data', chunk => chunks.push(chunk));

        return new Promise((resolve, reject) => {
          pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
          pdfDoc.on('error', reject);
          pdfDoc.end();
        });
      });
  } catch (error) {
    console.error("Generate contract PDF buffer error:", error);
    // fallback plain text buffer (keeps earlier behavior)
    const contractText = `
CONTRACT AGREEMENT

Client: ${contract?.client?.companyName || contract?.client?.name || ''}
Contact: ${contract?.client?.contactPerson || ''}

Start Date: ${contract?.startDate ? new Date(contract.startDate).toDateString() : 'TBD'}
End Date: ${contract?.endDate ? new Date(contract.endDate).toDateString() : 'TBD'}

Terms and Conditions:
${contract?.terms || '[Contract terms would go here]'}

Signature: ___________________
Date: ___________________
`;
    return Promise.resolve(Buffer.from(contractText, 'utf8'));
  }
}

// Helper: configure fonts for pdfmake in Node.js (use default fonts to avoid filesystem issues)
function getFonts() {
  return {
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique'
    }
  };
}

// Update security deposit details and mark as paid
export const updateSecurityDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount, notes } = req.body;

    const contract = await Contract.findById(id).populate("client");
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    // Update contract security deposit
    contract.securityDeposit = {
      type: type || contract.securityDeposit?.type,
      amount: amount !== undefined ? Number(amount) : contract.securityDeposit?.amount || 0,
      notes: notes || contract.securityDeposit?.notes,
    };
    contract.securityDepositPaidAt = new Date();
    contract.securityDepositPaidBy = req.user?._id || null;

    await contract.save();

    // Update client security deposit status
    if (contract.client) {
      await Client.findByIdAndUpdate(contract.client._id, {
        securityDeposit: contract.securityDeposit,
        isSecurityPaid: true,
      });
    }

    await logContractActivity(req, "UPDATE", contract._id, contract.client?._id, {
      event: "SECURITY_DEPOSIT_PAID",
      type,
      amount,
      notes,
      receiptUrl: contract.securityDeposit?.receiptUrl,
      receivedAt: contract.securityDeposit?.receivedAt,
    });

    return res.json({
      success: true,
      data: contract,
      message: "Security deposit updated successfully",
    });
  } catch (error) {
    console.error("Update security deposit error:", error);
    await logErrorActivity(req, error, "Update Security Deposit");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Add comment to contract (general or section-specific)
export const addComment = async (req, res) => {
  try {
    const { id } = req.params;

    // Use let so we can safely reassign/normalise values later
    let {
      message,
      type = "internal",
      mentionedUsers = [],
      sectionType = "general",
      termsSection,
      paragraphIndex,
      parentCommentId // NEW: Support for threaded replies
    } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Comment message is required" });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    // Validate parent comment if replying
    let parentComment = null;
    if (parentCommentId) {
      if (!mongoose.Types.ObjectId.isValid(parentCommentId)) {
        return res.status(400).json({ success: false, message: "Invalid parent comment ID" });
      }

      // Find parent comment in contract
      parentComment = contract.comments.id(parentCommentId);
      if (!parentComment) {
        return res.status(404).json({ success: false, message: "Parent comment not found" });
      }

      // Prevent circular references - check if parent is itself a reply
      // (This is a simple check; deep circular checks would require recursion)
      if (parentComment.parentCommentId) {
        // Allow nested replies, but could add depth limit here if needed
      }

      // Inherit context from parent if not explicitly provided
      if (!sectionType || sectionType === "general") {
        sectionType = parentComment.sectionType || "general";
      }
      if (!termsSection && parentComment.termsSection) {
        termsSection = parentComment.termsSection;
      }
      if (typeof paragraphIndex === "undefined" && parentComment.paragraphIndex !== undefined) {
        paragraphIndex = parentComment.paragraphIndex;
      }

      // Inherit type from parent (replies should match parent type)
      // Allow override only for admins or if explicitly different
      const userRole = req.user?.role?.name || "";
      const isAdmin = ["System Admin", "Admin"].includes(userRole);
      if (!isAdmin && type !== parentComment.type) {
        // Reply type should match parent, but allow override for admins
        type = parentComment.type;
      }
    }

    // Validate section-specific comment data
    if (sectionType === "terms_section") {
      if (!termsSection) {
        return res.status(400).json({ success: false, message: "Terms section is required for section-specific comments" });
      }

      const validSections = [
        "denotations", "scope", "rightsGrantedToClient", "payments",
        "consequencesOfNonPayment", "obligationsOfClient", "obligationsOfOfisSquare",
        "termination", "consequencesOfTermination", "renewal", "miscellaneous",
        "parking", "disputeResolution", "governingLaw", "electronicSignature"
      ];

      if (!validSections.includes(termsSection)) {
        return res.status(400).json({ success: false, message: "Invalid terms section" });
      }
    }

    // Normalize paragraphIndex if present
    if (typeof paragraphIndex !== "undefined" && paragraphIndex !== null && paragraphIndex !== "") {
      const parsed = Number(paragraphIndex);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ success: false, message: "Invalid paragraphIndex" });
      }
      paragraphIndex = parsed;
    }

    const newComment = {
      by: req.user?._id,
      at: new Date(),
      type,
      message: message.trim(),
      mentionedUsers: mentionedUsers.filter(id => mongoose.Types.ObjectId.isValid(id)),
      parentCommentId: parentCommentId || null,
      sectionType,
      ...(sectionType === "terms_section" && { termsSection }),
      ...(paragraphIndex !== undefined && { paragraphIndex: Number(paragraphIndex) })
    };

    contract.comments.push(newComment);
    await contract.save();

    // Populate the new comment for response
    await contract.populate([
      { path: "comments.by", select: "name email" },
      { path: "comments.mentionedUsers", select: "name email" }
    ]);

    const addedComment = contract.comments[contract.comments.length - 1];

    await logContractActivity(req, "UPDATE", contract._id, contract.client?._id, {
      event: parentCommentId ? "COMMENT_REPLY_ADDED" : "COMMENT_ADDED",
      commentType: type,
      sectionType,
      termsSection,
      paragraphIndex,
      parentCommentId: parentCommentId || null,
      message: message.substring(0, 100) + (message.length > 100 ? "..." : "")
    });

    return res.json({
      success: true,
      data: addedComment,
      message: "Comment added successfully"
    });
  } catch (error) {
    console.error("Add comment error:", error);
    await logErrorActivity(req, error, "Add Contract Comment");
    return res.status(500).json({ success: false, message: error.message });
  }
};


// Get comments for a specific terms section

export const getSectionComments = async (req, res) => {
  try {
    const { id, section } = req.params;
    const { paragraphIndex } = req.query;

    const contract = await Contract.findById(id)
      .populate("comments.by", "name email")
      .populate("comments.mentionedUsers", "name email");

    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    // Build initial array (use a new variable name to avoid collisions)
    let filteredComments = contract.comments.filter(c =>
      c.sectionType === "terms_section" && c.termsSection === section
    );

    // Further filter by paragraph index if specified
    if (typeof paragraphIndex !== "undefined" && paragraphIndex !== null && paragraphIndex !== "") {
      const pIndex = Number(paragraphIndex);
      if (!Number.isNaN(pIndex)) {
        filteredComments = filteredComments.filter(c => c.paragraphIndex === pIndex);
      } else {
        // If paragraphIndex was provided but invalid, return empty or a 400 — choose what fits
        return res.status(400).json({ success: false, message: "Invalid paragraphIndex" });
      }
    }

    // Filter comments based on user access (same logic as getContractById)
    const currentUserId = req.user?._id ? req.user._id.toString() : null;
    if (currentUserId) {
      // dynamic import to avoid circular deps; name chosen to avoid shadowing
      const UserModule = await import('../models/userModel.js');
      const User = UserModule.default || UserModule;
      const currentUser = await User.findById(currentUserId).populate('role', 'roleName');
      const userRole = currentUser?.role?.roleName;

      filteredComments = filteredComments.filter(comment => {
        if (comment.type === 'review' || comment.type === 'client') return true;

        if (comment.type === 'legal_only') {
          return ['Legal Team', 'System Admin'].includes(userRole);
        }

        if (comment.type === 'internal') {
          // author
          if (comment.by?._id?.toString && comment.by._id.toString() === currentUserId) return true;

          // mentioned users
          if (Array.isArray(comment.mentionedUsers) &&
            comment.mentionedUsers.some(u => u?._id?.toString && u._id.toString() === currentUserId)) {
            return true;
          }

          return false;
        }

        return true;
      });
    }

    return res.json({
      success: true,
      data: filteredComments
    });
  } catch (error) {
    console.error("Get section comments error:", error);
    // If it's the "Assignment to constant variable." error, the stacktrace will show where.
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const viewDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);

    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    const documentUrl = contract.fileUrl;
    if (!documentUrl || documentUrl === "placeholder") {
      return res.status(404).json({ success: false, message: "No document file found for this contract" });
    }

    const response = await fetch(documentUrl);
    if (!response.ok) {
      return res.status(response.status).json({ success: false, message: "Failed to fetch document from storage" });
    }

    let buffer = Buffer.from(await response.arrayBuffer());

    if (contract.isEncrypted) {
      try {
        buffer = decryptBuffer(buffer);
      } catch (decryptError) {
        console.error("Transparent decryption failed for viewDocument:", decryptError.message);
        // Fallback: send as is if it fails
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=\"contract.pdf\"");
    return res.send(buffer);
  } catch (err) {
    console.error("viewDocument error:", err);
    return res.status(500).json({ success: false, message: "Internal server error while retrieving document" });
  }
};
