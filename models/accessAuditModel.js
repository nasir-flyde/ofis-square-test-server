import mongoose from "mongoose";

const AccessAuditSchema = new mongoose.Schema(
  {
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    accessGrantId: { type: mongoose.Schema.Types.ObjectId, ref: "AccessGrant", index: true },

    action: {
      type: String,
      enum: [
        "GRANT",
        "REVOKE",
        "SUSPEND",
        "RESUME",
        "EXTEND",
        "QR_GENERATED",
        "QR_CONSUMED",
        "QR_DENIED",
      ],
      required: true,
      index: true,
    },

    actorType: {
      type: String,
      enum: ["SYSTEM", "ADMIN", "SCANNER"],
      required: true,
      index: true,
    },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // nullable for SYSTEM/SCANNER

    reason: { type: String },
    meta: { type: Object }, // extra info (ip, deviceId, invoiceId, etc.)
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "access_audits" }
);

AccessAuditSchema.index({ accessGrantId: 1, createdAt: -1 });
AccessAuditSchema.index({ memberId: 1, createdAt: -1 });
AccessAuditSchema.index({ clientId: 1, createdAt: -1 });

export default mongoose.model("AccessAudit", AccessAuditSchema);
