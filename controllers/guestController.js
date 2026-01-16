import Guest from "../models/guestModel.js";

// GET /api/guests
// Query: q (search), page, limit, sortBy (createdAt:desc default)
export const listGuests = async (req, res) => {
  try {
    const {
      q = "",
      page = 1,
      limit = 20,
      sortBy = "createdAt:desc",
    } = req.query || {};

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    let sort = { createdAt: -1 };
    if (typeof sortBy === "string" && sortBy.includes(":")) {
      const [field, dir] = sortBy.split(":");
      sort = { [field]: dir === "asc" ? 1 : -1 };
    }

    const filter = {};
    const query = String(q || "").trim();
    if (query) {
      const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { name: rx },
        { email: rx },
        { phone: rx },
        { companyName: rx },
      ];
    }

    const [guests, total] = await Promise.all([
      Guest.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Guest.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        guests,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasMore: skip + guests.length < total,
        },
      },
    });
  } catch (error) {
    console.error("listGuests error:", error);
    return res.status(500).json({ success: false, message: error?.message || "Internal Server Error" });
  }
};

// GET /api/guests/:id
export const getGuestById = async (req, res) => {
  try {
    const { id } = req.params;
    const guest = await Guest.findById(id).lean();
    if (!guest) return res.status(404).json({ success: false, message: "Guest not found" });
    return res.json({ success: true, data: { guest } });
  } catch (error) {
    console.error("getGuestById error:", error);
    return res.status(500).json({ success: false, message: error?.message || "Internal Server Error" });
  }
};
