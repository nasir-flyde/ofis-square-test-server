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
    // Optional association to a client/company account
    client: { type: Schema.Types.ObjectId, ref: "Client", index: true },
  },
  { timestamps: true, collection: "members" }
);

memberSchema.index({ phone: 1 }, { sparse: true });

export default mongoose.model("Member", memberSchema);
