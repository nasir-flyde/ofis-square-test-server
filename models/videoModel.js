import mongoose from 'mongoose';

const { Schema } = mongoose;

const VideoSchema = new Schema({
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  description: { 
    type: String,
    trim: true
  },
  link: { 
    type: String, 
    required: true,
    trim: true
  },
  thumbnail: { 
    type: String, // URL for the thumbnail image
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'published'
  },
  createdBy: { 
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
VideoSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for efficient querying
VideoSchema.index({ status: 1, createdAt: -1 });
VideoSchema.index({ title: 'text', description: 'text' });

const Video = mongoose.model('Video', VideoSchema);
export default Video;
