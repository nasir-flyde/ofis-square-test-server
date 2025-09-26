import mongoose from "mongoose";

const apiCallLogSchema = new mongoose.Schema({
  // Core identification
  requestId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  service: {
    type: String,
    required: true,
    enum: ['zoho_books', 'zoho_sign', 'razorpay', 'sms_waale', 'other'],
    index: true
  },
  operation: {
    type: String,
    required: true,
    index: true
    // Examples: 'create_contact', 'create_invoice', 'send_for_signature', 'create_order', 'send_sms'
  },
  direction: {
    type: String,
    required: true,
    enum: ['outgoing', 'incoming'],
    index: true
  },
  
  // Request details
  method: {
    type: String,
    required: true,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  },
  url: {
    type: String,
    required: true
  },
  headers: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  requestBody: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  
  // Response details
  statusCode: {
    type: Number,
    index: true
  },
  responseHeaders: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  responseBody: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  
  // Timing and performance
  startTime: {
    type: Date,
    required: true,
    index: true
  },
  endTime: {
    type: Date,
    index: true
  },
  duration: {
    type: Number, // milliseconds
    index: true
  },
  
  // Status tracking
  success: {
    type: Boolean,
    required: true,
    index: true
  },
  errorMessage: {
    type: String,
    default: null
  },
  errorCode: {
    type: String,
    default: null
  },
  
  // Context and relationships
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    index: true
  },
  relatedEntity: {
    type: String,
    enum: ['invoice', 'contract', 'payment', 'client', 'daypass', 'bundle', 'other'],
    index: true
  },
  relatedEntityId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  
  // Retry tracking
  attemptNumber: {
    type: Number,
    default: 1,
    min: 1
  },
  maxAttempts: {
    type: Number,
    default: 1
  },
  retryReason: {
    type: String,
    default: null
  },
  parentRequestId: {
    type: String,
    default: null,
    index: true // Links retry attempts to original request
  },
  
  // Webhook specific fields
  webhookSignature: {
    type: String,
    default: null
  },
  webhookVerified: {
    type: Boolean,
    default: null
  },
  webhookEvent: {
    type: String,
    default: null
  },
  
  // Additional metadata
  userAgent: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  },
  environment: {
    type: String,
    enum: ['development', 'staging', 'production'],
    default: process.env.NODE_ENV || 'development'
  },
  
  // Data masking flag
  dataMasked: {
    type: Boolean,
    default: false
  },
  
  // Raw data backup (for debugging)
  rawRequest: {
    type: String,
    default: null
  },
  rawResponse: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  collection: 'api_call_logs'
});

// Indexes for performance
apiCallLogSchema.index({ service: 1, createdAt: -1 });
apiCallLogSchema.index({ success: 1, createdAt: -1 });
apiCallLogSchema.index({ userId: 1, createdAt: -1 });
apiCallLogSchema.index({ clientId: 1, createdAt: -1 });
apiCallLogSchema.index({ relatedEntity: 1, relatedEntityId: 1 });
apiCallLogSchema.index({ parentRequestId: 1 });
apiCallLogSchema.index({ direction: 1, service: 1, createdAt: -1 });

// TTL index for automatic cleanup (90 days)
apiCallLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Virtual for response time in seconds
apiCallLogSchema.virtual('responseTimeSeconds').get(function() {
  return this.duration ? (this.duration / 1000).toFixed(3) : null;
});

// Virtual for success rate calculation
apiCallLogSchema.virtual('isRetry').get(function() {
  return this.attemptNumber > 1;
});

// Static methods
apiCallLogSchema.statics.findByService = function(service, limit = 100) {
  return this.find({ service })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'name email')
    .populate('clientId', 'companyName email');
};

apiCallLogSchema.statics.findFailures = function(hours = 24, limit = 100) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({ 
    success: false, 
    createdAt: { $gte: since } 
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'name email')
    .populate('clientId', 'companyName email');
};

apiCallLogSchema.statics.getServiceStats = async function(service, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const stats = await this.aggregate([
    {
      $match: {
        service,
        createdAt: { $gte: since }
      }
    },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        successfulCalls: { 
          $sum: { $cond: ['$success', 1, 0] } 
        },
        failedCalls: { 
          $sum: { $cond: ['$success', 0, 1] } 
        },
        avgDuration: { $avg: '$duration' },
        maxDuration: { $max: '$duration' },
        minDuration: { $min: '$duration' }
      }
    }
  ]);
  
  if (stats.length === 0) {
    return {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      successRate: 0,
      avgDuration: 0,
      maxDuration: 0,
      minDuration: 0
    };
  }
  
  const result = stats[0];
  result.successRate = result.totalCalls > 0 ? 
    ((result.successfulCalls / result.totalCalls) * 100).toFixed(2) : 0;
  
  return result;
};

// Instance methods
apiCallLogSchema.methods.maskSensitiveData = function() {
  // Mask authorization headers
  if (this.headers && this.headers.Authorization) {
    const auth = this.headers.Authorization;
    if (auth.length > 8) {
      this.headers.Authorization = auth.substring(0, 8) + '***';
    }
  }
  
  // Mask API keys in request body
  if (this.requestBody && typeof this.requestBody === 'object') {
    this.requestBody = this._maskObjectData(this.requestBody);
  }
  
  // Mask sensitive response data
  if (this.responseBody && typeof this.responseBody === 'object') {
    this.responseBody = this._maskObjectData(this.responseBody);
  }
  
  this.dataMasked = true;
  return this;
};

apiCallLogSchema.methods._maskObjectData = function(obj) {
  const sensitiveFields = [
    'password', 'token', 'key', 'secret', 'authorization',
    'api_key', 'access_token', 'refresh_token', 'client_secret',
    'razorpay_key', 'zoho_token', 'webhook_secret'
  ];
  
  const masked = { ...obj };
  
  for (const [key, value] of Object.entries(masked)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      if (typeof value === 'string' && value.length > 8) {
        masked[key] = value.substring(0, 8) + '***';
      } else {
        masked[key] = '***';
      }
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = this._maskObjectData(value);
    }
  }
  
  return masked;
};

const ApiCallLog = mongoose.model('ApiCallLog', apiCallLogSchema);

export default ApiCallLog;
