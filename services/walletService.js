import mongoose from "mongoose";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";
import { sendNotification } from "../utils/notificationHelper.js";

class WalletService {

  // Get or create wallet for a client
  static async getOrCreateWallet(clientId) {
    try {
      let wallet = await ClientCreditWallet.findOne({ client: clientId });

      if (!wallet) {
        wallet = await ClientCreditWallet.create({
          client: clientId,
          balance: 0,
          creditValue: 500,
          currency: "INR",
          status: "active"
        });
      }

      return wallet;
    } catch (error) {
      console.error("Error in getOrCreateWallet:", error);
      throw new Error("Failed to get or create wallet");
    }
  }

  // Grant credits to a client wallet
  static async grantCredits({ clientId, credits, valuePerCredit, refType, refId, meta = {}, createdBy = null }) {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // Get or create wallet
        const wallet = await this.getOrCreateWallet(clientId);

        // Use fixed credit value of 500 INR per credit
        const finalValuePerCredit = 500;

        // Update wallet balance
        await ClientCreditWallet.findByIdAndUpdate(
          wallet._id,
          { $inc: { balance: credits } },
          { session }
        );

        // Create transaction record with all required fields
        await CreditTransaction.create([{
          clientId: clientId,
          contractId: refType === 'contract' ? refId : null,
          itemId: null, // No specific item for credit grants
          itemSnapshot: {
            name: "Credit Grant",
            unit: "credits",
            pricingMode: "credits",
            unitCredits: 1,
            taxable: false,
            gstRate: 0
          },
          quantity: credits,
          transactionType: "grant",
          pricingSnapshot: {
            pricingMode: "credits",
            unitCredits: 1,
            creditValueINR: finalValuePerCredit
          },
          creditsDelta: credits, // Positive for grants
          amountINRDelta: credits * finalValuePerCredit, // Positive for grants
          purpose: meta.reason || "Admin credit grant",
          description: `Granted ${credits} credits to client`,
          status: "completed",
          createdBy: createdBy || new mongoose.Types.ObjectId(), // Use provided or generate dummy ID
          metadata: {
            customData: meta
          }
        }], { session });
      });

      return { success: true, message: "Credits granted successfully" };
    } catch (error) {
      console.error("Error in grantCredits:", error);
      throw new Error("Failed to grant credits");
    } finally {
      await session.endSession();
    }
  }

  // Consume credits with overdraft support
  static async consumeCreditsWithOverdraft({
    clientId,
    memberId,
    requiredCredits,
    idempotencyKey,
    refType,
    refId,
    meta = {}
  }) {
    const session = await mongoose.startSession();

    try {
      let result = {};

      await session.withTransaction(async () => {
        // Check for existing transaction with same idempotency key
        if (idempotencyKey) {
          const existingTransaction = await CreditTransaction.findOne({
            client: clientId,
            idempotencyKey
          }).session(session);

          if (existingTransaction) {
            throw new Error("Transaction already processed");
          }
        }

        // Get wallet
        const wallet = await ClientCreditWallet.findOne({ client: clientId }).session(session);
        if (!wallet) {
          throw new Error("Wallet not found");
        }

        // Calculate split
        const coveredCredits = Math.min(wallet.balance, requiredCredits);
        const extraCredits = requiredCredits - coveredCredits;
        const overageAmount = extraCredits * wallet.creditValue;

        // Update wallet balance (only decrease by covered credits)
        if (coveredCredits > 0) {
          await ClientCreditWallet.findByIdAndUpdate(
            wallet._id,
            { $inc: { balance: -coveredCredits } },
            { session }
          );
        }

        // Create transaction for covered credits
        if (coveredCredits > 0) {
          await CreditTransaction.create([{
            clientId: clientId,
            itemSnapshot: {
              name: meta.title || `${refType} booking`,
              pricingMode: 'credits',
              unitCredits: 1
            },
            quantity: coveredCredits,
            transactionType: "usage",
            pricingSnapshot: {
              pricingMode: 'credits',
              creditValueINR: 500
            },
            creditsDelta: -coveredCredits,
            amountINRDelta: -coveredCredits * 500,
            createdBy: memberId || clientId,
            idempotencyKey,
            metadata: {
              ...meta,
              overdraft: false,
              bookingId: refId
            }
          }], { session });
        }

        // Create transaction for extra credits (overdraft)
        if (extraCredits > 0) {
          await CreditTransaction.create([{
            clientId: clientId,
            itemSnapshot: {
              name: `${meta.title || `${refType} booking`} (Overdraft)`,
              pricingMode: 'credits',
              unitCredits: 1
            },
            quantity: extraCredits,
            transactionType: "usage",
            pricingSnapshot: {
              pricingMode: 'credits',
              creditValueINR: 500
            },
            creditsDelta: -extraCredits,
            amountINRDelta: -extraCredits * 500,
            createdBy: memberId || clientId,
            idempotencyKey: idempotencyKey ? `${idempotencyKey}_overdraft` : null,
            metadata: {
              ...meta,
              overdraft: true,
              bookingId: refId
            }
          }], { session });
        }

        result = {
          success: true,
          coveredCredits,
          extraCredits,
          overageAmount,
          valuePerCredit: 500
        };
      });

      // Post-transaction notifications (async, non-blocking)
      try {
        const wallet = await ClientCreditWallet.findOne({ client: clientId });
        if (wallet) {
          const balance = wallet.balance;
          let templateKey = null;
          if (balance === 0 && requiredCredits > 0) {
            templateKey = 'credits_consumed_all';
          } else if (balance > 0 && balance <= 5) {
            templateKey = 'credits_low_balance';
          }

          if (templateKey) {
            let to = { clientId };
            let memberName = 'Member';
            let email = null;

            if (memberId) {
              const m = await Member.findById(memberId).select('firstName email').lean();
              if (m?.email) email = m.email;
              if (m?.firstName) memberName = m.firstName;
            } else {
              const c = await Client.findById(clientId).select('contactPerson email').lean();
              if (c?.email) email = c.email;
              if (c?.contactPerson) memberName = c.contactPerson;
            }

            if (email) {
              to.email = email;
              await sendNotification({
                to,
                channels: { email: true, sms: false },
                templateKey,
                templateVariables: {
                  greeting: "Ofis Square",
                  remainingCredits: String(balance),
                  memberName,
                  companyName: 'Ofis Square'
                },
                title: templateKey === 'credits_consumed_all' ? 'Credits Exhausted' : 'Low Credit Balance',
                source: 'system',
                type: 'transactional'
              });
            }
          }
        }
      } catch (notifyErr) {
        console.warn('WalletService: failed to send credit notification:', notifyErr?.message || notifyErr);
      }

      return result;
    } catch (error) {
      console.error("Error in consumeCreditsWithOverdraft:", error);
      throw new Error(error.message || "Failed to consume credits");
    } finally {
      await session.endSession();
    }
  }

  // Reverse credits back to client wallet (e.g., on cancellation)
  static async reverseCredits({
    clientId,
    memberId,
    credits,
    idempotencyKey,
    refType,
    refId,
    meta = {},
    createdBy = null,
  }) {
    const session = await mongoose.startSession();
    try {
      let result = {};
      await session.withTransaction(async () => {
        if (!clientId) throw new Error("clientId is required for reverseCredits");
        const qty = Number(credits || 0);
        if (!(qty > 0)) throw new Error("credits must be > 0 for reverseCredits");

        // Idempotency: ensure we don't double-refund
        if (idempotencyKey) {
          const existing = await CreditTransaction.findOne({ clientId, idempotencyKey }).session(session);
          if (existing) {
            result = { success: true, alreadyProcessed: true };
            return;
          }
        }

        // Ensure wallet exists
        const wallet = await this.getOrCreateWallet(clientId);

        // Increase wallet balance by refunded credits
        await ClientCreditWallet.findByIdAndUpdate(
          wallet._id,
          { $inc: { balance: qty } },
          { session }
        );

        const valuePerCredit = 500; // Keep consistent with usage/grant
        const amountDelta = qty * valuePerCredit;

        // Record refund transaction
        await CreditTransaction.create([
          {
            clientId,
            contractId: null,
            itemId: null,
            itemSnapshot: {
              name: meta.title || `${refType || 'booking'} cancellation refund`,
              unit: 'credits',
              pricingMode: 'credits',
              unitCredits: 1,
              taxable: false,
              gstRate: 0,
            },
            quantity: qty,
            transactionType: 'refund',
            pricingSnapshot: {
              pricingMode: 'credits',
              unitCredits: 1,
              creditValueINR: valuePerCredit,
            },
            creditsDelta: qty, // returning credits
            amountINRDelta: amountDelta,
            purpose: meta.reason || 'Cancellation refund',
            description: `Refunded ${qty} credits back to client wallet`,
            status: 'completed',
            createdBy: createdBy || memberId || clientId,
            relatedInvoiceId: meta.relatedInvoiceId || null,
            idempotencyKey: idempotencyKey || null,
            metadata: {
              bookingId: refId || null,
              customData: meta || {},
            },
          },
        ], { session });

        result = { success: true, refundedCredits: qty };
      });
      return result;
    } catch (error) {
      console.error("Error in reverseCredits:", error);
      throw new Error(error.message || "Failed to reverse credits");
    } finally {
      await session.endSession();
    }
  }

  // Adjust credits (admin only)
  static async adjustCredits({ clientId, credits, reason, approvedBy }) {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const wallet = await this.getOrCreateWallet(clientId);
        if (credits < 0 && wallet.balance + credits < 0) {
          throw new Error("Adjustment would result in negative balance");
        }

        // Update wallet
        await ClientCreditWallet.findByIdAndUpdate(
          wallet._id,
          { $inc: { balance: credits } },
          { session }
        );

        // Create transaction
        await CreditTransaction.create([{
          client: clientId,
          member: null,
          type: "adjust",
          credits: Math.abs(credits),
          valuePerCredit: 500,
          refType: "admin_adjustment",
          refId: new mongoose.Types.ObjectId(), // Generate a ref ID for the adjustment
          meta: { reason, approvedBy, adjustment: credits }
        }], { session });
      });

      return { success: true, message: "Credits adjusted successfully" };
    } catch (error) {
      console.error("Error in adjustCredits:", error);
      throw new Error(error.message || "Failed to adjust credits");
    } finally {
      await session.endSession();
    }
  }

  // Get wallet info
  static async getWalletInfo(clientId) {
    try {
      const wallet = await ClientCreditWallet.findOne({ client: clientId }).populate('client', 'name email');
      return wallet;
    } catch (error) {
      console.error("Error in getWalletInfo:", error);
      throw new Error("Failed to get wallet info");
    }
  }

  // Get transactions with pagination
  static async getTransactions(clientId, { type, member, page = 1, limit = 20 } = {}) {
    try {
      const query = { client: clientId };

      if (type) query.type = type;
      if (member) query.member = member;

      const skip = (page - 1) * limit;

      const transactions = await CreditTransaction.find(query)
        .populate('member', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await CreditTransaction.countDocuments(query);

      return {
        transactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error("Error in getTransactions:", error);
      throw new Error("Failed to get transactions");
    }
  }
}

export default WalletService;
