import ApiCallLog from '../models/apiCallLogModel.js';
import apiLogger from '../utils/apiLogger.js';
import { logCRUDActivity, logErrorActivity } from '../utils/activityLogger.js';

// GET /api/api-logs - List API call logs with filtering
export const getApiLogs = async (req, res) => {
  try {
    const {
      service,
      operation,
      direction,
      success,
      userId,
      clientId,
      relatedEntity,
      relatedEntityId,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter query
    const filter = {};
    
    if (service) filter.service = service;
    if (operation) filter.operation = operation;
    if (direction) filter.direction = direction;
    if (success !== undefined) filter.success = success === 'true';
    if (userId) filter.userId = userId;
    if (clientId) filter.clientId = clientId;
    if (relatedEntity) filter.relatedEntity = relatedEntity;
    if (relatedEntityId) filter.relatedEntityId = relatedEntityId;

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Search filter
    if (search) {
      filter.$or = [
        { operation: { $regex: search, $options: 'i' } },
        { url: { $regex: search, $options: 'i' } },
        { errorMessage: { $regex: search, $options: 'i' } },
        { requestId: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const [logs, total] = await Promise.all([
      ApiCallLog.find(filter)
        .populate('userId', 'name email')
        .populate('clientId', 'companyName email')
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ApiCallLog.countDocuments(filter)
    ]);

    // Add computed fields
    const enrichedLogs = logs.map(log => ({
      ...log,
      responseTimeSeconds: log.duration ? (log.duration / 1000).toFixed(3) : null,
      isRetry: log.attemptNumber > 1
    }));

    return res.json({
      success: true,
      data: {
        logs: enrichedLogs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
          hasMore: skip + logs.length < total
        }
      }
    });
  } catch (error) {
    console.error('getApiLogs error:', error);
    await logErrorActivity(req, error, 'Get API Logs');
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch API logs'
    });
  }
};

// GET /api/api-logs/:id - Get specific API log
export const getApiLogById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const log = await ApiCallLog.findById(id)
      .populate('userId', 'name email')
      .populate('clientId', 'companyName email')
      .lean();

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'API log not found'
      });
    }

    // Add computed fields
    const enrichedLog = {
      ...log,
      responseTimeSeconds: log.duration ? (log.duration / 1000).toFixed(3) : null,
      isRetry: log.attemptNumber > 1
    };

    return res.json({
      success: true,
      data: enrichedLog
    });
  } catch (error) {
    console.error('getApiLogById error:', error);
    await logErrorActivity(req, error, 'Get API Log by ID');
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch API log'
    });
  }
};

