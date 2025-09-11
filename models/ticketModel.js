import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    ticketId: { type: String, unique: true },
    description: { type: String, required: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "low" },
    category: {
      categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "TicketCategory" },
      subCategory: { type: String },
    },
    status: { type: String, enum: ["open", "inprogress", "resolved", "closed", "pending"], default: "open" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building" },
    cabin: { type: mongoose.Schema.Types.ObjectId, ref: "Cabin" },
    latestUpdate: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Member" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    images: { type: [String], default: [] },
  },
  { timestamps: true, collection: "tickets" }
);

// Generate a unique ticket ID like TKT-YYMM-0001 (resets monthly)
const generateTicketId = async () => {
  const prefix = "TKT";
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const yearMonth = `${year}${month}`;

  const existingTicket = await mongoose
    .model("Ticket")
    .findOne({ ticketId: { $regex: `^${prefix}-${yearMonth}-` } })
    .sort({ ticketId: -1 })
    .lean();

  let sequentialNum = 1;
  if (existingTicket && existingTicket.ticketId) {
    const lastNum = existingTicket.ticketId.split("-")[2];
    sequentialNum = parseInt(lastNum, 10) + 1;
  }

  const sequentialNumStr = String(sequentialNum).padStart(4, "0");
  return `${prefix}-${yearMonth}-${sequentialNumStr}`;
};

// Pre-save middleware to generate ticketId if not provided
ticketSchema.pre("save", async function (next) {
  if (!this.ticketId) {
    try {
      this.ticketId = await generateTicketId();
    } catch (err) {
      return next(err);
    }
  }
  next();
});

export default mongoose.model("Ticket", ticketSchema);
