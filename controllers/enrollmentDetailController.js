import EnrollmentDetail from "../models/enrollmentDetailModel.js";

export const listEnrollmentDetails = async (req, res) => {
  try {
    const { q, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (q) {
      // search by enroll.enrollType
      filter["enroll.enrollType"] = { $regex: q, $options: "i" };
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      EnrollmentDetail.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      EnrollmentDetail.countDocuments(filter),
    ]);
    return res.json({ success: true, data: items, pagination: { currentPage: Number(page)||1, totalPages: Math.ceil(total/Number(limit||1)), totalRecords: total } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list enrollment details' });
  }
};

export default { listEnrollmentDetails };
