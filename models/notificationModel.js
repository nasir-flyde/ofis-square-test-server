import mongoose from "mongoose";

const { Schema } = mongoose;

const deliveryHistorySchema = new Schema({
  at: { type: Date, default: Date.now },
  action: { 
    type: String, 
    enum: ['queued', 'sent', 'delivered', 'failed', 'retried', 'canceled'],
    required: true 
  },
  details: { type: String },
  error: { type: String },
  providerResponse: { type: Schema.Types.Mixed }
}, { _id: false });

const channelDeliverySchema = new Schema({
  status: {
    type: String,
    enum: ['pending', 'queued', 'sent', 'delivered', 'failed', 'canceled', 'skipped'],
    default: 'pending'
  },
  provider: {
    type: String,
    enum: ['smswaale', 'twilio', 'smtp', 'sendgrid', 'nodemailer', 'mock']
  },
  providerMessageId: { type: String },
  attemptCount: { type: Number, default: 0 },
  lastError: { type: String },
  errorCode: { type: String },
  history: [deliveryHistorySchema],
  sentAt: { type: Date },
  deliveredAt: { type: Date },
  failedAt: { type: Date },
  canceledAt: { type: Date }
}, { _id: false });

const notificationSchema = new Schema({
  // Core notification data
  type: {
    type: String,
    enum: ['system', 'marketing', 'transactional', 'reminder'],
    default: 'system'
  },
  channels: {
    sms: { type: Boolean, default: false },
    email: { type: Boolean, default: false }
  },
  title: { type: String, required: true },
  templateKey: { type: String },
  templateVariables: { type: Schema.Types.Mixed },
  
  // Content for each channel
  content: {
    smsText: { type: String },
    emailSubject: { type: String },
    emailHtml: { type: String },
    emailText: { type: String }
  },
  
  // Metadata
  metadata: {
    tags: [{ type: String }],
    priority: {
      type: String,
      enum: ['low', 'normal', 'high'],
      default: 'normal'
    },
    category: { type: String },
    deepLink: { type: String },
    route: { type: String },
    routeParams: { type: Schema.Types.Mixed }
  },
  
  // Targeting
  to: {
    phone: { type: String },
    email: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member' },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client' }
  },
  audienceQuery: { type: Schema.Types.Mixed },
  
  // Per-channel delivery state
  smsDelivery: channelDeliverySchema,
  emailDelivery: channelDeliverySchema,
  
  // Scheduling & Control
  scheduledAt: { type: Date },
  expiresAt: { type: Date },
  canceled: { type: Boolean, default: false },
  cancelReason: { type: String },
  maxRetries: { type: Number, default: 3 },
  retryBackoffSeconds: { type: Number, default: 60 },
  
  // Read/Acknowledgement
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  
  // Audit
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  source: {
    type: String,
    enum: ['admin_panel', 'system', 'api', 'webhook'],
    default: 'system'
  },
  relatedEntity: {
    entity: { type: String },
    entityId: { type: Schema.Types.ObjectId }
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ 'channels.sms': 1 });
notificationSchema.index({ 'channels.email': 1 });
notificationSchema.index({ 'smsDelivery.status': 1 });
notificationSchema.index({ 'emailDelivery.status': 1 });
notificationSchema.index({ 'to.userId': 1 });
notificationSchema.index({ 'to.memberId': 1 });
notificationSchema.index({ 'to.clientId': 1 });
notificationSchema.index({ 'to.phone': 1 });
notificationSchema.index({ 'to.email': 1 });
notificationSchema.index({ scheduledAt: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ 'metadata.category': 1 });
notificationSchema.index({ 'metadata.tags': 1 });

// Static methods
notificationSchema.statics.findByRecipient = function(recipientData) {
  const query = {};
  if (recipientData.userId) query['to.userId'] = recipientData.userId;
  if (recipientData.memberId) query['to.memberId'] = recipientData.memberId;
  if (recipientData.clientId) query['to.clientId'] = recipientData.clientId;
  if (recipientData.phone) query['to.phone'] = recipientData.phone;
  if (recipientData.email) query['to.email'] = recipientData.email;
  
  return this.find(query).sort({ createdAt: -1 });
};

notificationSchema.statics.findPendingScheduled = function() {
  return this.find({
    scheduledAt: { $lte: new Date() },
    canceled: false,
    $or: [
      { 'channels.sms': true, 'smsDelivery.status': 'pending' },
      { 'channels.email': true, 'emailDelivery.status': 'pending' }
    ]
  });
};

// Instance methods
notificationSchema.methods.addDeliveryHistory = function(channel, action, details = null, error = null, providerResponse = null) {
  const historyEntry = {
    at: new Date(),
    action,
    details,
    error,
    providerResponse
  };
  
  if (channel === 'sms') {
    this.smsDelivery.history.push(historyEntry);
  } else if (channel === 'email') {
    this.emailDelivery.history.push(historyEntry);
  }
};

notificationSchema.methods.updateDeliveryStatus = function(channel, status, additionalData = {}) {
  const delivery = channel === 'sms' ? this.smsDelivery : this.emailDelivery;
  
  delivery.status = status;
  
  if (additionalData.providerMessageId) {
    delivery.providerMessageId = additionalData.providerMessageId;
  }
  
  if (additionalData.error) {
    delivery.lastError = additionalData.error;
    delivery.errorCode = additionalData.errorCode;
  }
  
  // Update timestamp based on status
  const now = new Date();
  switch (status) {
    case 'sent':
      delivery.sentAt = now;
      break;
    case 'delivered':
      delivery.deliveredAt = now;
      break;
    case 'failed':
      delivery.failedAt = now;
      break;
    case 'canceled':
      delivery.canceledAt = now;
      break;
  }
  
  // Add to history
  this.addDeliveryHistory(channel, status, additionalData.details, additionalData.error, additionalData.providerResponse);
};

notificationSchema.methods.canRetry = function(channel) {
  const delivery = channel === 'sms' ? this.smsDelivery : this.emailDelivery;
  return delivery.status === 'failed' && delivery.attemptCount < this.maxRetries;
};

notificationSchema.methods.incrementAttempt = function(channel) {
  const delivery = channel === 'sms' ? this.smsDelivery : this.emailDelivery;
  delivery.attemptCount += 1;
};

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
