import CreditTransaction from "../models/creditTransactionModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Contract from "../models/contractModel.js";
import Building from "../models/buildingModel.js";

/**
 * Get credit summary for a client
 * @param {string} clientId - Client ObjectId
 * @returns {object} Credit summary with usage, limits, and alerts
 */
export async function getClientCreditSummary(clientId) {
  try {
    // Get client's credit wallet
    const wallet = await ClientCreditWallet.findOne({ client: clientId });
    
    // Get active credit-enabled contracts
    const contracts = await Contract.find({
      client: clientId,
      credit_enabled: true,
      status: "active"
    }).populate('building');

    if (!contracts.length) {
      return {
        credit_enabled: false,
        message: "No active credit-enabled contracts found"
      };
    }

    // Calculate current month usage
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const monthlyUsage = await calculateCreditUsage(clientId, monthStart, monthEnd);
    
    // Get total allocated credits across all contracts
    const totalAllocatedCredits = contracts.reduce((sum, contract) => sum + (contract.allocated_credits || 0), 0);
    
    // Get creditValue from building (use first contract's building)
    const building = contracts[0]?.building || await Building.findById(contracts[0]?.building);
    const creditValue = building?.creditValue || 500;
    
    // Calculate exposure and available credits
    const usedCredits = monthlyUsage.total_credits;
    const availableCredits = Math.max(0, totalAllocatedCredits - usedCredits);
    const overLimitCredits = Math.max(0, usedCredits - totalAllocatedCredits);
    const exposureAmount = overLimitCredits * creditValue;
    
    // Calculate usage percentage and alert level
    const usagePercentage = totalAllocatedCredits > 0 ? (usedCredits / totalAllocatedCredits) * 100 : 0;
    const alertLevel = getAlertLevel(usagePercentage);
    
    return {
      credit_enabled: true,
      current_month: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        month_name: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      },
      credits: {
        allocated: totalAllocatedCredits,
        used: usedCredits,
        available: availableCredits,
        over_limit: overLimitCredits,
        credit_value: creditValue
      },
      amounts: {
        allocated_value: totalAllocatedCredits * creditValue,
        used_value: usedCredits * creditValue,
        exposure: exposureAmount
      },
      usage: {
        percentage: Math.round(usagePercentage * 100) / 100,
        alert_level: alertLevel,
        breakdown: monthlyUsage.breakdown
      },
      wallet: {
        balance: wallet?.balance || 0,
        status: wallet?.status || 'inactive'
      },
      contracts: contracts.map(c => ({
        id: c._id,
        building: c.building?._id || c.building,
        building_name: c.building?.name,
        allocated_credits: c.allocated_credits,
        terms_days: c.credit_terms_days
      })),
      building: {
        id: building?._id,
        name: building?.name,
        credit_value: creditValue
      }
    };
    
  } catch (error) {
    console.error('Error getting client credit summary:', error);
    throw error;
  }
}

/**
 * Calculate credit usage for a specific period
 */
async function calculateCreditUsage(clientId, startDate, endDate) {
  const transactions = await CreditTransaction.find({
    client: clientId,
    type: "consume",
    createdAt: { $gte: startDate, $lte: endDate }
  }).sort({ createdAt: -1 });

  const summary = {
    total_credits: 0,
    total_amount: 0,
    transaction_count: transactions.length,
    breakdown: {},
    recent_transactions: transactions.slice(0, 10).map(t => ({
      date: t.createdAt,
      credits: t.credits,
      amount: t.credits * t.valuePerCredit,
      type: t.refType,
      description: t.meta?.description || `${t.refType} usage`
    }))
  };

  for (const transaction of transactions) {
    summary.total_credits += transaction.credits;
    summary.total_amount += (transaction.credits * transaction.valuePerCredit);
    
    // Group by refType for breakdown
    const refType = transaction.refType || 'other';
    if (!summary.breakdown[refType]) {
      summary.breakdown[refType] = { credits: 0, amount: 0, count: 0 };
    }
    summary.breakdown[refType].credits += transaction.credits;
    summary.breakdown[refType].amount += (transaction.credits * transaction.valuePerCredit);
    summary.breakdown[refType].count++;
  }

  return summary;
}

/**
 * Get alert level based on usage percentage
 */
function getAlertLevel(usagePercentage) {
  if (usagePercentage >= 120) return { level: 'critical', message: 'Significantly over credit limit' };
  if (usagePercentage >= 100) return { level: 'danger', message: 'Over credit limit' };
  if (usagePercentage >= 80) return { level: 'warning', message: 'Approaching credit limit' };
  if (usagePercentage >= 60) return { level: 'info', message: 'Moderate credit usage' };
  return { level: 'success', message: 'Within credit limit' };
}

/**
 * Check if client can consume specified credits
 */
export async function canConsumeCredits(clientId, creditsNeeded, allowOverLimit = true) {
  try {
    const summary = await getClientCreditSummary(clientId);
    
    if (!summary.credit_enabled) {
      return {
        allowed: false,
        reason: 'Credit system not enabled for this client'
      };
    }
    
    const afterUsage = summary.credits.used + creditsNeeded;
    const wouldExceedLimit = afterUsage > summary.credits.allocated;
    
    if (wouldExceedLimit && !allowOverLimit) {
      return {
        allowed: false,
        reason: 'Would exceed credit limit',
        current_usage: summary.credits.used,
        limit: summary.credits.allocated,
        requested: creditsNeeded,
        would_be: afterUsage
      };
    }
    
    return {
      allowed: true,
      current_usage: summary.credits.used,
      limit: summary.credits.allocated,
      requested: creditsNeeded,
      would_be: afterUsage,
      over_limit: wouldExceedLimit,
      exposure_increase: wouldExceedLimit ? (afterUsage - summary.credits.allocated) * summary.credits.credit_value : 0
    };
    
  } catch (error) {
    console.error('Error checking credit consumption:', error);
    return {
      allowed: false,
      reason: 'Error checking credit limits'
    };
  }
}

/**
 * Get clients approaching or over credit limits
 */
export async function getClientsWithCreditAlerts() {
  try {
    // Get all clients with active credit contracts
    const contracts = await Contract.find({
      credit_enabled: true,
      status: "active"
    }).populate('client');
    
    const alerts = [];
    
    for (const contract of contracts) {
      try {
        // Skip if client is null
        if (!contract.client || !contract.client._id) {
          console.warn(`Contract ${contract._id} has no associated client`);
          continue;
        }
        
        const summary = await getClientCreditSummary(contract.client._id);
        
        if (summary.credit_enabled && summary.usage.percentage >= 80) {
          alerts.push({
            client: {
              id: contract.client._id,
              name: contract.client.name || contract.client.companyName,
              email: contract.client.email
            },
            usage: summary.usage,
            credits: summary.credits,
            exposure: summary.amounts.exposure,
            alert_level: summary.usage.alert_level
          });
        }
      } catch (clientError) {
        console.error(`Error checking alerts for client ${contract.client?._id}:`, clientError);
      }
    }
    
    // Sort by usage percentage (highest first)
    alerts.sort((a, b) => b.usage.percentage - a.usage.percentage);
    
    return alerts;
    
  } catch (error) {
    console.error('Error getting credit alerts:', error);
    throw error;
  }
}

export default {
  getClientCreditSummary,
  canConsumeCredits,
  getClientsWithCreditAlerts
};
