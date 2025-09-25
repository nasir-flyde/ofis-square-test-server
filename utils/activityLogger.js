import ActivityLog from "../models/activityLogModel.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

// Helper function to extract user info from request
const extractUserInfo = (req) => {
  try {
    // First try to get from middleware (if authVerify was used)
    if (req.user) {
      return {
        userId: req.user._id,
        userName: req.user.name || req.user.email || 'Unknown User',
        userRole: req.user.roleName || req.userRole?.roleName || 'Unknown Role',
        userEmail: req.user.email,
      };
    }

    // Fallback: extract from JWT token
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
    return {
      userId: decoded.id,
      userName: decoded.name || decoded.email || 'Unknown User',
      userRole: decoded.roleName || 'Unknown Role',
      userEmail: decoded.email,
    };
  } catch (error) {
    return null;
  }
};

// Helper function to get client IP
const getClientIP = (req) => {
  if (!req || !req.headers) return 'unknown';
  
  return req.ip || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         req.headers['x-forwarded-for']?.split(',')[0] || 
         'unknown';
};

// Main utility function for logging activities
const logActivity = async (options) => {
  try {
    const {
      req,
      action,
      entity,
      entityId,
      description,
      changes,
      metadata,
      status = 'SUCCESS',
      errorMessage,
      relatedEntities = [],
      isSystemGenerated = false,
      userId,
      userName,
      userRole,
      userEmail
    } = options;

    let userInfo = null;
    let ipAddress = 'unknown';
    let userAgent = null;
    let endpoint = null;
    let requestMethod = null;

    // Extract user and request info if req is provided
    if (req) {
      userInfo = extractUserInfo(req);
      ipAddress = getClientIP(req);
      userAgent = req.headers['user-agent'];
      endpoint = req.url;
      requestMethod = req.method;
    }

    // Use provided user info if req is not available
    if (!userInfo && (userId || userName)) {
      userInfo = {
        userId,
        userName: userName || 'System User',
        userRole: userRole || 'System',
        userEmail
      };
    }

    if (!userInfo) {
      // Allow anonymous logs (e.g., pre-auth events)
      userInfo = {
        userId: null,
        userName: 'Anonymous',
        userRole: 'Unknown',
        userEmail: null,
      };
    }

    const logData = {
      userId: userInfo.userId,
      userName: userInfo.userName,
      userRole: userInfo.userRole,
      userEmail: userInfo.userEmail,
      action: action.toUpperCase(),
      entity,
      entityId,
      description,
      ipAddress,
      userAgent,
      requestMethod,
      endpoint,
      changes,
      metadata: metadata || {},
      status,
      errorMessage,
      relatedEntities,
      isSystemGenerated
    };

    const log = await ActivityLog.logActivity(logData);
    return log;
  } catch (error) {
    console.error('Activity logging failed:', error);
    return null;
  }
};

// Specific logging functions for common operations

// Log authentication events
const logAuthActivity = async (req, action, status = 'SUCCESS', errorMessage = null, additionalData = {}) => {
  const userInfo = extractUserInfo(req) || {
    userName: req.body?.email || req.body?.phone || 'Unknown User',
    userRole: 'Unknown',
  };

  return await logActivity({
    req,
    action,
    entity: 'Authentication',
    description: `${action.toLowerCase()} attempt by ${userInfo.userName}`,
    status,
    errorMessage,
    metadata: {
      loginMethod: req.url.includes('/otp') ? 'OTP' : 'Password',
      ...additionalData
    }
  });
};

// Log CRUD operations
const logCRUDActivity = async (reqOrUserId, action, entity, entityId, changes = null, additionalData = {}) => {
  const actionMap = {
    'CREATE': 'created',
    'UPDATE': 'updated', 
    'DELETE': 'deleted',
    'READ': 'viewed'
  };

  // Handle both req object and userId string
  let req = null;
  let userId = null;
  
  if (typeof reqOrUserId === 'string') {
    userId = reqOrUserId;
  } else if (reqOrUserId && typeof reqOrUserId === 'object') {
    req = reqOrUserId;
  }

  const userInfo = req ? extractUserInfo(req) : null;
  const actionText = actionMap[action.toUpperCase()] || action.toLowerCase();
  
  return await logActivity({
    req,
    userId,
    action,
    entity,
    entityId,
    description: `${userInfo?.userName || 'User'} ${actionText} ${entity.toLowerCase()}${entityId ? ` (ID: ${entityId})` : ''}`,
    changes,
    metadata: additionalData
  });
};

