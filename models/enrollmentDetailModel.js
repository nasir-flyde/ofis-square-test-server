import mongoose from "mongoose";

const { Schema } = mongoose;

const EnrollSubSchema = new Schema(
  {
    enrollType: { type: String, enum: ["card", "finger", "face", "unknown"], default: "card" },
    enrollCount: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

const EnrollmentDetailSchema = new Schema(
  {
    enroll: { type: EnrollSubSchema, required: true, default: () => ({}) },
  },
  { timestamps: true, collection: "enrollment_details" }
);

export default mongoose.model("EnrollmentDetail", EnrollmentDetailSchema);