import mongoose from "mongoose";

const { Schema } = mongoose;

const bhaifiUserSchema = new Schema(
  {
    member: { type: Schema.Types.ObjectId, ref: "Member", index: true },
    client: { type: Schema.Types.ObjectId, ref: "Client", index: true }, // optional backref for convenience
    guest: { type: Schema.Types.ObjectId, ref: "Guest", index: true }, // optional backref when no member/client
    contract: { type: Schema.Types.ObjectId, ref: "Contract", index: true }, // optional linkage

    email: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    userName: { type: String, required: true, trim: true, unique: true }, // must start with 91

    idType: { type: Number, default: 1 },
    nasId: { type: String, default: process.env.BHAIFI_DEFAULT_NAS_ID || "test_39_1" },

    bhaifiUserId: { type: String }, // external id if returned by Bhaifi
    status: { type: String, enum: ["created", "active", "suspended", "dewhitelisted", "error"], default: "created", index: true },

    lastSyncAt: { type: Date },
    lastError: { type: String },
    meta: { type: Schema.Types.Mixed },

    // Whitelisting tracking
    lastWhitelistedAt: { type: Date },
    whitelistActiveUntil: { type: Date },
    whitelistHistory: [
      new Schema(
        {
          startDateString: { type: String }, // sent to provider (YYYY-MM-DD HH:mm:ss)
          endDateString: { type: String },
          startAt: { type: Date }, // parsed Date for convenience
          endAt: { type: Date },
          requestedBy: { type: Schema.Types.ObjectId, ref: "User" },
          source: { type: String, enum: ["manual", "auto_provision", "system"], default: "manual" },
          response: { type: Schema.Types.Mixed },
        },
        { _id: false, timestamps: { createdAt: true, updatedAt: false } }
      ),
    ],
    dewhitelistHistory: [
      new Schema(
        {
          reason: { type: String },
          requestedBy: { type: Schema.Types.ObjectId, ref: "User" },
          source: { type: String, enum: ["manual", "system"], default: "manual" },
        },
        { _id: false, timestamps: { createdAt: true, updatedAt: false } }
      ),
    ],
  },
  { timestamps: true, collection: "bhaifi_users" }
);

bhaifiUserSchema.index({ member: 1 }, { name: "ix_member" });
bhaifiUserSchema.index({ guest: 1 }, { name: "ix_guest" });
// Avoid duplicates for same member+userName
bhaifiUserSchema.index({ member: 1, userName: 1 }, { unique: true, sparse: true, name: "uq_member_userName" });
// Avoid duplicates for same guest+userName
bhaifiUserSchema.index({ guest: 1, userName: 1 }, { unique: true, sparse: true, name: "uq_guest_userName" });

export default mongoose.model("BhaifiUser", bhaifiUserSchema);