// Log payment activities
// Supports two call signatures for backward compatibility:
// A) logPaymentActivity(req, action, paymentId, amount, status = 'SUCCESS', additionalData = {})
// B) logPaymentActivity(req, action, entity, entityId, additionalData)
const logPaymentActivity = async (req, action, a3, a4, a5, a6) => {
  const userInfo = extractUserInfo(req);

  // Defaults
  let entity = 'Payment';
  let entityId = undefined;
  let amount = undefined;
  let status = 'SUCCESS';
  let metadata = {};

  // Detect signature B (entity, entityId, additionalData)
  if (typeof a3 === 'string' && (a3.toLowerCase() === 'payment' || a3.toLowerCase() === 'invoice' || a3.toLowerCase() === 'daypass' || a3.toLowerCase() === 'bundle')) {
    entity = a3;
    entityId = a4; // should be an ObjectId or string id
    metadata = (a5 && typeof a5 === 'object') ? a5 : {};
    // Try to derive amount if provided in metadata
    if (metadata && typeof metadata.amount === 'number') amount = metadata.amount;
  } else {
    // Assume signature A (paymentId, amount, status, additionalData)
    entityId = a3; // paymentId
    amount = a4;
    if (typeof a5 === 'string') status = a5.toUpperCase();
    metadata = (a6 && typeof a6 === 'object') ? a6 : {};
  }

  // Fix accidental mis-ordering where entityId is passed as the string 'Payment'
  if (typeof entityId === 'string' && entityId.toLowerCase && entityId.toLowerCase() === 'payment') {
    // Treat previous entity as Payment and clear entityId
    entity = 'Payment';
    entityId = undefined;
  }

  // If status is an object (common mistake), merge into metadata and default status
  if (status && typeof status === 'object') {
    metadata = { ...(metadata || {}), ...status };
    status = 'SUCCESS';
  }

  // Normalize status
  if (typeof status !== 'string' || !['SUCCESS', 'FAILED', 'PARTIAL'].includes(status)) status = 'SUCCESS';

  return await logActivity({
    req,
    action,
    entity,
    entityId,
    description: `${userInfo?.userName || 'User'} ${action.toLowerCase()} payment${typeof amount === 'number' ? ` of ₹${amount}` : ''}`,
    status,
    metadata: {
      ...(typeof amount === 'number' ? { amount } : {}),
      currency: 'INR',
      ...metadata
    }
  });
};

// Log contract activities
const logContractActivity = async (req, action, contractId, clientId, additionalData = {}) => {
  const userInfo = extractUserInfo(req);
  
  return await logActivity({
    req,
    action,
    entity: 'Contract',
    entityId: contractId,
    description: `${userInfo?.userName || 'User'} ${action.toLowerCase()} contract`,
    relatedEntities: clientId ? [{ entityType: 'Client', entityId: clientId, description: 'Contract client' }] : [],
    metadata: additionalData
  });
};

// Log booking activities
const logBookingActivity = async (req, action, bookingType, bookingId, additionalData = {}) => {
  const userInfo = extractUserInfo(req);
  
  return await logActivity({
    req,
    action,
    entity: bookingType, // 'DayPass', 'MeetingRoom', etc.
    entityId: bookingId,
    description: `${userInfo?.userName || 'User'} ${action.toLowerCase()} ${bookingType.toLowerCase()} booking`,
    metadata: additionalData
  });
};

// Log bulk operations
const logBulkActivity = async (req, action, entity, count, successCount, failedCount, additionalData = {}) => {
  const userInfo = extractUserInfo(req);
  
  return await logActivity({
    req,
    action: 'BULK_OPERATION',
    entity,
    description: `${userInfo?.userName || 'User'} performed bulk ${action.toLowerCase()} on ${count} ${entity.toLowerCase()}(s)`,
    status: failedCount > 0 ? 'PARTIAL' : 'SUCCESS',
    metadata: {
      operation: action,
      totalCount: count,
      successCount,
      failedCount,
      ...additionalData
    }
  });
};

// Log system activities (automated processes)
const logSystemActivity = async (action, entity, entityId, description, additionalData = {}) => {
  return await logActivity({
    action,
    entity,
    entityId,
    description,
    userName: 'System',
    userRole: 'System',
    isSystemGenerated: true,
    metadata: {
      automated: true,
      ...additionalData
    }
  });
};

// Log export/import activities
const logDataActivity = async (req, action, entity, count, format = 'CSV', additionalData = {}) => {
  const userInfo = extractUserInfo(req);
  
  return await logActivity({
    req,
    action,
    entity,
    description: `${userInfo?.userName || 'User'} ${action.toLowerCase()}ed ${count} ${entity.toLowerCase()} records in ${format} format`,
    metadata: {
      recordCount: count,
      format,
      ...additionalData
    }
  });
};

// Log error activities
const logErrorActivity = async (req, error, context = 'General', additionalData = {}) => {
  const userInfo = extractUserInfo(req);
  
  return await logActivity({
    req,
    action: 'ERROR',
    entity: context,
    description: `Error occurred: ${error.message || error}`,
    status: 'FAILED',
    errorMessage: error.message || error.toString(),
    metadata: {
      errorType: error.name || 'Unknown',
      stack: error.stack,
      ...additionalData
    }
  });
};

// Alias for logActivity to maintain compatibility
const logBusinessEvent = logActivity;

export {
  logActivity,
  logAuthActivity,
  logCRUDActivity,
  logPaymentActivity,
  logContractActivity,
  logBookingActivity,
  logBulkActivity,
  logSystemActivity,
  logDataActivity,
  logErrorActivity,
  logBusinessEvent
};
