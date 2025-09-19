import CreditCustomItem from "../models/creditCustomItemModel.js";

// GET /api/admin/credits/custom-items - Get all custom items
export const getCustomItems = async (req, res) => {
  try {
    const { active, category, search } = req.query;
    
    const query = {};
    
    if (active !== undefined) {
      query.active = active === 'true';
    }
    
    if (category) {
      query.tags = category;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } }
      ];
    }
    
    const items = await CreditCustomItem.find(query).sort({ name: 1 });
    
    return res.json({
      success: true,
      data: items
    });
    
  } catch (error) {
    console.error("Error getting custom items:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const createCustomItem = async (req, res) => {
  try {
    const {
      name,
      code,
      unit,
      pricingMode,
      unitCredits,
      unitPriceINR,
      taxable,
      gstRate,
      zohoItemId,
      tags,
      metadata
    } = req.body;
    
    if (!name || !pricingMode) {
      return res.status(400).json({
        success: false,
        message: "Name and pricing mode are required"
      });
    }
    
    if (pricingMode === 'credits' && (!unitCredits || unitCredits <= 0)) {
      return res.status(400).json({
        success: false,
        message: "Unit credits must be positive when pricing mode is credits"
      });
    }
    
    if (pricingMode === 'inr' && (!unitPriceINR || unitPriceINR <= 0)) {
      return res.status(400).json({
        success: false,
        message: "Unit price INR must be positive when pricing mode is INR"
      });
    }
    
    const itemData = {
      name,
      unit: unit || 'unit',
      pricingMode,
      taxable: taxable !== false,
      gstRate: gstRate || 18,
      tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
      metadata: metadata || {}
    };
    
    if (code) itemData.code = code;
    if (pricingMode === 'credits') itemData.unitCredits = unitCredits;
    if (pricingMode === 'inr') itemData.unitPriceINR = unitPriceINR;
    if (zohoItemId) itemData.zohoItemId = zohoItemId;
    
    const item = await CreditCustomItem.create(itemData);
    
    return res.status(201).json({
      success: true,
      message: "Custom item created successfully",
      data: item
    });
    
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Item code already exists"
      });
    }
    
    console.error("Error creating custom item:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// PUT /api/admin/credits/custom-items/:id - Update custom item
export const updateCustomItem = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    
    const item = await CreditCustomItem.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found"
      });
    }
    
    return res.json({
      success: true,
      message: "Custom item updated successfully",
      data: item
    });
    
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Item code already exists"
      });
    }
    
    console.error("Error updating custom item:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// PATCH /api/admin/credits/custom-items/:id/activate - Toggle active status
export const toggleCustomItemStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;
    
    const item = await CreditCustomItem.findByIdAndUpdate(
      id,
      { active: active !== false },
      { new: true }
    );
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found"
      });
    }
    
    return res.json({
      success: true,
      message: `Custom item ${item.active ? 'activated' : 'deactivated'} successfully`,
      data: { id: item._id, active: item.active }
    });
    
  } catch (error) {
    console.error("Error toggling custom item status:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// DELETE /api/admin/credits/custom-items/:id - Delete custom item
export const deleteCustomItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    const item = await CreditCustomItem.findByIdAndDelete(id);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found"
      });
    }
    
    return res.json({
      success: true,
      message: "Custom item deleted successfully"
    });
    
  } catch (error) {
    console.error("Error deleting custom item:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// GET /api/admin/credits/custom-items/:id - Get single custom item
export const getCustomItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    const item = await CreditCustomItem.findById(id);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found"
      });
    }
    
    return res.json({
      success: true,
      data: item
    });
    
  } catch (error) {
    console.error("Error getting custom item:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
