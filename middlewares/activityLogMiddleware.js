import jwt from "jsonwebtoken";
import ActivityLog from "../models/activityLogModel.js";
import dotenv from "dotenv";
dotenv.config();

// Helper function to extract user info, preferring req.user populated by auth middleware
const extractUserFromToken = (req) => {
  try {
    // Prefer user info set by authVerify middleware
    if (req.user) {
      return {
        userId: req.user._id?.toString?.() || req.user.id || null,
        userName: req.user.name || req.user.email || "Unknown User",
        userRole: req.user.roleName || req.userRole?.roleName || "Unknown Role",
        userEmail: req.user.email,
      };
    }

    // Fallback: read from JWT directly
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
    // Ensure req.user is available downstream
    if (!req.user && decoded?.id) {
      req.user = {
        _id: decoded.id,
        name: decoded.name || undefined,
        email: decoded.email || undefined,
        roleName: decoded.roleName || undefined,
      };
    }
    return {
      userId: decoded.id,
      userName: decoded.name || decoded.email || "Unknown User",
      userRole: decoded.roleName || "Unknown Role",
      userEmail: decoded.email,
    };
  } catch (error) {
    return null;
  }
};

// Helper function to get client IP address
const getClientIP = (req) => {
  return req.ip || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         req.headers['x-forwarded-for']?.split(',')[0] || 
         'unknown';
};

// Helper function to determine entity from URL
const extractEntityFromUrl = (url) => {
  const segments = url.split('/').filter(Boolean);
  
  const entityMap = {
    'clients': 'Client',
    'payments': 'Payment',
    'contracts': 'Contract',
    'day-passes': 'DayPass',
    'invoices': 'Invoice',
    'bookings': 'Booking',
    'tickets': 'Ticket',
    'users': 'User',
    'buildings': 'Building',
    'cabins': 'Cabin',
    'desks': 'Desk',
    'members': 'Member',
    'visitors': 'Visitor',
    'credits': 'Credit',
    'otp': 'Authentication',
    'auth': 'Authentication',
    'meeting-rooms': 'MeetingRoom',
    'meeting-bookings': 'MeetingBooking',
    'ticket-categories': 'TicketCategory',
    'member-portal': 'Member',
    'client-portal': 'Client'
  };

  // Check if URL starts with /api/
  if (segments.length >= 2 && segments[0] === 'api') {
    const entityKey = segments[1];
    return entityMap[entityKey] || entityKey.charAt(0).toUpperCase() + entityKey.slice(1);
  }
  
  // For URLs without /api/ prefix, try to match against known patterns
  for (const [key, value] of Object.entries(entityMap)) {
    if (url.includes(`/${key}/`) || url.includes(`/${key}`)) {
      return value;
    }
  }
  
  return 'Unknown';
};

// Helper function to determine action from method and URL
const determineAction = (method, url, statusCode) => {
  const isAuthRoute = url.includes('/auth') || url.includes('/otp');
  const isExportRoute = url.includes('/export');
  const isImportRoute = url.includes('/import');
  const isBulkRoute = url.includes('/bulk');
  
  if (isAuthRoute) {
    if (url.includes('/login') || url.includes('/verify')) return 'LOGIN';
    if (url.includes('/logout')) return 'LOGOUT';
  }
  
  if (isExportRoute) return 'EXPORT';
  if (isImportRoute) return 'IMPORT';
  if (isBulkRoute) return 'BULK_OPERATION';
  
  // Payment specific actions
  if (url.includes('/payment') && method === 'POST') {
    if (statusCode >= 200 && statusCode < 300) return 'PAYMENT_PROCESSED';
    return 'PAYMENT_CREATED';
  }
  
  // Contract specific actions
  if (url.includes('/contract') && url.includes('/sign')) return 'CONTRACT_SIGNED';
  
  // Standard CRUD operations
  switch (method) {
    case 'GET': return 'READ';
    case 'POST': return 'CREATE';
    case 'PUT':
    case 'PATCH': return 'UPDATE';
    case 'DELETE': return 'DELETE';
    default: return 'CUSTOM';
  }
};

