import mongoose from "mongoose";

const printerRequestSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: true,
    index: true
  },
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Member",
    index: true
  },
  documentUrl: {
    type: String,
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  buildingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Building",
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ["pending", "preparing", "ready", "completed", "cancelled"],
    default: "pending",
    index: true
  },
  creditsToDeduct: {
    type: Number,
    default: 0
  },
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CreditTransaction"
  },
  readyAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

const PrinterRequest = mongoose.model("PrinterRequest", printerRequestSchema);

export default PrinterRequest;
