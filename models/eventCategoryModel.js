import mongoose from 'mongoose';

const { Schema } = mongoose;

const EventCategorySchema = new Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  color: { type: String, default: '#3B82F6' }, // hex color for UI
  icon: { type: String }, // icon name or URL
  subcategories: [{ type: String }],
  isActive: { type: Boolean, default: true },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
EventCategorySchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Indexes
EventCategorySchema.index({ name: 1 });
EventCategorySchema.index({ isActive: 1 });

const EventCategory = mongoose.model('EventCategory', EventCategorySchema);
export default EventCategory;
