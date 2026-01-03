import crypto from 'crypto';
import ApiCallLog from '../models/apiCallLogModel.js';

class ApiLogger {
  constructor() {
    this.defaultMaxAttempts = 3;
    this.retryDelays = [1000, 3000, 9000]; // Exponential backoff: 1s, 3s, 9s
  }

  /**
   * Generate a unique request ID
   */
  generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Log an outgoing API call
   */
  async logOutgoingCall({
    service,
    operation,
    method,
    url,
    headers = {},
    requestBody = null,
    userId = null,
    clientId = null,
    relatedEntity = null,
    relatedEntityId = null,
    attemptNumber = 1,
    maxAttempts = 1,
    parentRequestId = null,
    retryReason = null
  }) {
    const requestId = parentRequestId || this.generateRequestId();
    const startTime = new Date();

    try {
      const logEntry = new ApiCallLog({
        requestId: attemptNumber > 1 ? `${requestId}_retry_${attemptNumber}` : requestId,
        service,
        operation,
        direction: 'outgoing',
        method: method.toUpperCase(),
        url,
        headers: this._sanitizeHeaders(headers),
        requestBody: this._sanitizeRequestBody(requestBody),
        startTime,
        success: false, // Will be updated when response is logged
        userId,
        clientId,
        relatedEntity,
        relatedEntityId,
        attemptNumber,
        maxAttempts,
        parentRequestId: attemptNumber > 1 ? requestId : null,
        retryReason,
        environment: process.env.NODE_ENV || 'development'
      });

      await logEntry.save();
      return requestId;
    } catch (error) {
      console.error('Failed to log outgoing API call:', error);
      return requestId; // Return ID even if logging fails
    }
  }

  /**
   * Log the response for an outgoing API call
   */
  async logResponse({
    requestId,
    statusCode,
    responseHeaders = {},
    responseBody = null,
    success = null,
    errorMessage = null,
    errorCode = null,
    attemptNumber = 1
  }) {
    const endTime = new Date();
    const logId = attemptNumber > 1 ? `${requestId}_retry_${attemptNumber}` : requestId;

    try {
      const logEntry = await ApiCallLog.findOne({ requestId: logId });
      if (!logEntry) {
        console.warn(`API call log not found for requestId: ${logId}`);
        return;
      }

      const duration = endTime.getTime() - logEntry.startTime.getTime();
      const isSuccess = success !== null ? success : (statusCode >= 200 && statusCode < 300);

      logEntry.endTime = endTime;
      logEntry.duration = duration;
      logEntry.statusCode = statusCode;
      logEntry.responseHeaders = this._sanitizeHeaders(responseHeaders);
      logEntry.responseBody = this._sanitizeResponseBody(responseBody);
      logEntry.success = isSuccess;
      logEntry.errorMessage = errorMessage;
      logEntry.errorCode = errorCode;

      // Mask sensitive data before saving
      logEntry.maskSensitiveData();
      
      await logEntry.save();

      // Log performance warning for slow requests
      if (duration > 30000) { // 30 seconds
        console.warn(`Slow API call detected: ${logEntry.service}/${logEntry.operation} took ${duration}ms`);
      }

      return logEntry;
    } catch (error) {
      console.error('Failed to log API response:', error);
    }
  }

  /**
   * Log an incoming webhook
   */
  async logIncomingWebhook({
    service,
    operation,
    method,
    url,
    headers = {},
    requestBody = null,
    webhookSignature = null,
    webhookVerified = false,
    webhookEvent = null,
    statusCode = 200,
    responseBody = null,
    success = true,
    errorMessage = null,
    userAgent = null,
    ipAddress = null
  }) {
    const requestId = this.generateRequestId();
    const startTime = new Date();
    const endTime = new Date();

    try {
      const logEntry = new ApiCallLog({
        requestId,
        service,
        operation,
        direction: 'incoming',
        method: method.toUpperCase(),
        url,
        headers: this._sanitizeHeaders(headers),
        requestBody: this._sanitizeRequestBody(requestBody),
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        statusCode,
        responseBody: this._sanitizeResponseBody(responseBody),
        success,
        errorMessage,
        webhookSignature,
        webhookVerified,
        webhookEvent,
        userAgent,
        ipAddress,
        environment: process.env.NODE_ENV || 'development'
      });

      // Mask sensitive data before saving
      logEntry.maskSensitiveData();
      
      await logEntry.save();
      return logEntry;
    } catch (error) {
      console.error('Failed to log incoming webhook:', error);
    }
  }