// GET /api/api-logs/stats - Get API call statistics
export const getApiStats = async (req, res) => {
  try {
    const { 
      service, 
      hours = 24,
      groupBy = 'service' // service, operation, status
    } = req.query;

    const hoursNum = parseInt(hours);
    const since = new Date(Date.now() - hoursNum * 60 * 60 * 1000);

    let matchStage = { createdAt: { $gte: since } };
    if (service) matchStage.service = service;

    let groupStage = {};
    switch (groupBy) {
      case 'operation':
        groupStage._id = { service: '$service', operation: '$operation' };
        break;
      case 'status':
        groupStage._id = { service: '$service', success: '$success' };
        break;
      default:
        groupStage._id = '$service';
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          ...groupStage,
          totalCalls: { $sum: 1 },
          successfulCalls: { $sum: { $cond: ['$success', 1, 0] } },
          failedCalls: { $sum: { $cond: ['$success', 0, 1] } },
          avgDuration: { $avg: '$duration' },
          maxDuration: { $max: '$duration' },
          minDuration: { $min: '$duration' },
          totalDuration: { $sum: '$duration' }
        }
      },
      {
        $addFields: {
          successRate: {
            $round: [{
              $multiply: [
                { $divide: ['$successfulCalls', '$totalCalls'] },
                100
              ]
            }, 2]
          },
          avgResponseTime: {
            $round: [{ $divide: ['$avgDuration', 1000] }, 3]
          }
        }
      },
      { $sort: { totalCalls: -1 } }
    ];

    const stats = await ApiCallLog.aggregate(pipeline);

    // Get overall stats
    const overallStats = await ApiCallLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          successfulCalls: { $sum: { $cond: ['$success', 1, 0] } },
          failedCalls: { $sum: { $cond: ['$success', 0, 1] } },
          avgDuration: { $avg: '$duration' },
          uniqueServices: { $addToSet: '$service' },
          uniqueOperations: { $addToSet: '$operation' }
        }
      },
      {
        $addFields: {
          successRate: {
            $round: [{
              $multiply: [
                { $divide: ['$successfulCalls', '$totalCalls'] },
                100
              ]
            }, 2]
          },
          avgResponseTime: {
            $round: [{ $divide: ['$avgDuration', 1000] }, 3]
          },
          serviceCount: { $size: '$uniqueServices' },
          operationCount: { $size: '$uniqueOperations' }
        }
      }
    ]);

    return res.json({
      success: true,
      data: {
        overall: overallStats[0] || {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          successRate: 0,
          avgResponseTime: 0,
          serviceCount: 0,
          operationCount: 0
        },
        breakdown: stats,
        period: `${hoursNum} hours`,
        groupedBy: groupBy
      }
    });
  } catch (error) {
    console.error('getApiStats error:', error);
    await logErrorActivity(req, error, 'Get API Stats');
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch API statistics'
    });
  }
};

// GET /api/api-logs/failures - Get recent failures
export const getRecentFailures = async (req, res) => {
  try {
    const { 
      hours = 24, 
      limit = 50,
      service 
    } = req.query;

    const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);
    const filter = { 
      success: false, 
      createdAt: { $gte: since } 
    };
    
    if (service) filter.service = service;

    const failures = await ApiCallLog.find(filter)
      .populate('userId', 'name email')
      .populate('clientId', 'companyName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Group failures by error message for analysis
    const errorGroups = failures.reduce((groups, failure) => {
      const errorKey = failure.errorMessage || 'Unknown Error';
      if (!groups[errorKey]) {
        groups[errorKey] = {
          errorMessage: errorKey,
          count: 0,
          services: new Set(),
          operations: new Set(),
          firstOccurrence: failure.createdAt,
          lastOccurrence: failure.createdAt
        };
      }
      
      groups[errorKey].count++;
      groups[errorKey].services.add(failure.service);
      groups[errorKey].operations.add(failure.operation);
      
      if (failure.createdAt < groups[errorKey].firstOccurrence) {
        groups[errorKey].firstOccurrence = failure.createdAt;
      }
      if (failure.createdAt > groups[errorKey].lastOccurrence) {
        groups[errorKey].lastOccurrence = failure.createdAt;
      }
      
      return groups;
    }, {});

    // Convert sets to arrays
    const errorSummary = Object.values(errorGroups).map(group => ({
      ...group,
      services: Array.from(group.services),
      operations: Array.from(group.operations)
    })).sort((a, b) => b.count - a.count);

    return res.json({
      success: true,
      data: {
        failures,
        errorSummary,
        period: `${hours} hours`,
        totalFailures: failures.length
      }
    });
  } catch (error) {
    console.error('getRecentFailures error:', error);
    await logErrorActivity(req, error, 'Get Recent Failures');
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recent failures'
    });
  }
};

// DELETE /api/api-logs/cleanup - Clean up old logs
export const cleanupLogs = async (req, res) => {
  try {
    const result = await apiLogger.cleanup();
    
    await logCRUDActivity(req, 'DELETE', 'ApiCallLog', null, null, {
      operation: 'cleanup',
      successfulDeleted: result.successfulDeleted,
      failedDeleted: result.failedDeleted
    });

    return res.json({
      success: true,
      message: 'Log cleanup completed successfully',
      data: result
    });
  } catch (error) {
    console.error('cleanupLogs error:', error);
    await logErrorActivity(req, error, 'Cleanup API Logs');
    return res.status(500).json({
      success: false,
      message: 'Failed to cleanup logs'
    });
  }
};

