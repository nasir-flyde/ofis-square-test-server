import PrinterRequest from "../models/printerRequestModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { sendNotification } from "../utils/notificationHelper.js";
import { logActivity } from "../utils/activityLogger.js";
import mongoose from "mongoose";
import imagekit from "../utils/imageKit.js";

/**
 * Create a new printer request
 */
export const createPrinterRequest = async (req, res) => {
  try {
    let { clientId, memberId, documentUrl, fileName, buildingId } = req.body || {};

    // Upload file to ImageKit if it exists in the request
    if (req.file) {
      try {
        const uploadResponse = await new Promise((resolve, reject) => {
          imagekit.upload({
            file: req.file.buffer, // required, from multer
            fileName: fileName || req.file.originalname, // required
            folder: '/printer_requests'
          }, function(error, result) {
            if(error) reject(error);
            else resolve(result);
          });
        });
        documentUrl = uploadResponse.url;
      } catch (uploadError) {
        console.error("Error uploading document to ImageKit:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload document"
        });
      }
    }

    if (!clientId || !documentUrl || !fileName || !buildingId) {
      return res.status(400).json({
        success: false,
        message: "Client ID, Document URL, File Name, and Building ID are required"
      });
    }

    const printerRequest = await PrinterRequest.create({
      client: clientId,
      member: memberId || null,
      documentUrl,
      fileName,
      buildingId,
      status: "pending"
    });

    // Notify community team for that building
    try {
      await sendNotification({
        to: {
          roleNames: ["Community Senior", "Community Junior"]
        },
        channels: { inApp: true, push: true, email: true },
        title: "New Printer Request",
        templateKey: "send_printer_request",
        templateVariables: {
          fileName: fileName,
          clientId: clientId
        },
        metadata: {
          category: "Printer",
          relatedEntity: { entity: "PrinterRequest", entityId: printerRequest._id },
          buildingId: buildingId
        },
        source: "system",
        createdBy: req.user?._id || null
      });
    } catch (notifyErr) {
      console.error("Error sending notification to community team:", notifyErr);
    }

    await logActivity({
      req,
      action: "CREATE",
      entity: "PrinterRequest",
      entityId: printerRequest._id,
      description: `Created printer request for ${fileName}`,
      metadata: { clientId, buildingId }
    });

    return res.status(201).json({
      success: true,
      data: printerRequest
    });
  } catch (error) {
    console.error("Error creating printer request:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Mark printer request as ready
 */
export const markAsReady = async (req, res) => {
  try {
    const { id } = req.params;

    const printerRequest = await PrinterRequest.findById(id).populate("client").populate("member");
    if (!printerRequest) {
      return res.status(404).json({
        success: false,
        message: "Printer request not found"
      });
    }

    printerRequest.status = "ready";
    printerRequest.readyAt = new Date();
    await printerRequest.save();

    // Notify client/member
    try {
      const recipient = printerRequest.member 
        ? { userId: printerRequest.member.user, email: printerRequest.member.email }
        : { clientId: printerRequest.client._id, email: printerRequest.client.email };

      await sendNotification({
        to: recipient,
        channels: { inApp: true, push: true, email: true },
        title: "Print Ready",
        templateKey: "send_printer_ready",
        templateVariables: {
          name: printerRequest.member ? printerRequest.member.name : printerRequest.client.companyName,
          fileName: printerRequest.fileName
        },
        metadata: {
          category: "Printer",
          relatedEntity: { entity: "PrinterRequest", entityId: printerRequest._id }
        },
        source: "system",
        createdBy: req.user?._id || null
      });
    } catch (notifyErr) {
      console.error("Error sending notification to client:", notifyErr);
    }

    return res.json({
      success: true,
      message: "Printer request marked as ready",
      data: printerRequest
    });
  } catch (error) {
    console.error("Error marking printer request as ready:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Complete printer request and deduct credits
 */
export const completeRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { creditsToDeduct } = req.body || {};

    if (creditsToDeduct === undefined || creditsToDeduct < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid credits to deduct is required"
      });
    }

    const printerRequest = await PrinterRequest.findById(id);
    if (!printerRequest) {
      return res.status(404).json({
        success: false,
        message: "Printer request not found"
      });
    }

    const wallet = await ClientCreditWallet.findOne({ client: printerRequest.client });
    if (!wallet || wallet.printerBalance < creditsToDeduct) {
      return res.status(400).json({
        success: false,
        message: "Insufficient printer credit balance"
      });
    }

    // Create credit transaction
    const transaction = await CreditTransaction.create({
      clientId: printerRequest.client,
      itemSnapshot: {
        name: `Printer Usage: ${printerRequest.fileName}`,
        unit: "credits",
        pricingMode: "credits",
        unitCredits: 1,
        taxable: false,
        gstRate: 0
      },
      quantity: creditsToDeduct,
      transactionType: "usage",
      pricingSnapshot: {
        pricingMode: "credits",
        unitCredits: 1,
        creditValueINR: wallet.printerCreditValue || 1
      },
      creditsDelta: -creditsToDeduct,
      amountINRDelta: 0,
      purpose: "Printer Usage",
      description: `Deducted ${creditsToDeduct} credits for print: ${printerRequest.fileName}`,
      status: "completed",
      createdBy: req.user?._id || null,
      metadata: {
        customData: {
          printerRequestId: printerRequest._id
        }
      }
    });

    // Update wallet
    wallet.printerBalance -= creditsToDeduct;
    await wallet.save();

    // Update printer request
    printerRequest.status = "completed";
    printerRequest.creditsToDeduct = creditsToDeduct;
    printerRequest.transactionId = transaction._id;
    printerRequest.completedAt = new Date();
    await printerRequest.save();

    await logActivity({
      req,
      action: "UPDATE",
      entity: "PrinterRequest",
      entityId: printerRequest._id,
      description: `Completed printer request and deducted ${creditsToDeduct} credits`,
      metadata: { transactionId: transaction._id }
    });

    return res.json({
      success: true,
      message: "Printer request completed and credits deducted",
      data: printerRequest
    });
  } catch (error) {
    console.error("Error completing printer request:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get printer requests
 */
export const getPrinterRequests = async (req, res) => {
  try {
    const { buildingId, clientId, status, page = 1, limit = 20 } = req.query;
    const query = {};

    if (buildingId) query.buildingId = buildingId;
    if (clientId) query.client = clientId;
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      PrinterRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("client", "companyName email")
        .populate("member", "name email")
        .populate("buildingId", "name")
        .lean(),
      PrinterRequest.countDocuments(query)
    ]);

    return res.json({
      success: true,
      data: {
        requests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error("Error getting printer requests:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
