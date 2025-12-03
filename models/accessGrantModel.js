import mongoose from "mongoose";

const AccessGrantSchema = new mongoose.Schema(
  {
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: "AccessPolicy", required: true, index: true },

    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED", "PENDING"],
      default: "PENDING",
      index: true,
    },

    source: {
      type: String,
      enum: ["AUTO_CONTRACT", "AUTO_INVOICE", "ADMIN_MANUAL"],
      required: true,
      index: true,
    },

    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date },

    // QR-based access
    qrCodeToken: { type: String }, // plaintext optional (avoid in prod)
    qrCodeTokenHash: { type: String, index: true },
    qrCodeExpiresAt: { type: Date, index: true },
    // If set, QR token is valid only for this access point (e.g., "CABIN:<id>")
    qrBoundAccessPointId: { type: String },

    notes: { type: String },
    // If true, skip invoice-based enforcement for this grant when creating/resuming
    bypassInvoices: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "access_grants" }
);

// Helpful indexes
AccessGrantSchema.index({ memberId: 1, policyId: 1, status: 1 });
AccessGrantSchema.index({ clientId: 1, status: 1 });

// Guard: prevent multiple ACTIVE grants for same member+policy overlapping time
AccessGrantSchema.pre("save", async function (next) {
  try {
    if (this.isModified("status") || this.isNew) {
      if (this.status === "ACTIVE") {
        const overlap = await mongoose.model("AccessGrant").findOne({
          _id: { $ne: this._id },
          memberId: this.memberId,
          policyId: this.policyId,
          status: "ACTIVE",
          // Overlap in validity window (if endsAt missing, treat as open ended)
          $or: [
            { endsAt: { $exists: false } },
            { endsAt: { $gt: this.startsAt || new Date(0) } },
          ],
        }).lean();
        if (overlap) {
          const err = new Error("An ACTIVE access grant already exists for this member and policy");
          err.code = "DUPLICATE_ACTIVE_GRANT";
          return next(err);
        }
      }
    }
    return next();
  } catch (e) {
    return next(e);
  }
});

export default mongoose.model("AccessGrant", AccessGrantSchema);
