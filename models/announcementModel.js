import mongoose from 'mongoose';

const { Schema } = mongoose;

const AnnouncementSchema = new Schema({
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  
  subtitle: { 
    type: String,
    trim: true
  },
  
  description: { 
    type: String,
    required: true
  },
  
  details: { 
    type: String // Rich text content for detailed information
  },
  
  // Location information
  location: {
    type: {
      type: String,
      enum: ['building', 'external', 'virtual', 'all'],
      default: 'all'
    },
    building: { 
      type: Schema.Types.ObjectId, 
      ref: "Building" 
    },
    address: { 
      type: String,
      trim: true
    },
    virtualLink: { 
      type: String,
      trim: true
    }
  },
  
  // External links
  externalLinks: [{
    label: { 
      type: String,
      required: true,
      trim: true
    },
    url: { 
      type: String,
      required: true,
      trim: true
    },
    icon: { 
      type: String,
      trim: true
    }
  }],
  
  // Images
  thumbnail: { 
    type: String // ImageKit URL for thumbnail/preview image
  },
  
  mainImage: { 
    type: String // ImageKit URL for main/banner image
  },
  
  gallery: [{ 
    type: String // Array of ImageKit URLs for additional images
  }],
  
  // Categorization and targeting
  category: {
    type: String,
    enum: ['general', 'event', 'maintenance', 'policy', 'community', 'facility', 'emergency', 'promotion'],
    default: 'general'
  },
  
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  
  // Audience targeting
  targetAudience: {
    type: String,
    enum: ['all', 'members', 'clients', 'guests', 'specific'],
    default: 'all'
  },
  
  specificBuildings: [{ 
    type: Schema.Types.ObjectId, 
    ref: "Building" 
  }],
  
  specificMembers: [{ 
    type: Schema.Types.ObjectId, 
    ref: "Member" 
  }],
  
  specificClients: [{ 
    type: Schema.Types.ObjectId, 
    ref: "Client" 
  }],
  
  // Scheduling
  publishDate: { 
    type: Date,
    default: Date.now
  },
  
  expiryDate: { 
    type: Date
  },
  
  // Status and visibility
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'published', 'archived', 'expired'],
    default: 'draft'
  },
  
  isPinned: { 
    type: Boolean, 
    default: false 
  },
  
  // Engagement tracking
  views: { 
    type: Number, 
    default: 0 
  },
  
  viewedBy: [{ 
    type: Schema.Types.ObjectId, 
    ref: "User" 
  }],
  
  likes: { 
    type: Number, 
    default: 0 
  },
  
  likedBy: [{ 
    type: Schema.Types.ObjectId, 
    ref: "User" 
  }],
  
  // Notification settings
  sendNotification: { 
    type: Boolean, 
    default: false 
  },
  
  notificationSentAt: { 
    type: Date 
  },
  
  // Metadata
  tags: [{ 
    type: String,
    trim: true
  }],
  
  author: { 
    type: Schema.Types.ObjectId, 
    ref: "User",
    required: true
  },
  
  lastEditedBy: { 
    type: Schema.Types.ObjectId, 
    ref: "User"
  },
  
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Update timestamp on save
AnnouncementSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Auto-update status based on dates
  const now = new Date();
  
  if (this.status === 'scheduled' && this.publishDate <= now) {
    this.status = 'published';
  }
  
  if (this.status === 'published' && this.expiryDate && this.expiryDate <= now) {
    this.status = 'expired';
  }
  
  next();
});

// Virtual for checking if announcement is active
AnnouncementSchema.virtual('isActive').get(function() {
  const now = new Date();
  return this.status === 'published' && 
         this.publishDate <= now && 
         (!this.expiryDate || this.expiryDate > now);
});

// Virtual for engagement rate
AnnouncementSchema.virtual('engagementRate').get(function() {
  if (this.views === 0) return 0;
  return ((this.likes / this.views) * 100).toFixed(2);
});

// Ensure virtuals are included in JSON output
AnnouncementSchema.set('toJSON', { virtuals: true });
AnnouncementSchema.set('toObject', { virtuals: true });

// Indexes for efficient querying
AnnouncementSchema.index({ status: 1, publishDate: -1 });
AnnouncementSchema.index({ category: 1, status: 1 });
AnnouncementSchema.index({ priority: 1, status: 1 });
AnnouncementSchema.index({ targetAudience: 1, status: 1 });
AnnouncementSchema.index({ isPinned: 1, publishDate: -1 });
AnnouncementSchema.index({ author: 1 });
AnnouncementSchema.index({ specificBuildings: 1 });
AnnouncementSchema.index({ tags: 1 });
AnnouncementSchema.index({ title: 'text', description: 'text', details: 'text' }); // Full-text search

const Announcement = mongoose.model('Announcement', AnnouncementSchema);
export default Announcement;
