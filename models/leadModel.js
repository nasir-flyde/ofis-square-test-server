import mongoose from "mongoose";

const leadSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  pincode: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^\d{6}$/.test(v);
      },
      message: 'Pincode must be 6 digits'
    }
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^\d{10}$/.test(v.replace(/\D/g, ''));
      },
      message: 'Please enter a valid 10-digit phone number'
    }
  },
  numberOfEmployees: {
    type: Number,
    required: true,
    min: [1, 'Number of employees must be at least 1']
  },
  purpose: {
    type: String,
    required: true,
    enum: ['coworking_space', 'day_pass', 'meeting_room', 'private_office', 'virtual_office', 'event_space'],
    trim: true
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'converted', 'lost'],
    default: 'new'
  },
  // KYC fields for day pass users
  kycDocuments: {
    files: [{
      type: String, // Array of URLs to uploaded documents
      trim: true
    }]
  },
  kycStatus: {
    type: String,
    enum: ['not_submitted', 'pending', 'approved', 'rejected'],
    default: 'not_submitted'
  },
  kycRejectionReason: {
    type: String,
    trim: true
  },
  kycApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  kycApprovedAt: {
    type: Date
  },
  userCreated: {
    type: Boolean,
    default: false
  },
  createdUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  source: {
    type: String,
    default: 'website_signup'
  },
  notes: {
    type: String,
    trim: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  convertedToClient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  lastContactedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for efficient queries
leadSchema.index({ email: 1 });
leadSchema.index({ phone: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ createdAt: -1 });

// Virtual for full name
leadSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Ensure virtual fields are serialized
leadSchema.set('toJSON', { virtuals: true });

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;
