import mongoose from "mongoose";

const { Schema } = mongoose;

const enrollmentSchema = new Schema(
  {
    deviceId: { type: Schema.Types.ObjectId, ref: "MatrixDevice", index: true },
    externalDeviceId: { type: String, trim: true },
    refId: { type: String, trim: true }, // Enrollment reference/id from Matrix (if provided)
    status: { type: String, enum: ["ENROLLED", "PENDING", "FAILED", "REVOKED"], default: "ENROLLED" },
    enrolledAt: { type: Date, default: Date.now },
    meta: { type: Schema.Types.Mixed },
    // enrollmentDetailId: { type: Schema.Types.ObjectId, ref: "EnrollmentDetail" },
  },
  { _id: false }
);

const accessHistorySchema = new Schema(
  {
    action: { type: String, enum: ["ACCESS_GRANTED", "ACCESS_REVOKED"], required: true },
    accessPointId: { type: Schema.Types.ObjectId, ref: "AccessPoint", index: true },
    policyId: { type: Schema.Types.ObjectId, ref: "AccessPolicy" },
    notes: { type: String, trim: true },
    performedBy: { type: Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const MatrixUserSchema = new Schema(
  {
    // Optional scoping
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", index: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", index: true },

    // Identity fields aligned with Matrix user creation API
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    externalUserId: { type: String, required: true, trim: true, unique: true, index: true }, // Matrix 'id'

    // Card references (RFID, mobile, etc.)
    cards: [{ type: Schema.Types.ObjectId, ref: "RFIDCard" }],

    // Enrollment information per Matrix device
    enrollments: { type: [enrollmentSchema], default: [] },

    // Credentials and validity
    isCardCredentialVerified: { type: Boolean, default: false },
    validTill: { type: Date, index: true },

    // Access history (grants and revocations), includes AccessPoint refs
    accessHistory: { type: [accessHistorySchema], default: [] },

    // Device assignment & enrollment status and policy linkage
    policyId: { type: Schema.Types.ObjectId, ref: "AccessPolicy", index: true },
    isDeviceAssigned: { type: Boolean, default: false },
    isEnrolled: { type: Boolean, default: false },

    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "matrix_users" }
);

MatrixUserSchema.index({ buildingId: 1, status: 1 });

export default mongoose.model("MatrixUser", MatrixUserSchema);
