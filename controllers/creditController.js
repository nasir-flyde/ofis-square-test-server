import { getClientCreditSummary, canConsumeCredits, getClientsWithCreditAlerts } from "../utils/creditMonitoring.js";
import { generateMonthlyCreditInvoices, runPreviousMonthConsolidation } from "../services/creditConsolidationService.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Contract from "../models/contractModel.js";

// GET /api/credits/summary/:clientId - Get credit summary for a client
export const getClientCredits = async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required"
      });
    }

    const summary = await getClientCreditSummary(clientId);
    
    return res.json({
      success: true,
      data: summary
    });
    
  } catch (error) {
    console.error("Error getting client credit summary:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// GET /api/credits/alerts - Get clients with credit alerts
export const getCreditAlerts = async (req, res) => {
  try {
    const alerts = await getClientsWithCreditAlerts();
    
    return res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
        summary: {
          critical: alerts.filter(a => a.alert_level.level === 'critical').length,
          danger: alerts.filter(a => a.alert_level.level === 'danger').length,
          warning: alerts.filter(a => a.alert_level.level === 'warning').length
        }
      }
    });
    
  } catch (error) {
    console.error("Error getting credit alerts:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// POST /api/credits/consolidate - Manually trigger credit consolidation
export const triggerCreditConsolidation = async (req, res) => {
  try {
    const { year, month } = req.body;
    
    let results;
    
    if (year && month) {
      // Consolidate specific month
      results = await generateMonthlyCreditInvoices(year, month);
    } else {
      // Consolidate previous month
      results = await runPreviousMonthConsolidation();
    }
    
    return res.json({
      success: true,
      message: `Credit consolidation completed. Created ${results.invoices_created} invoices.`,
      data: results
    });
    
  } catch (error) {
    console.error("Error triggering credit consolidation:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// GET /api/credits/transactions/:clientId - Get credit transactions for a client
export const getClientCreditTransactions = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { page = 1, limit = 20, type, startDate, endDate } = req.query;
    
    const query = { client: clientId };
    
    if (type) {
      query.type = type;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const skip = (page - 1) * limit;
    
    const [transactions, total] = await Promise.all([
      CreditTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      CreditTransaction.countDocuments(query)
    ]);
    
    return res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
    
  } catch (error) {
    console.error("Error getting credit transactions:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// POST /api/credits/grant - Grant credits to a client (admin only)
export const grantCredits = async (req, res) => {
  try {
    const { clientId, credits, reason, contractId } = req.body;
    
    if (!clientId || !credits || credits <= 0) {
      return res.status(400).json({
        success: false,
        message: "Client ID and positive credit amount are required"
      });
    }
    
    // Get contract for credit value
    const contract = await Contract.findOne({
      _id: contractId || undefined,
      client: clientId,
      credit_enabled: true,
      status: "active"
    });
    
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "No active credit-enabled contract found for this client"
      });
    }
    
    // Create credit transaction
    const transaction = await CreditTransaction.create({
      client: clientId,
      member: null,
      type: "grant",
      credits: parseInt(credits),
      valuePerCredit: contract.credit_value || 500,
      refType: "admin_adjustment",
      refId: contract._id,
      meta: {
        reason: reason || "Admin credit grant",
        granted_by: req.user?.id || "system"
      }
    });
    
    // Update client credit wallet
    await ClientCreditWallet.findOneAndUpdate(
      { client: clientId },
      { 
        $inc: { balance: parseInt(credits) },
        $set: { 
          creditValue: contract.credit_value || 500,
          status: "active"
        }
      },
      { upsert: true }
    );
    
    console.log(`Granted ${credits} credits to client ${clientId}`);
    
    return res.json({
      success: true,
      message: `Successfully granted ${credits} credits`,
      data: {
        transaction: transaction._id,
        credits_granted: credits,
        credit_value: contract.credit_value || 500
      }
    });
    
  } catch (error) {
    console.error("Error granting credits:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// PUT /api/credits/contract/:contractId - Update contract credit settings
export const updateContractCredits = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { credit_enabled, allocated_credits, credit_value, credit_terms_days } = req.body;
    
    const updateData = {};
    
    if (typeof credit_enabled === 'boolean') {
      updateData.credit_enabled = credit_enabled;
    }
    
    if (allocated_credits !== undefined) {
      updateData.allocated_credits = parseInt(allocated_credits);
    }
    
    if (credit_value !== undefined) {
      updateData.credit_value = parseFloat(credit_value);
    }
    
    if (credit_terms_days !== undefined) {
      updateData.credit_terms_days = parseInt(credit_terms_days);
    }
    
    const contract = await Contract.findByIdAndUpdate(
      contractId,
      updateData,
      { new: true, runValidators: true }
    ).populate('client');
    
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found"
      });
    }
    
    // If enabling credits, ensure client has a credit wallet
    if (credit_enabled && contract.client) {
      await ClientCreditWallet.findOneAndUpdate(
        { client: contract.client._id },
        { 
          creditValue: contract.credit_value || 500,
          status: "active"
        },
        { upsert: true }
      );
    }
    
    return res.json({
      success: true,
      message: "Contract credit settings updated successfully",
      data: {
        contract_id: contract._id,
        credit_enabled: contract.credit_enabled,
        allocated_credits: contract.allocated_credits,
        credit_value: contract.credit_value,
        credit_terms_days: contract.credit_terms_days
      }
    });
    
  } catch (error) {
    console.error("Error updating contract credits:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
