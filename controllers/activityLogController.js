import ActivityLog from "../models/activityLogModel.js";
import mongoose from "mongoose";

// Get all activity logs with filtering and pagination
const getAllActivityLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      userId,
      userRole,
      action,
      entity,
      entityId,
      status,
      startDate,
      endDate,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      category,
      parkingType
    } = req.query;

    // Build filter object
    const filter = {};

    if (userId) filter.userId = userId;
    if (userRole) filter.userRole = new RegExp(userRole, 'i');
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (category) filter['metadata.category'] = category;
    if (parkingType) filter['metadata.parkingType'] = parkingType;
    if (entityId) filter.entityId = entityId;
    if (status) filter.status = status;
    if (category) filter['metadata.category'] = category;
    if (parkingType) filter['metadata.parkingType'] = parkingType;

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Search across multiple fields
    if (search) {
      filter.$or = [
        { userName: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { entity: new RegExp(search, 'i') },
        { action: new RegExp(search, 'i') },
        { userEmail: new RegExp(search, 'i') }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const [logs, totalCount] = await Promise.all([
      ActivityLog.find(filter)
        .populate('userId', 'name email')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ActivityLog.countDocuments(filter)
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / parseInt(limit));
    const hasMore = page < totalPages;

    res.json({
      success: true,
      data: logs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: totalCount,
        hasMore,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity logs',
      error: error.message
    });
  }
};

// Get activity log by ID
const getActivityLogById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity log ID'
      });
    }

    const log = await ActivityLog.findById(id)
      .populate('userId', 'name email')
      .lean();

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Activity log not found'
      });
    }

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('Error fetching activity log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity log',
      error: error.message
    });
  }
};

// Get activity logs for a specific user
const getUserActivityLogs = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 20,
      action,
      entity,
      startDate,
      endDate
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const filter = { userId };
    if (action) filter.action = action;
    if (entity) filter.entity = entity;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, totalCount] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ActivityLog.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: logs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: totalCount,
        hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching user activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user activity logs',
      error: error.message
    });
  }
};

// Get activity logs for a specific entity
const getEntityActivityLogs = async (req, res) => {
  try {
    const { entity, entityId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(entityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid entity ID'
      });
    }

    const filter = { entity, entityId };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, totalCount] = await Promise.all([
      ActivityLog.find(filter)
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ActivityLog.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: logs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: totalCount,
        hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching entity activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch entity activity logs',
      error: error.message
    });
  }
};

// Get activity statistics
const getActivityStats = async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get overall stats
    const [
      totalLogs,
      actionStats,
      entityStats,
      userRoleStats,
      statusStats
    ] = await Promise.all([
      ActivityLog.countDocuments(dateFilter),
      ActivityLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$entity', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$userRole', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);

    // Get time-based stats
    let dateGrouping;
    switch (groupBy) {
      case 'hour':
        dateGrouping = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
          hour: { $hour: '$createdAt' }
        };
        break;
      case 'day':
        dateGrouping = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
        break;
      case 'month':
        dateGrouping = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
      default:
        dateGrouping = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
    }

    const timeStats = await ActivityLog.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: dateGrouping,
          count: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        totalLogs,
        actionStats,
        entityStats,
        userRoleStats,
        statusStats,
        timeStats
      }
    });
  } catch (error) {
    console.error('Error fetching activity stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity statistics',
      error: error.message
    });
  }
};

// Export activity logs to CSV
const exportActivityLogs = async (req, res) => {
  try {
    const {
      userId,
      userRole,
      action,
      entity,
      category,
      parkingType,
      startDate,
      endDate,
      format = 'csv'
    } = req.query;

    // Build filter (same as getAllActivityLogs)
    const filter = {};
    if (userId) filter.userId = userId;
    if (userRole) filter.userRole = new RegExp(userRole, 'i');
    if (action) filter.action = action;
    if (entity) filter.entity = entity;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const logs = await ActivityLog.find(filter)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    if (format === 'csv') {
      // Generate CSV
      const csvHeaders = [
        'Timestamp',
        'User Name',
        'User Role',
        'Action',
        'Entity',
        'Description',
        'Status',
        'IP Address',
        'Endpoint'
      ];

      const csvRows = logs.map(log => [
        log.createdAt.toISOString(),
        log.userName,
        log.userRole,
        log.action,
        log.entity,
        log.description,
        log.status,
        log.ipAddress || '',
        log.endpoint || ''
      ]);

      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.csv"');
      res.send(csvContent);
    } else {
      // Return JSON
      res.json({
        success: true,
        data: logs,
        count: logs.length
      });
    }
  } catch (error) {
    console.error('Error exporting activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export activity logs',
      error: error.message
    });
  }
};

