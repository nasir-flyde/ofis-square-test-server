import mongoose from "mongoose";

const creditTransactionSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: true,
    index: true
  },
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Member", // Assuming you have a Member model
    default: null // null for grants/adjustments by admin
  },
  type: {
    type: String,
    enum: ["grant", "consume", "adjust", "refund", "expire"],
    required: true
  },
  credits: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: "Credits must be a positive integer"
    }
  },
  valuePerCredit: {
    type: Number,
    required: true,
    min: 0 // Freeze the INR value per credit at transaction time
  },
  refType: {
    type: String,
    enum: ["contract", "meeting_booking", "admin_adjustment", "purchase", "refund", "expiry"],
    required: true
  },
  refId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true // ID of related entity (contract, booking, etc.)
  },
  idempotencyKey: {
    type: String,
    default: null,
    sparse: true // Allow multiple null values
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {} // Additional context: reason, room, hours, rate, notes
  }
}, {
  timestamps: true
});

// Indexes
creditTransactionSchema.index({ client: 1 });
creditTransactionSchema.index({ member: 1 });
creditTransactionSchema.index({ type: 1 });
creditTransactionSchema.index({ refType: 1, refId: 1 });
creditTransactionSchema.index({ createdAt: -1 });

// Unique compound index for idempotency (when key is provided)
creditTransactionSchema.index(
  { client: 1, idempotencyKey: 1 }, 
  { 
    unique: true, 
    sparse: true,
    partialFilterExpression: { idempotencyKey: { $ne: null } }
  }
);

const CreditTransaction = mongoose.model("CreditTransaction", creditTransactionSchema);

export default CreditTransaction;
