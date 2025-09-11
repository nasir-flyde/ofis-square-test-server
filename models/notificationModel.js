import mongoose from "mongoose";

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    member: { type: Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    type: { 
      type: String, 
      enum: ["ticket_update", "booking_update", "general", "desk_assignment", "payment_due"], 
      default: "general",
      index: true 
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
    entityId: { type: Schema.Types.ObjectId }, // Reference to related entity (ticket, booking, etc.)
    entityType: { type: String, enum: ["ticket", "booking", "invoice", "contract"] },
    metadata: { type: Schema.Types.Mixed }, // Additional data if needed
  },
  { timestamps: true, collection: "notifications" }
);

// Compound indexes for efficient queries
notificationSchema.index({ member: 1, client: 1, createdAt: -1 });
notificationSchema.index({ member: 1, read: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
