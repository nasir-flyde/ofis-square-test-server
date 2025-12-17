import mongoose from "mongoose";

const { Schema } = mongoose;

const memberSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, index: { unique: true, sparse: true } },
    phone: { type: String, trim: true },
    companyName: { type: String, trim: true },
    role: { type: String, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    client: { type: Schema.Types.ObjectId, ref: "Client", index: true },
    desk: { type: Schema.Types.ObjectId, ref: "Desk", default: null, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    allowedUsingCredits: { type: Boolean, default: true, index: true },
    // Provider integrations (primary refs and denormalized identifiers)
    matrixUser: { type: Schema.Types.ObjectId, ref: "MatrixUser", default: null, index: true },
    matrixExternalUserId: { type: String, trim: true },
    bhaifiUser: { type: Schema.Types.ObjectId, ref: "BhaifiUser", default: null, index: true },
    bhaifiUserName: { type: String, trim: true },
  },
  { timestamps: true, collection: "members" }
);

memberSchema.index({ phone: 1 }, { sparse: true });
// Quick lookup indexes for denormalized provider identifiers
memberSchema.index({ matrixExternalUserId: 1 }, { sparse: true });
memberSchema.index({ bhaifiUserName: 1 }, { sparse: true });

export default mongoose.model("Member", memberSchema);