import mongoose from "mongoose";

const { Schema } = mongoose;

const notificationTemplateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },

    // Channels supported flags (informational)
    channels: {
      sms: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      push: { type: Boolean, default: false },
      inApp: { type: Boolean, default: false },
    },

    // Template content
    content: {
      sms: { type: String },
      emailSubject: { type: String },
      emailHtml: { type: String },
      emailText: { type: String },
      inAppTitle: { type: String },
      inAppBody: { type: String },
      buttonText: { type: String },
      buttonLink: { type: String },
    },

    // Classification
    category: { type: String },
    tags: [{ type: String }],

    // Controls
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 1 },

    // Optional defaults for metadata (deep links etc.)
    defaults: {
      metadata: {
        deepLink: { type: String },
        route: { type: String },
        routeParams: { type: Schema.Types.Mixed },
        priority: {
          type: String,
          enum: ["low", "normal", "high"],
          default: "normal",
        },
        category: { type: String },
        tags: [{ type: String }],
      },
    },

    // Layout Design
    templateDesignId: { type: Schema.Types.ObjectId, ref: "TemplateDesign" },

    // Audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

notificationTemplateSchema.index({ key: 1 }, { unique: true });
notificationTemplateSchema.index({ name: 1 });
notificationTemplateSchema.index({ category: 1 });
notificationTemplateSchema.index({ tags: 1 });
notificationTemplateSchema.index({ isActive: 1 });

const NotificationTemplate = mongoose.model(
  "NotificationTemplate",
  notificationTemplateSchema
);

export default NotificationTemplate;
