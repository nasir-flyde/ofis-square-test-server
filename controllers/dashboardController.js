import Invoice from "../models/invoiceModel.js";
import Payment from "../models/paymentModel.js";
import Lead from "../models/leadModel.js";
import Ticket from "../models/ticketModel.js";
import Visitor from "../models/visitorModel.js";

// Helpers to compute date ranges
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfYear(d = new Date()) {
  const x = new Date(d.getFullYear(), 0, 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function sumPaymentsBetween(start, end) {
  const match = {};
  if (start) match.paymentDate = { ...(match.paymentDate || {}), $gte: start };
  if (end) match.paymentDate = { ...(match.paymentDate || {}), $lte: end };

  const res = await Payment.aggregate([
    { $match: match },
    { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  return { amount: res[0]?.amount || 0, count: res[0]?.count || 0 };
}

async function getInvoicesCountsByStatus() {
  const res = await Invoice.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const out = {};
  for (const r of res) out[r._id || "unknown"] = r.count;
  return out;
}

async function getOutstandingAR() {
  // Consider invoices that are not paid/void/draft as outstanding
  const statuses = ["issued", "partially_paid", "overdue", "sent"]; // include sent as issued-like
  const match = { status: { $in: statuses } };
  const res = await Invoice.aggregate([
    { $match: match },
    { $group: { _id: null, amount: { $sum: "$balance" }, count: { $sum: 1 } } },
  ]);
  return { amount: res[0]?.amount || 0, count: res[0]?.count || 0 };
}

async function getOverdueAR() {
  const match = { status: "overdue" };
  const res = await Invoice.aggregate([
    { $match: match },
    { $group: { _id: null, amount: { $sum: "$balance" }, count: { $sum: 1 } } },
  ]);
  return { amount: res[0]?.amount || 0, count: res[0]?.count || 0 };
}

export const getDashboardSummary = async (req, res) => {
  try {
    const now = new Date();
    const sod = startOfDay(now);
    const som = startOfMonth(now);
    const soy = startOfYear(now);

    // Fetch metrics in parallel
    const [
      paymentsToday,
      paymentsMTD,
      paymentsYTD,
      invoicesByStatus,
      outstanding,
      overdue,
      recentPayments,
      overdueTop,
      // Leads
      leadsByStatusAgg,
      leadsTotal,
      leadsThisMonth,
      // Tickets
      ticketsByStatusAgg,
      ticketsTotal,
      // Visitors today
      visitorsTodayAgg,
    ] = await Promise.all([
      sumPaymentsBetween(sod, now),
      sumPaymentsBetween(som, now),
      sumPaymentsBetween(soy, now),
      getInvoicesCountsByStatus(),
      getOutstandingAR(),
      getOverdueAR(),
      Payment.find({})
        .sort({ paymentDate: -1, createdAt: -1 })
        .limit(5)
        .populate("client", "companyName contactPerson")
        .populate("invoice", "invoice_number total")
        .lean(),
      Invoice.find({ status: "overdue" })
        .sort({ due_date: 1 })
        .limit(5)
        .select("invoice_number client total balance due_date status")
        .populate("client", "companyName contactPerson")
        .lean(),
      // Leads stats
      Lead.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Lead.countDocuments({}),
      Lead.countDocuments({ createdAt: { $gte: som } }),
      // Tickets stats
      Ticket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Ticket.countDocuments({}),
      // Visitors today (by status)
      Visitor.aggregate([
        {
          $match: {
            expectedVisitDate: { $gte: sod, $lte: now },
          },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const leadsByStatus = {};
    for (const r of leadsByStatusAgg) leadsByStatus[r._id || "unknown"] = r.count;

    const ticketsByStatus = {};
    for (const r of ticketsByStatusAgg) ticketsByStatus[r._id || "unknown"] = r.count;

    const visitorsTodayByStatus = {};
    for (const r of visitorsTodayAgg) visitorsTodayByStatus[r._id || "unknown"] = r.count;

    const visitorsToday = {
      total: Object.values(visitorsTodayByStatus).reduce((a, b) => a + b, 0),
      checked_in: visitorsTodayByStatus["checked_in"] || 0,
      checked_out: visitorsTodayByStatus["checked_out"] || 0,
      pending: (visitorsTodayByStatus["invited"] || 0) + (visitorsTodayByStatus["pending_checkin"] || 0) + (visitorsTodayByStatus["approved"] || 0),
      no_show: visitorsTodayByStatus["no_show"] || 0,
      cancelled: visitorsTodayByStatus["cancelled"] || 0,
    };

    const data = {
      generatedAt: now.toISOString(),
      payments: {
        today: paymentsToday,
        mtd: paymentsMTD,
        ytd: paymentsYTD,
        recent: recentPayments?.map((p) => ({
          _id: p._id,
          amount: p.amount,
          paymentDate: p.paymentDate || p.createdAt,
          type: p.type,
          referenceNumber: p.referenceNumber,
          client: p.client ? { _id: p.client._id, name: p.client.companyName || p.client.contactPerson } : null,
          invoice: p.invoice ? { _id: p.invoice._id, number: p.invoice.invoice_number, total: p.invoice.total } : null,
        })) || [],
      },
      invoices: {
        countsByStatus: invoicesByStatus,
        outstanding,
        overdue,
        overdueTop: overdueTop?.map((i) => ({
          _id: i._id,
          invoice_number: i.invoice_number,
          total: i.total,
          balance: i.balance,
          due_date: i.due_date,
          status: i.status,
          client: i.client ? { _id: i.client._id, name: i.client.companyName || i.client.contactPerson } : null,
        })) || [],
      },
      leads: {
        total: leadsTotal,
        thisMonth: leadsThisMonth,
        byStatus: leadsByStatus,
      },
      tickets: {
        total: ticketsTotal,
        byStatus: ticketsByStatus,
        open: ticketsByStatus["open"] || 0,
        closed: ticketsByStatus["closed"] || 0,
      },
      visitors: {
        today: visitorsToday,
      },
    };

    return res.json({ success: true, data });
  } catch (error) {
    console.error("getDashboardSummary error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch dashboard data", error: error.message });
  }
};