  /**
   * Create a logged fetch wrapper for API calls
   */
  createLoggedFetch({
    service,
    operation,
    userId = null,
    clientId = null,
    relatedEntity = null,
    relatedEntityId = null,
    maxAttempts = this.defaultMaxAttempts,
    retryCondition = null // Function to determine if retry should happen
  }) {
    return async (url, options = {}) => {
      let lastError = null;
      let requestId = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // Log the outgoing request
          requestId = await this.logOutgoingCall({
            service,
            operation,
            method: options.method || 'GET',
            url,
            headers: options.headers,
            requestBody: options.body ? this._parseBody(options.body) : null,
            userId,
            clientId,
            relatedEntity,
            relatedEntityId,
            attemptNumber: attempt,
            maxAttempts,
            parentRequestId: requestId,
            retryReason: attempt > 1 ? lastError?.message : null
          });

          // Make the actual API call
          const response = await fetch(url, options);
          const responseText = await response.text();
          let responseBody = null;

          try {
            responseBody = responseText ? JSON.parse(responseText) : null;
          } catch (e) {
            responseBody = responseText;
          }

          const success = response.ok;
          const errorMessage = !success ? responseBody?.message || responseBody?.error || `HTTP ${response.status}` : null;

          // Log the response
          await this.logResponse({
            requestId,
            statusCode: response.status,
            responseHeaders: Object.fromEntries(response.headers.entries()),
            responseBody,
            success,
            errorMessage,
            attemptNumber: attempt
          });

          // If successful or shouldn't retry, return the response
          if (success || attempt === maxAttempts || !this._shouldRetry(response, responseBody, retryCondition)) {
            // Create a new Response object with the parsed body
            const newResponse = new Response(responseText, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
            
            // Add parsed JSON method
            newResponse.json = async () => responseBody;
            newResponse.text = async () => responseText;
            
            return newResponse;
          }

          lastError = new Error(`HTTP ${response.status}: ${errorMessage}`);
          
        } catch (error) {
          lastError = error;
          
          // Log the error response
          if (requestId) {
            await this.logResponse({
              requestId,
              statusCode: 0,
              success: false,
              errorMessage: error.message,
              errorCode: error.code,
              attemptNumber: attempt
            });
          }

          // If this is the last attempt or shouldn't retry, throw the error
          if (attempt === maxAttempts || !this._shouldRetryOnError(error, retryCondition)) {
            throw error;
          }
        }

        // Wait before retrying
        if (attempt < maxAttempts) {
          const delay = this.retryDelays[Math.min(attempt - 1, this.retryDelays.length - 1)];
          console.log(`API call failed, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      throw lastError;
    };
  }

  /**
   * Get API call statistics
   */
  async getStats(service = null, hours = 24) {
    const query = {};
    if (service) query.service = service;
    
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    query.createdAt = { $gte: since };

    const stats = await ApiCallLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$service',
          totalCalls: { $sum: 1 },
          successfulCalls: { $sum: { $cond: ['$success', 1, 0] } },
          failedCalls: { $sum: { $cond: ['$success', 0, 1] } },
          avgDuration: { $avg: '$duration' },
          maxDuration: { $max: '$duration' },
          minDuration: { $min: '$duration' }
        }
      },
      {
        $addFields: {
          successRate: {
            $multiply: [
              { $divide: ['$successfulCalls', '$totalCalls'] },
              100
            ]
          }
        }
      }
    ]);

    return stats;
  }

  async logWebhookResponse(requestId, statusCode, responseBody, success, errorMessage = null, extra = {}) {
    try {
      const logEntry = await ApiCallLog.findOne({ requestId });
      if (!logEntry) {
        console.warn(`Webhook log not found for requestId: ${requestId}`);
        return;
      }

      const endTime = new Date();
      const duration = endTime.getTime() - logEntry.startTime.getTime();

      logEntry.endTime = endTime;
      logEntry.duration = duration;
      logEntry.statusCode = statusCode;
      logEntry.responseBody = this._sanitizeResponseBody(responseBody);
      logEntry.success = success;
      logEntry.errorMessage = errorMessage;

      // Optional updates for webhook verification state
      if (typeof extra.webhookVerified === 'boolean') {
        logEntry.webhookVerified = extra.webhookVerified;
      }
      if (typeof extra.webhookEvent === 'string') {
        logEntry.webhookEvent = extra.webhookEvent;
      }

      await logEntry.save();
      return logEntry;
    } catch (error) {
      console.error('Failed to log webhook response:', error);
    }
  }


  async cleanup() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    try {
      // Delete successful calls older than 30 days
      const successfulDeleted = await ApiCallLog.deleteMany({
        success: true,
        createdAt: { $lt: thirtyDaysAgo }
      });

      // Delete failed calls older than 90 days
      const failedDeleted = await ApiCallLog.deleteMany({
        success: false,
        createdAt: { $lt: ninetyDaysAgo }
      });

      console.log(`API log cleanup: Deleted ${successfulDeleted.deletedCount} successful logs and ${failedDeleted.deletedCount} failed logs`);
      
      return {
        successfulDeleted: successfulDeleted.deletedCount,
        failedDeleted: failedDeleted.deletedCount
      };
    } catch (error) {
      console.error('Failed to cleanup API logs:', error);
      throw error;
    }
  }

  // Private helper methods
  _sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'x-api-key', 'x-auth-token'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        const value = sanitized[key];
        if (typeof value === 'string' && value.length > 8) {
          sanitized[key] = value.substring(0, 8) + '***';
        } else {
          sanitized[key] = '***';
        }
      }
    }
    
    return sanitized;
  }

  _sanitizeRequestBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch (e) {
        return body;
      }
    }
    return body;
  }

  _sanitizeResponseBody(body) {
    if (!body) return null;
    return body;
  }

  _parseBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch (e) {
        return body;
      }
    }
    return body;
  }

  _shouldRetry(response, responseBody, retryCondition) {
    // Custom retry condition
    if (retryCondition && typeof retryCondition === 'function') {
      return retryCondition(response, responseBody);
    }

    // Default retry conditions
    if (response.status >= 500) return true; // Server errors
    if (response.status === 429) return true; // Rate limiting
    if (response.status === 408) return true; // Request timeout
    
    return false;
  }

  _shouldRetryOnError(error, retryCondition) {
    // Custom retry condition
    if (retryCondition && typeof retryCondition === 'function') {
      return retryCondition(null, null, error);
    }

    // Default retry conditions for network errors
    if (error.code === 'ECONNRESET') return true;
    if (error.code === 'ETIMEDOUT') return true;
    if (error.code === 'ENOTFOUND') return true;
    if (error.message.includes('timeout')) return true;
    
    return false;
  }
}

// Create singleton instance
const apiLogger = new ApiLogger();

// Export both the class and singleton
export default apiLogger;
export { ApiLogger };
