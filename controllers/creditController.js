import { getClientCreditSummary, canConsumeCredits, getClientsWithCreditAlerts } from "../utils/creditMonitoring.js";
import { generateMonthlyCreditInvoices, runPreviousMonthConsolidation } from "../services/creditConsolidationService.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Contract from "../models/contractModel.js";
import CreditCustomItem from "../models/creditCustomItemModel.js";
import Invoice from "../models/invoiceModel.js";
import Building from "../models/buildingModel.js";
import { previewCreditPurchaseInvoice } from "../services/invoiceService.js";
import { logActivity } from "../utils/activityLogger.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import mongoose from "mongoose";

export const getClientCredits = async (req, res) => {
  try {
    let { clientId } = req.params;
    
    // If no clientId in params, use authenticated user's client
    if (!clientId && req.clientId) {
      clientId = req.clientId;
    }
    
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

// POST /api/credits/consume-item - Consume credits for a specific item (no invoice, just usage tracking)
export const consumeCreditsForItem = async (req, res) => {
  try {
    const { clientId, itemId, quantity, description = '', idempotencyKey = null } = req.body;
    
    if (!clientId || !itemId || !quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "clientId, itemId, and positive quantity are required"
      });
    }
    
    // Get contract and item
    const contract = await Contract.findOne({
      client: clientId,
      credit_enabled: true,
      status: "active"
    }).populate('client').populate('building');
    
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "No active credit-enabled contract found for this client"
      });
    }
    
    // Get building to fetch creditValue
    const building = contract.building || await Building.findById(contract.building);
    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found for this contract"
      });
    }
    
    const item = await CreditCustomItem.findById(itemId);
    if (!item || !item.active) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found or inactive"
      });
    }
    
    if (item.pricingMode !== 'credits') {
      return res.status(400).json({
        success: false,
        message: "Item must be credit-priced to consume credits"
      });
    }
    
    const creditsToConsume = quantity * item.unitCredits;
    const creditValue = building.creditValue || 500;
    
    // Get current wallet balance
    const wallet = await ClientCreditWallet.findOne({ client: clientId });
    const currentBalance = wallet?.balance || 0;
    
    // ENFORCE NO NEGATIVE BALANCE: Block consumption if insufficient credits
    if (currentBalance < creditsToConsume) {
      return res.status(400).json({
        success: false,
        message: "Insufficient credit balance",
        data: {
          required_credits: creditsToConsume,
          available_credits: currentBalance,
          shortage: creditsToConsume - currentBalance
        }
      });
    }
    
    // Create usage transaction
    const transaction = await CreditTransaction.create({
      clientId,
      contractId: contract._id,
      itemId,
      itemSnapshot: {
        name: item.name,
        unit: item.unit,
        pricingMode: item.pricingMode,
        unitCredits: item.unitCredits,
        unitPriceINR: item.unitPriceINR,
        taxable: item.taxable,
        gstRate: item.gstRate,
        zohoItemId: item.zohoItemId
      },
      quantity,
      transactionType: 'usage',
      pricingSnapshot: {
        pricingMode: 'credits',
        unitCredits: item.unitCredits,
        unitPriceINR: null,
        creditValueINR: creditValue
      },
      creditsDelta: -creditsToConsume, // Negative for usage
      amountINRDelta: 0, // No immediate INR billing
      purpose: 'Item usage',
      description: description || `Used ${quantity} ${item.unit} of ${item.name}`,
      status: 'completed',
      createdBy: req.user?.id || req.user?._id,
      relatedInvoiceId: null,
      idempotencyKey,
      metadata: {
        customData: {
          consumedAt: new Date(),
          buildingId: building._id,
          buildingName: building.name,
          creditValue: creditValue
        }
      }
    });
    
    // Update wallet balance (will not go negative due to check above)
    await ClientCreditWallet.findOneAndUpdate(
      { client: clientId },
      { 
        $inc: { balance: -creditsToConsume },
        $set: { 
          creditValue: creditValue,
          status: "active"
        }
      },
      { upsert: true, runValidators: true }
    );
    
    const newBalance = currentBalance - creditsToConsume;

    // Activity log: credits consumed
    await logActivity({
      req,
      action: 'UPDATE',
      entity: 'Credits',
      entityId: contract.client?._id || clientId,
      description: `Consumed ${creditsToConsume} credits for ${item.name}`,
      metadata: {
        transactionId: transaction._id,
        clientId,
        itemId: item._id,
        quantity,
        creditsToConsume,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
        buildingId: building._id,
        creditValue: creditValue
      }
    });

    return res.json({
      success: true,
      message: `Successfully consumed ${creditsToConsume} credits for ${item.name}`,
      data: {
        transaction: transaction._id,
        item: {
          id: item._id,
          name: item.name,
          quantity: quantity,
          creditsPerUnit: item.unitCredits
        },
        credits_consumed: creditsToConsume,
        balance_before: currentBalance,
        balance_after: newBalance,
        credit_value: creditValue,
        building: {
          id: building._id,
          name: building.name
        }
      }
    });
    
  } catch (error) {
    console.error("Error consuming credits for item:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

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
    const { year, month, clientId } = req.body;
    
    // If clientId is provided, use the single client exceeded invoice endpoint
    if (clientId) {
      return await generateExceededCreditsInvoice(req, res);
    }
    
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
    let { clientId } = req.params;
    
    // If no clientId in params, use authenticated user's client
    if (!clientId && req.clientId) {
      clientId = req.clientId;
    }
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required"
      });
    }
    
    const { page = 1, limit = 20, type, startDate, endDate } = req.query;
    
    const query = { clientId };
    
    if (type && type !== 'all') {
      query.transactionType = type;
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
        .populate('createdBy', 'name email')
        .populate('itemId', 'name code')
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

// POST /api/credits/grant - Grant credits to a client (wallet only, no invoice)
export const grantCredits = async (req, res) => {
  try {
    const { clientId, credits, idempotencyKey = null, reason } = req.body;
    
    if (!clientId || !credits || credits <= 0) {
      return res.status(400).json({
        success: false,
        message: "Client ID and positive credit amount are required"
      });
    }
    
    // Get contract and building for credit value
    const contract = await Contract.findOne({
      client: clientId,
      credit_enabled: true,
      status: "active"
    }).populate('building').sort({ createdAt: -1 });
    
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "No active credit-enabled contract found for this client"
      });
    }

    const building = contract.building || await Building.findById(contract.building);
    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found for this contract"
      });
    }

    const creditValue = building.creditValue || 500;
    let transaction = null;
    
    // Create credit transaction
    transaction = await CreditTransaction.create({
      clientId,
      contractId: contract._id,
      itemId: null,
      itemSnapshot: {
        name: 'Credits Grant',
        unit: 'credits',
        pricingMode: 'credits',
        unitCredits: 1,
        unitPriceINR: null,
        taxable: false,
        gstRate: 0,
        zohoItemId: null
      },
      quantity: credits,
      transactionType: 'grant',
      pricingSnapshot: {
        pricingMode: 'credits',
        unitCredits: 1,
        unitPriceINR: null,
        creditValueINR: creditValue
      },
      creditsDelta: credits,
      amountINRDelta: 0, // no immediate INR billing for grants
      purpose: 'Credit grant',
      description: reason || `Admin granted ${credits} credits`,
      status: 'completed',
      createdBy: req.user?.id || req.user?._id,
      relatedInvoiceId: null,
      idempotencyKey,
      metadata: {
        customData: {
          grantedBy: req.user?.name || req.user?.email || 'Admin',
          autoInvoice: false
        }
      }
    });
    
    // Update client credit wallet
    await ClientCreditWallet.findOneAndUpdate(
      { client: clientId },
      { 
        $inc: { balance: parseInt(credits) },
        $set: { 
          creditValue: creditValue,
          status: "active"
        }
      },
      { upsert: true }
    );

    console.log(`Granted ${credits} credits to client ${clientId} (wallet only, no invoice)`);

    // Activity log: credits granted
    await logActivity({
      req,
      action: 'CREATE',
      entity: 'Credits',
      entityId: clientId,
      description: `Granted ${credits} credits to client`,
      metadata: {
        transactionId: transaction._id,
        clientId,
        creditsGranted: credits,
        creditValue
      }
    });
    
    return res.json({
      success: true,
      message: `Successfully granted ${credits} credits (added to wallet)`,
      data: {
        transaction: transaction._id,
        credits_granted: credits,
        credit_value: creditValue
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

// GET /api/credits/grant/preview - Preview credit purchase invoice
export const previewCreditGrant = async (req, res) => {
  try {
    const { clientId, credits, taxable = true, gstRate = 18 } = req.query;
    
    if (!clientId || !credits || credits <= 0) {
      return res.status(400).json({
        success: false,
        message: "Client ID and positive credit amount are required"
      });
    }
    
    const preview = await previewCreditPurchaseInvoice(
      clientId, 
      parseInt(credits), 
      { taxable: taxable === 'true', gstRate: parseFloat(gstRate) }
    );
    
    return res.json({
      success: true,
      data: preview
    });
    
  } catch (error) {
    console.error("Error previewing credit grant:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// POST /api/credits/exceeded-invoice - Generate exceeded credits invoice for a client
export const generateExceededCreditsInvoice = async (req, res) => {
  try {
    const { clientId, year, month, preview = false, singleInvoice = true } = req.body;
    
    if (!clientId || !year || !month) {
      return res.status(400).json({
        success: false,
        message: "Client ID, year, and month are required"
      });
    }
    
    // Get client and contract
    const contract = await Contract.findOne({
      client: clientId,
      credit_enabled: true,
      status: "active"
    }).populate('client').populate('building');
    
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "No active credit-enabled contract found for this client"
      });
    }
    
    // Get building for creditValue
    const building = contract.building || await Building.findById(contract.building);
    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found for this contract"
      });
    }
    
    const billingStart = new Date(year, month - 1, 1);
    const billingEnd = new Date(year, month, 0);
    
    // Calculate exceeded credits by item
    const exceededData = await calculateExceededCreditsByItem(clientId, billingStart, billingEnd, contract, building);
    
    if (preview) {
      return res.json({
        success: true,
        data: {
          client: {
            id: contract.client._id,
            name: contract.client.name || contract.client.companyName
          },
          period: { year, month },
          allocated: exceededData.allocated,
          used: exceededData.used,
          extra: exceededData.extra,
          creditValue: exceededData.creditValue,
          items: exceededData.items,
          subTotal: exceededData.subTotal,
          gst: exceededData.gst,
          total: exceededData.total
        }
      });
    }
    
    // If singleInvoice is requested, prevent duplicates for the period
    if (singleInvoice) {
      const existingInvoice = await Invoice.findOne({
        client: clientId,
        type: "credit_monthly",
        "billing_period.start": billingStart,
        "billing_period.end": billingEnd
      });
      
      if (existingInvoice) {
        return res.status(409).json({
          success: false,
          message: `Invoice already exists for this period: ${existingInvoice.invoice_number}`
        });
      }
    }
    
    if (exceededData.extra <= 0) {
      return res.json({
        success: true,
        message: "No exceeded credits to invoice",
        data: {
          allocated: exceededData.allocated,
          used: exceededData.used,
          extra: 0
        }
      });
    }
    
    // Create invoice with item breakdown
    const invoice = await createExceededCreditsInvoice({
      client: contract.client,
      contract,
      billingStart,
      billingEnd,
      exceededData,
      singleInvoice,
      building
    });
    
    return res.json({
      success: true,
      message: `Successfully created exceeded credits invoice`,
      data: {
        invoice: {
          id: invoice._id,
          invoice_number: invoice.invoice_number,
          total: invoice.total,
          status: invoice.status
        },
        allocated: exceededData.allocated,
        used: exceededData.used,
        extra: exceededData.extra,
        items: exceededData.items
      }
    });
    
  } catch (error) {
    console.error("Error generating exceeded credits invoice:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const recordCreditTransaction = async (req, res) => {
  try {
    const {
      clientId,
      itemId = null,
      itemSnapshot = null,
      quantity,
      transactionType = 'usage',
      purpose = '',
      description = '',
      idempotencyKey = null
    } = req.body;

    if (!clientId || !quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Client ID and positive quantity are required"
      });
    }

    if (!itemId && !itemSnapshot) {
      return res.status(400).json({
        success: false,
        message: "Either itemId or itemSnapshot is required"
      });
    }

    // Get contract and building for credit value
    const contract = await Contract.findOne({
      client: clientId,
      credit_enabled: true,
      status: "active"
    }).populate('building').sort({ createdAt: -1 });

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "No active credit-enabled contract found for this client"
      });
    }

    const building = contract.building || await Building.findById(contract.building);
    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found for this contract"
      });
    }

    const creditValue = building.creditValue || 500;
    let finalItemSnapshot = itemSnapshot;

    // If using itemId, fetch the item details
    if (itemId) {
      const customItem = await CreditCustomItem.findById(itemId);
      if (!customItem) {
        return res.status(404).json({
          success: false,
          message: "Custom item not found"
        });
      }
      
      finalItemSnapshot = {
        name: customItem.name,
        unit: customItem.unit,
        pricingMode: customItem.pricingMode,
        unitCredits: customItem.unitCredits,
        unitPriceINR: customItem.unitPriceINR,
        taxable: customItem.taxable,
        gstRate: customItem.gstRate,
        zohoItemId: customItem.zohoItemId
      };
    }

    // Calculate deltas
    let creditsDelta = 0;
    let amountINRDelta = 0;

    if (finalItemSnapshot.pricingMode === 'credits') {
      creditsDelta = quantity * finalItemSnapshot.unitCredits;
      amountINRDelta = creditsDelta * creditValue;
    } else {
      amountINRDelta = quantity * finalItemSnapshot.unitPriceINR;
      // For INR-priced items, we don't deduct credits by default
    }

    // Make negative for usage/deduct
    if (transactionType === 'usage' || transactionType === 'deduct') {
      creditsDelta = -Math.abs(creditsDelta);
      amountINRDelta = -Math.abs(amountINRDelta);
    }

    // Create transaction
    const transaction = await CreditTransaction.create({
      clientId,
      contractId: contract._id,
      itemId,
      itemSnapshot: finalItemSnapshot,
      quantity,
      transactionType,
      pricingSnapshot: {
        pricingMode: finalItemSnapshot.pricingMode,
        unitCredits: finalItemSnapshot.unitCredits,
        unitPriceINR: finalItemSnapshot.unitPriceINR,
        creditValueINR: creditValue
      },
      creditsDelta,
      amountINRDelta,
      purpose,
      description,
      status: 'completed',
      createdBy: req.user?.id || req.user?._id,
      idempotencyKey,
      metadata: {
        customData: {
          recordedBy: req.user?.name || req.user?.email || 'Admin'
        }
      }
    });

    // Update client credit wallet if credits are involved
    if (finalItemSnapshot.pricingMode === 'credits') {
      await ClientCreditWallet.findOneAndUpdate(
        { client: clientId },
        { 
          $inc: { balance: creditsDelta },
          $set: { 
            creditValue: creditValue,
            status: "active"
          }
        },
        { upsert: true }
      );
    }

    // Activity log: generic credit transaction
    await logActivity({
      req,
      action: creditsDelta < 0 ? 'UPDATE' : 'CREATE',
      entity: 'Credits',
      entityId: clientId,
      description: `${creditsDelta < 0 ? 'Consumed' : 'Added'} ${Math.abs(creditsDelta)} credits via ${transactionType}`,
      metadata: {
        transactionId: transaction._id,
        clientId,
        itemId,
        transactionType,
        creditsDelta,
        amountINRDelta,
        itemName: finalItemSnapshot.name
      }
    });

    return res.status(201).json({
      success: true,
      message: "Credit transaction recorded successfully",
      data: {
        transaction: transaction._id,
        credits_delta: creditsDelta,
        amount_delta: amountINRDelta,
        item_name: finalItemSnapshot.name
      }
    });

  } catch (error) {
    console.error("Error recording credit transaction:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

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

// Helper function to calculate exceeded credits by item for a client/period
async function calculateExceededCreditsByItem(clientId, billingStart, billingEnd, contract, building) {
  const allocatedCredits = contract.allocated_credits || 0;
  const creditValue = building?.creditValue || 500;
  
  // Get all credit transactions for the period
  const transactions = await CreditTransaction.find({
    clientId: new mongoose.Types.ObjectId(clientId),
    transactionType: 'usage',
    status: 'completed',
    createdAt: { $gte: billingStart, $lte: billingEnd },
    creditsDelta: { $lt: 0 } // Only usage transactions (negative delta)
  }).sort({ createdAt: 1 });
  
  // Group by item
  const itemUsage = {};
  let totalUsedCredits = 0;
  
  for (const transaction of transactions) {
    const creditsUsed = Math.abs(transaction.creditsDelta);
    totalUsedCredits += creditsUsed;
    
    let itemKey, itemName;
    if (transaction.itemId) {
      itemKey = transaction.itemId.toString();
      itemName = transaction.itemSnapshot?.name || 'Custom Item';
    } else {
      // Legacy transactions or non-item usage
      itemKey = 'general_usage';
      itemName = transaction.purpose || 'General Usage';
    }
    
    if (!itemUsage[itemKey]) {
      itemUsage[itemKey] = {
        name: itemName,
        usedCredits: 0,
        extraCredits: 0,
        amount: 0,
        transactions: []
      };
    }
    
    itemUsage[itemKey].usedCredits += creditsUsed;
    itemUsage[itemKey].transactions.push(transaction);
  }
  
  // Calculate exceeded credits per item (proportional allocation)
  const totalExtraCredits = Math.max(0, totalUsedCredits - allocatedCredits);
  const items = [];
  
  if (totalExtraCredits > 0) {
    for (const [itemKey, usage] of Object.entries(itemUsage)) {
      // Proportional allocation of exceeded credits
      const proportion = usage.usedCredits / totalUsedCredits;
      const extraCredits = Math.round(totalExtraCredits * proportion);
      const amount = extraCredits * creditValue;
      
      if (extraCredits > 0) {
        items.push({
          itemKey,
          name: usage.name,
          usedCredits: usage.usedCredits,
          extraCredits,
          amount,
          transactions: usage.transactions.length
        });
      }
    }
  }
  
  const subTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const gst = Math.round(subTotal * 0.18 * 100) / 100;
  const total = subTotal + gst;
  
  return {
    allocated: allocatedCredits,
    used: totalUsedCredits,
    extra: totalExtraCredits,
    creditValue,
    items,
    subTotal,
    gst,
    total
  };
}

// Helper function to create exceeded credits invoice with item breakdown
async function createExceededCreditsInvoice({ client, contract, billingStart, billingEnd, exceededData, singleInvoice = true, building }) {
  let invoiceNumber = await generateLocalInvoiceNumber();
  // If allowing multiple invoices for same period, append a random 4-digit suffix for clarity
  if (!singleInvoice) {
    const rand4 = Math.floor(1000 + Math.random() * 9000);
    invoiceNumber = `${invoiceNumber}-${rand4}`;
  }
  const monthName = billingStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  // Create line items from exceeded credits by item
  const lineItems = [];
  
  for (const item of exceededData.items) {
    lineItems.push({
      description: `Exceeded Credits - ${item.name} (${monthName})`,
      name: item.name,
      quantity: item.extraCredits,
      rate: exceededData.creditValue,
      unitPrice: exceededData.creditValue,
      amount: item.amount,
      item_total: item.amount,
      unit: "credits",
      tax_name: "GST",
      tax_percentage: 0,
      zoho_item_id: null // Could be mapped from itemSnapshot if available
    });
  }
  
  // Create invoice
  const invoice = await Invoice.create({
    invoice_number: invoiceNumber,
    client: client._id,
    contract: contract._id,
    building: contract.building,
    // Use 'regular' type when creating additional invoices to avoid unique index collision
    type: singleInvoice ? "credit_monthly" : "regular",
    category: "exceeded_credits",
    source: "local",
    
    date: billingStart,
    due_date: new Date(billingEnd.getFullYear(), billingEnd.getMonth() + 1, 2),
    billing_period: {
      start: billingStart,
      end: billingEnd
    },
    
    line_items: lineItems,
    sub_total: exceededData.subTotal,
    tax_total: exceededData.gst,
    total: exceededData.total,
    amount_paid: 0,
    balance: exceededData.total,
    
    status: "draft",
    notes: `Exceeded credits invoice for ${monthName}. Allocated: ${exceededData.allocated} credits, Used: ${exceededData.used} credits, Extra: ${exceededData.extra} credits.`,
    
    // Zoho Books fields
    currency_code: "INR",
    exchange_rate: 1,
    gst_treatment: "business_gst",
    place_of_supply: "MH",
    payment_terms: contract.credit_terms_days || 30,
    payment_terms_label: `Net ${contract.credit_terms_days || 30}`,
    is_inclusive_tax: false,
    
    // Client address mapping (if available)
    ...(client.billingAddress && {
      billing_address: {
        attention: client.contactPerson,
        address: client.billingAddress.address,
        city: client.billingAddress.city,
        state: client.billingAddress.state,
        zip: client.billingAddress.zip,
        country: client.billingAddress.country || "IN",
        phone: client.phone
      }
    }),
    
    // Map customer for Zoho integration
    customer_id: client.zohoBooksContactId,
    gst_no: client.gstNo
  });
  
  console.log(`Created exceeded credits invoice ${invoice._id} locally with number ${invoiceNumber}`);
  
  // Push to Zoho Books (same pattern as createInvoiceFromContract)
  try {
    if (client.zohoBooksContactId) {
      const { createZohoInvoiceFromLocal } = await import("../utils/zohoBooks.js");
      const zohoResponse = await createZohoInvoiceFromLocal(invoice.toObject(), client.toObject ? client.toObject() : client);
      const invoiceData = zohoResponse.invoice || zohoResponse;
      
      if (invoiceData && invoiceData.invoice_id) {
        invoice.zoho_invoice_id = invoiceData.invoice_id;
        invoice.zoho_invoice_number = invoiceData.invoice_number;
        invoice.zoho_status = invoiceData.status || invoiceData.status_formatted;
        invoice.zoho_pdf_url = invoiceData.pdf_url;
        invoice.invoice_url = invoiceData.invoice_url;
        await invoice.save();
        
        console.log(`Pushed exceeded credits invoice ${invoice._id} to Zoho Books: ${invoiceData.invoice_id}`);
      } else {
        console.warn(`Zoho Books did not return invoice_id for exceeded credits invoice ${invoice._id}`);
      }
    } else {
      console.log(`Skipping Zoho push for exceeded credits invoice ${invoice._id} - client has no zohoBooksContactId`);
    }
  } catch (zohoError) {
    console.error(`Failed to push exceeded credits invoice ${invoice._id} to Zoho Books:`, zohoError.message);
    // Do not fail invoice creation if Zoho push fails
  }
  
  return invoice;
};
