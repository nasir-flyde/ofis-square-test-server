import Contract from "../models/contractModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import Building from "../models/buildingModel.js";
import mongoose from "mongoose";

/**
 * Process daily credit renewals for all buildings that have their renewal date today
 */
export async function processDailyCreditRenewals() {
    try {
        const today = new Date();
        const dayOfMonth = today.getDate();

        console.log(`[CreditRenewal] Checking renewals for day ${dayOfMonth}...`);

        // Find buildings with this renewal date
        const buildings = await Building.find({ creditsRenewalDate: dayOfMonth });
        
        if (buildings.length === 0) {
            console.log(`[CreditRenewal] No buildings scheduled for renewal on day ${dayOfMonth}.`);
            return;
        }

        console.log(`[CreditRenewal] Found ${buildings.length} buildings for renewal.`);

        for (const building of buildings) {
            await renewCreditsForBuilding(building._id);
        }

    } catch (error) {
        console.error("[CreditRenewal] Error in processDailyCreditRenewals:", error);
    }
}

/**
 * Renew credits for all active contracts in a building
 * @param {string} buildingId 
 */
export async function renewCreditsForBuilding(buildingId) {
    try {
        const building = await Building.findById(buildingId);
        if (!building) {
            console.error(`[CreditRenewal] Building not found: ${buildingId}`);
            return;
        }

        console.log(`[CreditRenewal] Renewing credits for building: ${building.name} (${buildingId})`);

        const activeContracts = await Contract.find({
            building: buildingId,
            status: "active",
            credit_enabled: true
        });

        console.log(`[CreditRenewal] Found ${activeContracts.length} active credit-enabled contracts.`);

        for (const contract of activeContracts) {
            await renewContractCredits(contract, building);
        }

    } catch (error) {
        console.error(`[CreditRenewal] Error renewing credits for building ${buildingId}:`, error);
    }
}

/**
 * Renew credits for a single contract
 * @param {object} contract 
 * @param {object} building 
 */
async function renewContractCredits(contract, building) {
    try {
        const clientId = contract.client;
        const initialCredits = contract.initialCredits || 0;
        const printerCredits = contract.printerCredits || 0;

        if (initialCredits === 0 && printerCredits === 0) {
            return;
        }

        console.log(`[CreditRenewal] Renewing credits for contract ${contract._id} (Client: ${clientId}): Initial=${initialCredits}, Printer=${printerCredits}`);

        // Update Client Wallet
        const wallet = await ClientCreditWallet.findOneAndUpdate(
            { client: clientId },
            { 
                $inc: { 
                    balance: initialCredits,
                    printerBalance: printerCredits
                }
            },
            { upsert: true, new: true }
        );

        // Record Credit Transaction for initial credits if > 0
        if (initialCredits > 0) {
            await CreditTransaction.create({
                clientId,
                contractId: contract._id,
                itemSnapshot: {
                    name: "Monthly Credit Renewal",
                    unit: "credits",
                    pricingMode: "credits",
                    unitCredits: 1,
                    taxable: false,
                    gstRate: 0
                },
                quantity: initialCredits,
                transactionType: "grant",
                pricingSnapshot: {
                    pricingMode: "credits",
                    unitCredits: 1,
                    creditValueINR: building.creditValue || 500
                },
                creditsDelta: initialCredits,
                amountINRDelta: 0,
                purpose: "renewal",
                description: `Monthly renewal of ${initialCredits} initial credits`,
                status: "completed",
                createdBy: new mongoose.Types.ObjectId("000000000000000000000000") // System User
            });
        }

        // Record Printer Credit Transaction if > 0
        if (printerCredits > 0) {
             await CreditTransaction.create({
                clientId,
                contractId: contract._id,
                itemSnapshot: {
                    name: "Monthly Printer Credit Renewal",
                    unit: "credits",
                    pricingMode: "credits",
                    unitCredits: 1,
                    taxable: false,
                    gstRate: 0
                },
                quantity: printerCredits,
                transactionType: "grant",
                pricingSnapshot: {
                    pricingMode: "credits",
                    unitCredits: 1,
                    creditValueINR: building.printerCreditValue || 1
                },
                creditsDelta: printerCredits,
                amountINRDelta: 0,
                purpose: "renewal",
                description: `Monthly renewal of ${printerCredits} printer credits`,
                status: "completed",
                createdBy: new mongoose.Types.ObjectId("000000000000000000000000"), // System User
                metadata: {
                    customData: {
                        isPrinterCredit: true
                    }
                }
            });
        }

    } catch (error) {
        console.error(`[CreditRenewal] Error renewing contract ${contract._id}:`, error);
    }
}