// Delete old activity logs (cleanup)
const cleanupActivityLogs = async (req, res) => {
  try {
    const { olderThanDays = 365 } = req.body;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(olderThanDays));

    const result = await ActivityLog.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} activity logs older than ${olderThanDays} days`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup activity logs',
      error: error.message
    });
  }
};

// Manual activity log creation (for testing/manual entries and portal auto-logs)
const createActivityLog = async (req, res) => {
  try {
    // Helper: normalize action to schema enum
    const normalizeAction = (action = '') => {
      const upper = (action || '').toUpperCase();
      const allowed = new Set([
        'CREATE','READ','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT','IMPORT','SEND_EMAIL','SEND_SMS','PAYMENT_CREATED','PAYMENT_PROCESSED','CONTRACT_SIGNED','INVOICE_GENERATED','BOOKING_CREATED','BOOKING_CANCELLED','CHECK_IN','CHECK_OUT','BULK_OPERATION','CUSTOM'
      ]);
      if (allowed.has(upper)) return upper;
      // Map common aliases
      const map = {
        'DOWNLOAD': 'EXPORT',
        'UPLOAD': 'IMPORT',
        'TICKET_CREATED': 'CREATE',
        'PAYMENT_SUCCESS': 'PAYMENT_PROCESSED',
        'PAYMENT_FAILED': 'PAYMENT_CREATED',
      };
      if (map[upper]) return map[upper];
      // Generic mapping by verb
      if (upper.includes('CREATE')) return 'CREATE';
      if (upper.includes('UPDATE') || upper.includes('EDIT')) return 'UPDATE';
      if (upper.includes('DELETE') || upper.includes('REMOVE')) return 'DELETE';
      if (upper.includes('LOGIN')) return 'LOGIN';
      if (upper.includes('LOGOUT')) return 'LOGOUT';
      return 'CUSTOM';
    };

    // Helper: normalize status
    const normalizeStatus = (status = '') => {
      const s = (status || '').toString().toUpperCase();
      if (['SUCCESS','FAILED','PARTIAL'].includes(s)) return s;
      if (['OK','TRUE'].includes(s)) return 'SUCCESS';
      if (['ERROR','FAIL','FAILED'].includes(s)) return 'FAILED';
      if (['PARTLY','PARTIAL_SUCCESS'].includes(s)) return 'PARTIAL';
      return 'SUCCESS';
    };

    // Derive actor info
    let actor = {
      userId: undefined,
      userName: undefined,
      userRole: undefined,
      userEmail: undefined,
    };
    if (req.user) {
      actor.userId = req.user._id;
      actor.userName = req.user.name || req.user.fullName || req.user.email || 'User';
      actor.userRole = (req.user.roleName || 'USER').toString();
      actor.userEmail = req.user.email;
    } else if (req.client) {
      actor.userName = req.client.companyName || req.client.contactPerson || 'Client';
      actor.userRole = 'CLIENT';
      actor.userEmail = req.client.email;
    }

    // Build normalized payload
    const body = req.body || {};
    const effectiveMethod = (body.requestMethod || req.method || '').toUpperCase();
    let effectiveAction = body.action;
    // Coerce GET requests to READ regardless of provided action
    if (effectiveMethod === 'GET') {
      effectiveAction = 'READ';
    }
    const normalized = {
      isSystemGenerated: false,
      action: normalizeAction(effectiveAction),
      status: normalizeStatus(body.status || (body.errorMessage ? 'FAILED' : 'SUCCESS')),
      entity: body.entity,
      entityId: body.entityId,
      description: body.description || `${actor.userRole || 'SYSTEM'} performed ${normalizeAction(effectiveAction).toLowerCase()} on ${body.entity || 'system'}`,
      ipAddress: body.ipAddress || req.ip,
      userAgent: body.userAgent || req.get('user-agent'),
      requestMethod: (body.requestMethod || req.method || '').toUpperCase(),
      endpoint: body.requestUrl || body.endpoint || req.originalUrl,
      metadata: body.metadata,
      executionTime: body.executionTime,
      errorMessage: body.errorMessage,
      // Actor
      userId: actor.userId,
      userName: body.userName || actor.userName || 'Unknown',
      userRole: body.userRole || actor.userRole || 'SYSTEM',
      userEmail: body.userEmail || actor.userEmail,
      // Related entities optional mapping
      relatedEntities: body.related || body.relatedEntities,
    };

    // Skip logging for READ actions
    if (normalized.action === 'READ') {
      return res.status(200).json({ success: true, skipped: true, reason: 'READ actions are not logged' });
    }

    // De-duplication: suppress duplicates within short window
    const windowMs = 3000; // 3 seconds window
    const since = new Date(Date.now() - windowMs);
    const dedupeFilter = {
      userName: normalized.userName,
      userRole: normalized.userRole,
      action: normalized.action,
      entity: normalized.entity,
      entityId: normalized.entityId,
      endpoint: normalized.endpoint,
      status: normalized.status,
      createdAt: { $gte: since }
    };
    const existing = await ActivityLog.findOne(dedupeFilter).lean();
    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Duplicate activity detected within window; returning existing log',
        data: existing,
        deduplicated: true
      });
    }

    const log = await ActivityLog.logActivity(normalized);

    if (!log) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create activity log'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Activity log created successfully',
      data: log
    });
  } catch (error) {
    console.error('Error creating activity log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create activity log',
      error: error.message
    });
  }
};

export {
  getAllActivityLogs,
  getActivityLogById,
  getUserActivityLogs,
  getEntityActivityLogs,
  getActivityStats,
  exportActivityLogs,
  cleanupActivityLogs,
  createActivityLog
};
