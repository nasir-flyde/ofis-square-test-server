import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema(
  {
    // User Information
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      // Not required: allows logging of pre-auth events like login attempts
      required: false,
    },
    userName: {
      type: String,
      required: true,
    },
    userRole: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
    },

    // Action Details
    action: {
      type: String,
      required: true,
      enum: [
        "CREATE",
        "READ",
        "UPDATE",
        "DELETE",
        "LOGIN",
        "LOGOUT",
        "EXPORT",
        "IMPORT",
        "SEND_EMAIL",
        "SEND_SMS",
        "PAYMENT_CREATED",
        "PAYMENT_PROCESSED",
        "CONTRACT_SIGNED",
        "INVOICE_GENERATED",
        "BOOKING_CREATED",
        "BOOKING_CANCELLED",
        "CHECK_IN",
        "CHECK_OUT",
        "BULK_OPERATION",
        "CUSTOM"
      ],
    },
    entity: {
      type: String,
      required: true, // e.g., "Client", "Payment", "Contract", "DayPass", "Invoice"
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      // Reference to the affected entity
    },
    description: {
      type: String,
      required: true, // Human-readable description of the action
    },

    // Request Context
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    requestMethod: {
      type: String,
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
    endpoint: {
      type: String, // API endpoint that was called
    },
    
    // Data Changes (for UPDATE operations)
    changes: {
      before: {
        type: mongoose.Schema.Types.Mixed, // Previous values
      },
      after: {
        type: mongoose.Schema.Types.Mixed, // New values
      },
      fields: [{
        type: String, // List of changed field names
      }],
    },

    // Additional Context
    metadata: {
      type: mongoose.Schema.Types.Mixed, // Additional context-specific data
    },
    
    // Status and Results
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "PARTIAL"],
      default: "SUCCESS",
    },
    errorMessage: {
      type: String, // If status is FAILED
    },
    
    // Session Information
    sessionId: {
      type: String,
    },
    
    // Related Records
    relatedEntities: [{
      entityType: String,
      entityId: mongoose.Schema.Types.ObjectId,
      description: String,
    }],

    // Performance Metrics
    executionTime: {
      type: Number, // Time taken in milliseconds
    },
    
    // Audit Trail
    isSystemGenerated: {
      type: Boolean,
      default: false, // true for automated actions, false for user actions
    },
    
    // Data Retention
    retentionDate: {
      type: Date, // When this log can be archived/deleted
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: "activity_logs",
  }
);

// Indexes for efficient querying
activityLogSchema.index({ userId: 1, createdAt: -1 });
activityLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 }); // For time-based queries
activityLogSchema.index({ userRole: 1, createdAt: -1 });
activityLogSchema.index({ status: 1, createdAt: -1 });

// Compound indexes for common query patterns
activityLogSchema.index({ entity: 1, action: 1, createdAt: -1 });
activityLogSchema.index({ userId: 1, entity: 1, createdAt: -1 });

// TTL index for automatic cleanup (optional - remove old logs after 2 years)
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 }); // 2 years

// Virtual for human-readable timestamp
activityLogSchema.virtual("formattedTimestamp").get(function () {
  return this.createdAt.toLocaleString();
});

// Static method to log activity
activityLogSchema.statics.logActivity = async function(logData) {
  try {
    const log = new this(logData);
    await log.save();
    return log;
  } catch (error) {
    console.error("Failed to save activity log:", error);
    // Don't throw error to avoid breaking main functionality
    return null;
  }
};

// Static method for bulk logging
activityLogSchema.statics.logBulkActivity = async function(logsArray) {
  try {
    const logs = await this.insertMany(logsArray, { ordered: false });
    return logs;
  } catch (error) {
    console.error("Failed to save bulk activity logs:", error);
    return null;
  }
};

// Instance method to add related entity
activityLogSchema.methods.addRelatedEntity = function(entityType, entityId, description) {
  this.relatedEntities.push({
    entityType,
    entityId,
    description: description || `Related ${entityType}`,
  });
};

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export default ActivityLog;
