import DiscountBundle from "../models/discountBundleModel.js";

// Create a new discount bundle
export const createDiscountBundle = async (req, res) => {
    try {
        const { name, description, building, bundles, isActive } = req.body;

        if (!name || !bundles || !Array.isArray(bundles) || bundles.length === 0) {
            return res.status(400).json({ error: "Name and bundles array are required" });
        }

        const discountBundle = new DiscountBundle({
            name,
            description,
            building: building || null,
            bundles,
            isActive: isActive !== undefined ? isActive : true
        });

        await discountBundle.save();

        res.status(201).json({
            message: "Discount bundle created successfully",
            discountBundle
        });
    } catch (error) {
        console.error("createDiscountBundle error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Get all discount bundles (with buildingId filter)
export const getAllDiscountBundles = async (req, res) => {
    try {
        const { buildingId, isActive } = req.query;
        const query = {};

        if (buildingId) {
            // Find bundles that are either specifically for this building or global (building: null)
            query.$or = [
                { building: buildingId },
                { building: null }
            ];
        }

        if (isActive !== undefined) {
            query.isActive = isActive === "true";
        }

        const discountBundles = await DiscountBundle.find(query)
            .populate("building", "name address")
            .sort({ createdAt: -1 });

        res.json({ discountBundles });
    } catch (error) {
        console.error("getAllDiscountBundles error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Get a single discount bundle by ID
export const getDiscountBundleById = async (req, res) => {
    try {
        const { id } = req.params;
        const discountBundle = await DiscountBundle.findById(id).populate("building", "name address");

        if (!discountBundle) {
            return res.status(404).json({ error: "Discount bundle not found" });
        }

        res.json({ discountBundle });
    } catch (error) {
        console.error("getDiscountBundleById error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Update a discount bundle
export const updateDiscountBundle = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, building, bundles, isActive } = req.body;

        const discountBundle = await DiscountBundle.findByIdAndUpdate(
            id,
            { name, description, building, bundles, isActive },
            { new: true, runValidators: true }
        );

        if (!discountBundle) {
            return res.status(404).json({ error: "Discount bundle not found" });
        }

        res.json({
            message: "Discount bundle updated successfully",
            discountBundle
        });
    } catch (error) {
        console.error("updateDiscountBundle error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Delete a discount bundle
export const deleteDiscountBundle = async (req, res) => {
    try {
        const { id } = req.params;
        const discountBundle = await DiscountBundle.findByIdAndDelete(id);

        if (!discountBundle) {
            return res.status(404).json({ error: "Discount bundle not found" });
        }

        res.json({ message: "Discount bundle deleted successfully" });
    } catch (error) {
        console.error("deleteDiscountBundle error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
