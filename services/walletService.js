import mongoose from "mongoose";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";

class WalletService {
  
  // Get or create wallet for a client
  static async getOrCreateWallet(clientId) {
    try {
      let wallet = await ClientCreditWallet.findOne({ client: clientId });
      
      if (!wallet) {
        wallet = await ClientCreditWallet.create({
          client: clientId,
          balance: 0,
          creditValue: process.env.DEFAULT_CREDIT_VALUE || 200,
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
  static async grantCredits({ clientId, credits, valuePerCredit, refType, refId, meta = {} }) {
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Get or create wallet
        const wallet = await this.getOrCreateWallet(clientId);
        
        // Use wallet's creditValue if not provided
        const finalValuePerCredit = valuePerCredit || wallet.creditValue;
        
        // Update wallet balance
        await ClientCreditWallet.findByIdAndUpdate(
          wallet._id,
          { $inc: { balance: credits } },
          { session }
        );
        
        // Create transaction record
        await CreditTransaction.create([{
          client: clientId,
          member: null, // Grants are typically admin actions
          type: "grant",
          credits,
          valuePerCredit: finalValuePerCredit,
          refType,
          refId,
          meta
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
            client: clientId,
            member: memberId,
            type: "consume",
            credits: coveredCredits,
            valuePerCredit: wallet.creditValue,
            refType,
            refId,
            idempotencyKey,
            meta: { ...meta, overdraft: false }
          }], { session });
        }
        
        // Create transaction for extra credits (overdraft)
        if (extraCredits > 0) {
          await CreditTransaction.create([{
            client: clientId,
            member: memberId,
            type: "consume",
            credits: extraCredits,
            valuePerCredit: wallet.creditValue,
            refType,
            refId,
            idempotencyKey: idempotencyKey ? `${idempotencyKey}_overdraft` : null,
            meta: { ...meta, overdraft: true }
          }], { session });
        }
        
        result = {
          success: true,
          coveredCredits,
          extraCredits,
          overageAmount,
          valuePerCredit: wallet.creditValue
        };
      });
      
      return result;
    } catch (error) {
      console.error("Error in consumeCreditsWithOverdraft:", error);
      throw new Error(error.message || "Failed to consume credits");
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
        
        // Prevent negative balance
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
          valuePerCredit: wallet.creditValue,
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
