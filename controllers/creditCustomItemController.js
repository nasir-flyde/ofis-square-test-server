import CreditCustomItem from "../models/creditCustomItemModel.js";
import { syncCreditCustomItemToZoho, getZohoItems, findZohoItemByName } from "../utils/zohoBooks.js";
import apiLogger from "../utils/apiLogger.js";

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
    
    // Sync to Zoho Books (async, don't block response)
    syncCreditCustomItemToZoho(item).catch(error => {
      console.error("Failed to sync new item to Zoho Books:", error.message);
    });
    
    // API log: create custom item
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.create",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: req.body,
      statusCode: 201,
      responseBody: { id: item._id, zohoItemId: item.zohoItemId },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
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

    syncCreditCustomItemToZoho(item).catch(error => {
      console.error("Failed to sync updated item to Zoho Books:", error.message);
    });
    
    // API log: update custom item
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.update",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: req.body,
      statusCode: 200,
      responseBody: { id: item._id, zohoItemId: item.zohoItemId },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
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

    syncCreditCustomItemToZoho(item).catch(error => {
      console.error("Failed to sync item status to Zoho Books:", error.message);
    });
    
    // API log: toggle status
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.toggle_status",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: req.body,
      statusCode: 200,
      responseBody: { id: item._id, active: item.active },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
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

// POST /api/admin/credits/custom-items/:id/sync-to-zoho - Sync single item to Zoho Books
export const syncItemToZoho = async (req, res) => {
  try {
    const { id } = req.params;
    
    const item = await CreditCustomItem.findById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found"
      });
    }
    
    const zohoResponse = await syncCreditCustomItemToZoho(item);
    
    // API log: manual sync single item
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.sync_to_zoho",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: { id },
      statusCode: 200,
      responseBody: { id: item._id, zohoItemId: item.zohoItemId, zohoResponse: !!zohoResponse },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
    return res.json({
      success: true,
      message: "Item synced to Zoho Books successfully",
      data: {
        localItem: item,
        zohoResponse: zohoResponse
      }
    });
    
  } catch (error) {
    console.error("Error syncing item to Zoho:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// POST /api/admin/credits/custom-items/bulk-sync - Bulk sync items to Zoho Books
export const bulkSyncToZoho = async (req, res) => {
  try {
    const { itemIds, syncAll = false } = req.body;
    
    let items;
    if (syncAll) {
      items = await CreditCustomItem.find({ active: true });
    } else if (itemIds && Array.isArray(itemIds)) {
      items = await CreditCustomItem.find({ _id: { $in: itemIds } });
    } else {
      return res.status(400).json({
        success: false,
        message: "Either provide itemIds array or set syncAll to true"
      });
    }
    
    const results = {
      total: items.length,
      synced: 0,
      failed: 0,
      errors: []
    };
    
    for (const item of items) {
      try {
        await syncCreditCustomItemToZoho(item);
        results.synced++;
        console.log(`✅ Synced item: ${item.name}`);
      } catch (error) {
        results.failed++;
        results.errors.push({
          itemId: item._id,
          itemName: item.name,
          error: error.message
        });
        console.error(`❌ Failed to sync item ${item.name}:`, error.message);
      }
    }
    
    // API log: bulk sync
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.bulk_sync",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: req.body,
      statusCode: 200,
      responseBody: { summary: { total: results.total, synced: results.synced, failed: results.failed } },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
    return res.json({
      success: true,
      message: `Bulk sync completed. ${results.synced} synced, ${results.failed} failed.`,
      data: results
    });
    
  } catch (error) {
    console.error("Error in bulk sync:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// GET /api/admin/credits/custom-items/zoho-items - Get Zoho Books items
export const getZohoBooksItems = async (req, res) => {
  try {
    const zohoItems = await getZohoItems();
    
    // API log: list Zoho items
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.zoho_items_list",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: null,
      statusCode: 200,
      responseBody: { count: Array.isArray(zohoItems?.items) ? zohoItems.items.length : 0 },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
    return res.json({
      success: true,
      data: zohoItems
    });
    
  } catch (error) {
    console.error("Error fetching Zoho items:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// POST /api/admin/credits/custom-items/:id/link-zoho - Link existing Zoho item to local item
export const linkZohoItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { zohoItemId } = req.body;
    
    if (!zohoItemId) {
      return res.status(400).json({
        success: false,
        message: "zohoItemId is required"
      });
    }
    
    const item = await CreditCustomItem.findById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found"
      });
    }
    
    // Check if another item already has this Zoho ID
    const existingLink = await CreditCustomItem.findOne({ 
      zohoItemId, 
      _id: { $ne: id } 
    });
    
    if (existingLink) {
      return res.status(400).json({
        success: false,
        message: `Zoho item ${zohoItemId} is already linked to item: ${existingLink.name}`
      });
    }
    
    item.zohoItemId = zohoItemId;
    await item.save();
    
    // API log: link Zoho item
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.link_zoho",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: { id, zohoItemId },
      statusCode: 200,
      responseBody: { id: item._id, zohoItemId: item.zohoItemId },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
    return res.json({
      success: true,
      message: "Zoho item linked successfully",
      data: item
    });
    
  } catch (error) {
    console.error("Error linking Zoho item:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// DELETE /api/admin/credits/custom-items/:id/unlink-zoho - Unlink Zoho item
export const unlinkZohoItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    const item = await CreditCustomItem.findById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Custom item not found"
      });
    }
    
    const previousZohoId = item.zohoItemId;
    item.zohoItemId = undefined;
    await item.save();
    
    // API log: unlink Zoho item
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.unlink_zoho",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: { id },
      statusCode: 200,
      responseBody: { id: item._id, previousZohoId },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
    return res.json({
      success: true,
      message: "Zoho item unlinked successfully",
      data: {
        itemId: item._id,
        previousZohoId
      }
    });
    
  } catch (error) {
    console.error("Error unlinking Zoho item:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// GET /api/admin/credits/custom-items/sync-status - Get sync status overview
export const getSyncStatus = async (req, res) => {
  try {
    const totalItems = await CreditCustomItem.countDocuments();
    const syncedItems = await CreditCustomItem.countDocuments({ 
      zohoItemId: { $exists: true, $ne: null } 
    });
    const unsyncedItems = totalItems - syncedItems;
    const activeItems = await CreditCustomItem.countDocuments({ active: true });
    const activeSyncedItems = await CreditCustomItem.countDocuments({ 
      active: true,
      zohoItemId: { $exists: true, $ne: null } 
    });
    
    return res.json({
      success: true,
      data: {
        total: totalItems,
        synced: syncedItems,
        unsynced: unsyncedItems,
        active: activeItems,
        activeSynced: activeSyncedItems,
        syncPercentage: totalItems > 0 ? Math.round((syncedItems / totalItems) * 100) : 0
      }
    });
    
    // API log: sync status
    await apiLogger.logIncomingWebhook({
      service: "internal_api",
      operation: "credits.custom_items.sync_status",
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      requestBody: null,
      statusCode: 200,
      responseBody: { total: totalItems, synced: syncedItems, activeSynced: activeSyncedItems },
      success: true,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip
    });
    
  } catch (error) {
    console.error("Error getting sync status:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
