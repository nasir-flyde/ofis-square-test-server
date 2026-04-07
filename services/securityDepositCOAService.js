import AppConfig from "../models/appConfigModel.js";
import Building from "../models/buildingModel.js";
import Client from "../models/clientModel.js";
import SecurityDeposit from "../models/securityDepositModel.js";
import fetch from "node-fetch";
import { getValidAccessToken } from "../utils/zohoTokenManager.js";
import {
  createZohoChartOfAccount,
  createZohoJournalEntry
} from "../utils/zohoBooks.js";

const BASE_URL = "https://www.zohoapis.in/books/v3";
const ORG_ID = process.env.ZOHO_BOOKS_ORG_ID;

/**
 * Returns true only if the given account_id actually exists in Zoho Books.
 * Used to detect and auto-clear stale IDs stored in MongoDB.
 */
async function zohoAccountExists(accountId) {
  if (!accountId) return false;
  try {
    const token = await getValidAccessToken();
    const res = await fetch(
      `${BASE_URL}/chartofaccounts/${accountId}?organization_id=${ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    const data = await res.json();
    return res.ok && data.code === 0;
  } catch {
    return false;
  }
}

/**
 * Ensures the 3-level Security Deposit COA hierarchy exists in Zoho Books.
 *
 * Level 1 (Global) — stored in AppConfig:
 *   zoho_sdparentcoa_id_receivable  (other_current_asset)
 *   zoho_sdparentcoa_id_payable     (other_current_liability)
 *
 * Level 2 (Building) — stored in Building.zohoChartsOfAccounts:
 *   zoho_sd_receivable_id
 *   zoho_sd_payable_id
 *
 * Level 3 (Client) — stored in Client:
 *   client_zoho_sd_receivable_id
 *   client_zoho_sd_payable_id
 *
 * Returns { receivable_id, payable_id } for the client level.
 */
export const ensureSecurityDepositHierarchy = async (buildingId, clientId) => {
  // -- Load documents --
  const config = await AppConfig.findOne();
  if (!config) throw new Error("AppConfig not found");

  const building = await Building.findById(buildingId);
  if (!building) throw new Error("Building not found");

  const client = await Client.findById(clientId);
  if (!client) throw new Error("Client not found");

  // ── Level 1: Global Parents ──────────────────────────────────────────────
  if (!config.zoho_sdparentcoa_id_receivable) {
    console.log("[SD COA] Creating Global SD Receivable parent...");
    const res = await createZohoChartOfAccount({
      account_name: "Security Deposits Receivable",
      account_type: "other_current_asset",
      description: "Global parent for all SD Receivables"
    });
    config.zoho_sdparentcoa_id_receivable = res.chartofaccount.account_id;
    await config.save();
  }

  if (!config.zoho_sdparentcoa_id_payable) {
    console.log("[SD COA] Creating Global SD Payable parent...");
    const res = await createZohoChartOfAccount({
      account_name: "Security Deposits Payable",
      account_type: "other_current_liability",
      description: "Global parent for all SD Payables"
    });
    config.zoho_sdparentcoa_id_payable = res.chartofaccount.account_id;
    await config.save();
  }

  // ── Level 2: Building Parents ────────────────────────────────────────────
  if (!building.zohoChartsOfAccounts?.zoho_sd_receivable_id) {
    console.log(`[SD COA] Creating Building SD Receivable for ${building.name}...`);
    const res = await createZohoChartOfAccount({
      account_name: `SD Receivable (${building.name})`.substring(0, 100),
      account_type: "other_current_asset",
      parent_account_id: config.zoho_sdparentcoa_id_receivable,
      description: `Security Deposit Receivable for ${building.name}`
    });
    // Normalized in zohoBooks.js already
    building.zohoChartsOfAccounts = {
      ...(building.zohoChartsOfAccounts || {}),
      zoho_sd_receivable_id: res.chartofaccount.account_id
    };
    await building.save();
  }

  if (!building.zohoChartsOfAccounts?.zoho_sd_payable_id) {
    console.log(`[SD COA] Creating Building SD Payable for ${building.name}...`);
    const res = await createZohoChartOfAccount({
      account_name: `SD Payable (${building.name})`.substring(0, 100),
      account_type: "other_current_liability",
      parent_account_id: config.zoho_sdparentcoa_id_payable,
      description: `Security Deposit Payable for ${building.name}`
    });
    building.zohoChartsOfAccounts = {
      ...(building.zohoChartsOfAccounts || {}),
      zoho_sd_payable_id: res.chartofaccount.account_id
    };
    await building.save();
  }

  // ── Level 3: Client Accounts ─────────────────────────────────────────────
  // Validate stored IDs against Zoho — auto-clear if stale
  const recValid = await zohoAccountExists(client.client_zoho_sd_receivable_id);
  if (!recValid) {
    if (client.client_zoho_sd_receivable_id) {
      console.warn(`[SD COA] Stale receivable ID ${client.client_zoho_sd_receivable_id} for ${client.companyName}. Recreating...`);
      client.client_zoho_sd_receivable_id = undefined;
    }
    console.log(`[SD COA] Creating Client SD Receivable for ${client.companyName}...`);
    const res = await createZohoChartOfAccount({
      account_name: `SD Receivable (${client.companyName})`.substring(0, 100),
      account_type: "other_current_asset",
      parent_account_id: building.zohoChartsOfAccounts.zoho_sd_receivable_id,
      description: `Security Deposit Receivable for ${client.companyName}`
    });
    client.client_zoho_sd_receivable_id = res.chartofaccount.account_id;
    await client.save();
  }

  const payValid = await zohoAccountExists(client.client_zoho_sd_payable_id);
  if (!payValid) {
    if (client.client_zoho_sd_payable_id) {
      console.warn(`[SD COA] Stale payable ID ${client.client_zoho_sd_payable_id} for ${client.companyName}. Recreating...`);
      client.client_zoho_sd_payable_id = undefined;
    }
    console.log(`[SD COA] Creating Client SD Payable for ${client.companyName}...`);
    const res = await createZohoChartOfAccount({
      account_name: `SD Payable (${client.companyName})`.substring(0, 100),
      account_type: "other_current_liability",
      parent_account_id: building.zohoChartsOfAccounts.zoho_sd_payable_id,
      description: `Security Deposit Payable for ${client.companyName}`
    });
    client.client_zoho_sd_payable_id = res.chartofaccount.account_id;
    await client.save();
  }

  return {
    receivable_id: client.client_zoho_sd_receivable_id,
    payable_id: client.client_zoho_sd_payable_id
  };
};

/**
 * Step 1 – Agreement Recognition Journal
 *
 * Records the full SD liability when the deposit is "Marked Due".
 * Only runs ONCE per deposit (guarded by is_zoho_recognition_done).
 *
 * Debit  : Client SD Receivable  (other_current_asset)
 * Credit : Client SD Payable     (Client Level)
 * Amount : deposit.agreed_amount
 */
export const recordSDAgreementJournal = async (depositId, approvedBy = "System") => {
  console.log(`➡️ [SD Agreement] Starting for deposit ${depositId}`);

  const deposit = await SecurityDeposit.findById(depositId)
    .populate("client")
    .populate("contract")
    .populate("building");
  if (!deposit) throw new Error("Deposit not found");

  if (deposit.is_zoho_recognition_done) {
    console.log(`⏭️ [SD Agreement] Already recorded. Skipping.`);
    return { journal_id: deposit.zoho_agreement_journal_id };
  }

  const client = deposit.client;
  const building = deposit.building;
  const contract = deposit.contract;

  // Ensure hierarchy exists and IDs are fresh
  const { receivable_id, payable_id } = await ensureSecurityDepositHierarchy(
    building._id,
    client._id
  );

  const amount = Number(deposit.agreed_amount);
  const contactId = client.zohoBooksContactId || undefined;

  // Format notes as requested:
  // Client Id - CLIENT123
  // Contract Id - CONTRACT123
  // Approved by - Nasir
  const journalNotes = [
    `Client Id - ${client.clientID || "N/A"}`,
    `Contract Id - ${contract?.contractID || "N/A"}`,
    `Approved by - ${approvedBy}`
  ].join("\n");

  const journalPayload = {
    journal_date: new Date().toISOString().split("T")[0],
    reference_number: `SD-AGR-${deposit._id}`,
    notes: journalNotes,
    line_items: [
      {
        account_id: receivable_id,
        debit_or_credit: "debit",
        amount,
        description: "SD Receivable Recognition",
        ...(contactId && { customer_id: contactId })
      },
      {
        account_id: payable_id,
        debit_or_credit: "credit",
        amount,
        description: "SD Liability Recognition",
        ...(contactId && { customer_id: contactId })
      }
    ]
  };

  console.log(`➡️ [SD Agreement] Payload:`, JSON.stringify(journalPayload, null, 2));
  const res = await createZohoJournalEntry(journalPayload);
  const journal = res.journal;
  console.log(`✅ [SD Agreement] Created Journal ${journal.journal_id}`);

  // Persist Zoho journal info and sync amount_due
  deposit.is_zoho_recognition_done = true;
  deposit.zoho_agreement_journal_id = journal.journal_id;
  deposit.zoho_agreement_journal_number = journal.entry_number;
  if (!(deposit.amount_due > 0)) deposit.amount_due = amount;
  await deposit.save();

  return journal;
};

/**
 * Step 2 – Payment Receipt Journal
 *
 * Records actual cash inflow when the client pays.
 * Auto-triggers Step 1 if not already done.
 *
 * Debit  : Building Bank Account  (bank)   ← uses journal_type:"both"
 * Credit : Client SD Receivable   (other_current_asset)
 * Amount : amountPaid
 */
export const recordSDPaymentJournal = async (depositId, amountPaid, paymentRef, approvedBy = "System") => {
  console.log(`➡️ [SD Payment] Starting for deposit ${depositId}, amount ${amountPaid}`);

  const deposit = await SecurityDeposit.findById(depositId)
    .populate("client")
    .populate("contract")
    .populate("building");
  if (!deposit) throw new Error("Deposit not found");

  const client = deposit.client;
  const building = deposit.building;
  const contract = deposit.contract;

  // ── Auto-trigger Step 1 if not done ──────────────────────────────────────
  if (!deposit.is_zoho_recognition_done) {
    console.log(`➡️ [SD Payment] Recognition missing. Auto-triggering Agreement Journal...`);
    await recordSDAgreementJournal(depositId, approvedBy);
    // Reload fresh client with possibly new COA IDs
    const freshClient = await Client.findById(client._id);
    client.client_zoho_sd_receivable_id = freshClient.client_zoho_sd_receivable_id;
    client.client_zoho_sd_payable_id = freshClient.client_zoho_sd_payable_id;
    client.clientID = freshClient.clientID;
  }

  // Ensure client receivable ID is available
  if (!client.client_zoho_sd_receivable_id) {
    const { receivable_id } = await ensureSecurityDepositHierarchy(building._id, client._id);
    client.client_zoho_sd_receivable_id = receivable_id;
  }

  // ── Resolve Building Bank Account ─────────────────────────────────────────
  const bankAccountId = building.zohoChartsOfAccounts?.bank_account_id;
  if (!bankAccountId) {
    throw new Error(
      `Building "${building.name}" has no Zoho Bank Account configured in zohoChartsOfAccounts.bank_account_id`
    );
  }

  const receivableId = client.client_zoho_sd_receivable_id;
  const contactId = client.zohoBooksContactId || undefined;

  // Format notes as requested
  const journalNotes = [
    `Client Id - ${client.clientID || "N/A"}`,
    `Contract Id - ${contract?.contractID || "N/A"}`,
    `Approved by - ${approvedBy}`
  ].join("\n");

  // journal_type: "both" is required for Zoho to allow Bank accounts in manual journals
  const journalPayload = {
    journal_date: new Date().toISOString().split("T")[0],
    reference_number: paymentRef || `SD-PAY-${deposit._id}`,
    notes: journalNotes,
    journal_type: "both",
    line_items: [
      {
        account_id: bankAccountId,
        debit_or_credit: "debit",
        amount: Number(amountPaid),
        description: "SD Cash Receipt (Bank)",
        ...(contactId && { customer_id: contactId })
      },
      {
        account_id: receivableId,
        debit_or_credit: "credit",
        amount: Number(amountPaid),
        description: "SD Receivable Cleared",
        ...(contactId && { customer_id: contactId })
      }
    ]
  };

  console.log(`➡️ [SD Payment] Payload:`, JSON.stringify(journalPayload, null, 2));
  const res = await createZohoJournalEntry(journalPayload);
  const journal = res.journal;
  console.log(`✅ [SD Payment] Created Journal ${journal.journal_id}`);

  return journal;
};