// GET /api/api-logs/export - Export logs as CSV
export const exportLogs = async (req, res) => {
  try {
    const {
      service,
      operation,
      direction,
      success,
      startDate,
      endDate,
      limit = 1000
    } = req.query;

    // Build filter query
    const filter = {};
    if (service) filter.service = service;
    if (operation) filter.operation = operation;
    if (direction) filter.direction = direction;
    if (success !== undefined) filter.success = success === 'true';

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const logs = await ApiCallLog.find(filter)
      .populate('userId', 'name email')
      .populate('clientId', 'companyName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Convert to CSV format
    const csvHeaders = [
      'Request ID',
      'Service',
      'Operation',
      'Direction',
      'Method',
      'URL',
      'Status Code',
      'Success',
      'Duration (ms)',
      'Error Message',
      'User',
      'Client',
      'Created At'
    ];

    const csvRows = logs.map(log => [
      log.requestId,
      log.service,
      log.operation,
      log.direction,
      log.method,
      log.url,
      log.statusCode || '',
      log.success ? 'Yes' : 'No',
      log.duration || '',
      log.errorMessage || '',
      log.userId?.name || '',
      log.clientId?.companyName || '',
      log.createdAt.toISOString()
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="api-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    
    return res.send(csvContent);
  } catch (error) {
    console.error('exportLogs error:', error);
    await logErrorActivity(req, error, 'Export API Logs');
    return res.status(500).json({
      success: false,
      message: 'Failed to export logs'
    });
  }
};

// GET /api/api-logs/retry/:id - Retry a failed API call
export const retryApiCall = async (req, res) => {
  try {
    const { id } = req.params;
    
    const originalLog = await ApiCallLog.findById(id);
    if (!originalLog) {
      return res.status(404).json({
        success: false,
        message: 'API log not found'
      });
    }

    if (originalLog.success) {
      return res.status(400).json({
        success: false,
        message: 'Cannot retry successful API call'
      });
    }

    // This would need to be implemented based on the specific service
    // For now, return a placeholder response
    return res.json({
      success: true,
      message: 'Retry functionality not yet implemented',
      data: {
        originalRequestId: originalLog.requestId,
        service: originalLog.service,
        operation: originalLog.operation
      }
    });
  } catch (error) {
    console.error('retryApiCall error:', error);
    await logErrorActivity(req, error, 'Retry API Call');
    return res.status(500).json({
      success: false,
      message: 'Failed to retry API call'
    });
  }
};

// GET /api/api-logs/health - Health check for API logging system
export const getApiLogsHealth = async (req, res) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [recentLogs, failureRate] = await Promise.all([
      ApiCallLog.countDocuments({ createdAt: { $gte: oneHourAgo } }),
      ApiCallLog.aggregate([
        { $match: { createdAt: { $gte: oneHourAgo } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            failures: { $sum: { $cond: ['$success', 0, 1] } }
          }
        }
      ])
    ]);

    const failurePercent = failureRate[0] ? 
      ((failureRate[0].failures / failureRate[0].total) * 100).toFixed(2) : 0;

    return res.json({
      success: true,
      data: {
        status: 'healthy',
        recentLogsCount: recentLogs,
        failureRate: `${failurePercent}%`,
        timestamp: now.toISOString(),
        services: ['zoho_books', 'zoho_sign', 'razorpay', 'sms_waale']
      }
    });
  } catch (error) {
    console.error('getApiLogsHealth error:', error);
    return res.status(500).json({
      success: false,
      message: 'API logs health check failed'
    });
  }
};
