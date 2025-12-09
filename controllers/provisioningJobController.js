import ProvisioningJob from "../models/provisioningJobModel.js";

export const listProvisioningJobs = async (req, res) => {
  try {
    const { vendor, status, jobType, memberId, cardId, accessPointId, deviceId, from, to, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (vendor) filter.vendor = vendor;
    if (status) filter.status = status;
    if (jobType) filter.jobType = jobType;
    if (memberId) filter.memberId = memberId;
    if (cardId) filter.cardId = cardId;
    if (accessPointId) filter.accessPointId = accessPointId;
    if (deviceId) filter.deviceId = deviceId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ProvisioningJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      ProvisioningJob.countDocuments(filter),
    ]);

    return res.json({ success: true, data: items, pagination: { currentPage: Number(page)||1, totalPages: Math.ceil(total/Number(limit||1)), totalRecords: total, hasMore: skip + Number(limit) < total } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to list jobs", error: err?.message });
  }
};

export const retryProvisioningJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await ProvisioningJob.findById(id);
    if (!job) return res.status(404).json({ success: false, message: "Not found" });

    job.status = "RETRY";
    job.scheduledFor = new Date(Date.now() + 5 * 1000); // re-schedule after 5s
    await job.save();

    return res.json({ success: true, data: job });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to retry job", error: err?.message });
  }
};
