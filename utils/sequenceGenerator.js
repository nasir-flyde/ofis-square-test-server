import Counter from "../models/counterModel.js";

/**
 * Generates a sequential ID with a given prefix.
 * Example: generateSequenceID("CLIENT") -> "CLIENT-1001"
 */
export async function generateSequenceID(prefix) {
  const counter = await Counter.findOneAndUpdate(
    { id: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${prefix}-${counter.seq}`;
}