// Helper function to generate description
const generateDescription = (action, entity, method, url, userInfo) => {
  const userName = userInfo?.userName || 'Unknown User';
  const entityName = entity.toLowerCase();
  
  switch (action) {
    case 'LOGIN':
      return `${userName} logged into the system`;
    case 'LOGOUT':
      return `${userName} logged out of the system`;
    case 'CREATE':
      return `${userName} created a new ${entityName}`;
    case 'UPDATE':
      return `${userName} updated ${entityName} details`;
    case 'DELETE':
      return `${userName} deleted a ${entityName}`;
    case 'READ':
      return `${userName} viewed ${entityName} information`;
    case 'EXPORT':
      return `${userName} exported ${entityName} data`;
    case 'IMPORT':
      return `${userName} imported ${entityName} data`;
    case 'BULK_OPERATION':
      return `${userName} performed bulk operation on ${entityName}`;
    case 'PAYMENT_PROCESSED':
      return `${userName} processed a payment`;
    case 'PAYMENT_CREATED':
      return `${userName} created a payment record`;
    case 'CONTRACT_SIGNED':
      return `${userName} signed a contract`;
    default:
      return `${userName} performed ${action.toLowerCase()} on ${entityName}`;
  }
};

// Main activity logging middleware
const activityLogMiddleware = (options = {}) => {
  const {
    skipRoutes = [
      '/health', '/status', '/ping',
      '/api/activity-logs'
    ],
    skipGetRoutes = [
      '/api/buildings', '/api/roles', '/api/users',
      '/api/clients', '/api/members', '/api/desks',
      '/api/cabins', '/api/contracts', '/api/invoices',
      '/api/tickets', '/api/meeting-rooms', '/api/day-passes',
      '/api/client-portal', '/api/member-portal',
      '/dashboard', '/stats'
    ],
    skipMethods = ['OPTIONS'],
    logReadOperations = false,
    logFailedRequests = true,
  } = options;

  return async (req, res, next) => {
    const startTime = Date.now();
    let hasLogged = false; // Flag to prevent duplicate logging
    
    // Skip logging for certain routes and methods
    if (skipRoutes.some(route => req.url.includes(route)) || 
        skipMethods.includes(req.method)) {
      return next();
    }

    // Skip GET requests for data fetching routes (but allow other methods)
    if (req.method === 'GET' && skipGetRoutes.some(route => req.url.includes(route))) {
      return next();
    }

    // Skip GET requests unless explicitly enabled
    if (req.method === 'GET' && !logReadOperations) {
      return next();
    }

    // Store original res.json to capture response
    const originalJson = res.json;
    let responseData = null;
    let statusCode = null;

    const logActivity = async () => {
      if (hasLogged) return; // Prevent duplicate logging
      hasLogged = true;
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Log the activity asynchronously (don't block response)
      setImmediate(async () => {
        try {
          const entity = extractEntityFromUrl(req.url);
          const action = determineAction(req.method, req.url, statusCode || res.statusCode);
          
          // Skip logging failed requests if not enabled
          if (!logFailedRequests && (statusCode || res.statusCode) >= 400) {
            return;
          }

          // Skip auth routes - they're logged explicitly in controllers
          if (req.url.includes('/login') || req.url.includes('/signup') || req.url.includes('/otp')) {
            return;
          }

          // Extract user information now (after auth middleware may have populated req.user)
          const userInfo = extractUserFromToken(req);

          // Skip if no authenticated user (prevents null userId logs)
          if (!userInfo?.userId) {
            return;
          }

          // Get full URL path including /api prefix
          const fullUrl = req.originalUrl || req.url;
          const entityFromFullUrl = extractEntityFromUrl(fullUrl);
          const finalEntity = entityFromFullUrl !== 'Unknown' ? entityFromFullUrl : entity;

          const logData = {
            userId: userInfo.userId,
            userName: (userInfo?.userName) || 'Anonymous',
            userRole: (userInfo?.userRole) || 'Unknown',
            userEmail: userInfo?.userEmail || null,
            action: action.toUpperCase(),
            entity: finalEntity,
            entityId: req.params?.id || responseData?.id || responseData?._id || null,
            description: generateDescription(action, finalEntity, req.method, fullUrl, userInfo),
            ipAddress: getClientIP(req),
            userAgent: req.headers['user-agent'],
            requestMethod: req.method,
            endpoint: fullUrl,
            status: (statusCode || res.statusCode) >= 400 ? 'FAILED' : 'SUCCESS',
            errorMessage: (statusCode || res.statusCode) >= 400 ? responseData?.message || responseData?.error : null,
            executionTime,
            metadata: {
              requestBody: req.method !== 'GET' ? req.body : undefined,
              queryParams: Object.keys(req.query).length > 0 ? req.query : undefined,
              responseStatus: statusCode || res.statusCode,
              userAgent: req.headers['user-agent'],
            },
            isSystemGenerated: false,
          };

          // Add changes for UPDATE operations
          if (action.toUpperCase() === 'UPDATE' && req.body) {
            logData.changes = {
              after: req.body,
              fields: Object.keys(req.body),
            };
          }

          await ActivityLog.logActivity(logData);
        } catch (error) {
          console.error('Activity logging failed:', error);
          // Don't throw error to avoid breaking the main request
        }
      });
    };

    res.json = function(data) {
      responseData = data;
      statusCode = res.statusCode;
      logActivity();
      return originalJson.call(this, data);
    };

    // Store original res.end to capture when response is sent
    const originalEnd = res.end;
    res.end = function(...args) {
      logActivity();
      return originalEnd.apply(this, args);
    };

    next();
  };
};

// Middleware for logging specific business events
const logBusinessEvent = async (eventData) => {
  try {
    const logData = {
      userId: eventData.userId,
      userName: eventData.userName || 'System',
      userRole: eventData.userRole || 'System',
      userEmail: eventData.userEmail,
      action: eventData.action,
      entity: eventData.entity,
      entityId: eventData.entityId,
      description: eventData.description,
      status: eventData.status || 'SUCCESS',
      errorMessage: eventData.errorMessage,
      metadata: eventData.metadata || {},
      changes: eventData.changes,
      relatedEntities: eventData.relatedEntities || [],
      isSystemGenerated: eventData.isSystemGenerated || false,
    };

    await ActivityLog.logActivity(logData);
  } catch (error) {
    console.error('Business event logging failed:', error);
  }
};

// Middleware for logging authentication events
const logAuthEvent = async (req, action, status = 'SUCCESS', errorMessage = null) => {
  try {
    const userInfo = extractUserFromToken(req) || {
      userName: req.body?.email || req.body?.phone || 'Unknown User',
      userRole: 'Unknown',
    };

    const logData = {
      userId: userInfo.userId || null,
      userName: userInfo.userName,
      userRole: userInfo.userRole,
      userEmail: userInfo.userEmail || req.body?.email,
      action,
      entity: 'Authentication',
      description: `${action.toLowerCase()} attempt by ${userInfo.userName}`,
      ipAddress: getClientIP(req),
      userAgent: req.headers['user-agent'],
      requestMethod: req.method,
      endpoint: req.url,
      status,
      errorMessage,
      metadata: {
        loginMethod: req.url.includes('/otp') ? 'OTP' : 'Password',
        userAgent: req.headers['user-agent'],
      },
      isSystemGenerated: false,
    };

    await ActivityLog.logActivity(logData);
  } catch (error) {
    console.error('Auth event logging failed:', error);
  }
};

export default activityLogMiddleware;
export { logBusinessEvent, logAuthEvent };
