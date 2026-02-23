import mongoose from "mongoose";

const leadSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: false,
    trim: true
  },
  firstName: {
    type: String,
    required: false,
    trim: true
  },
  lastName: {
    type: String,
    required: false,
    trim: true
  },
  companyName: {
    type: String,
    required: false,
    trim: true
  },
  address: {
    type: String,
    required: false,
    trim: true
  },
  pincode: {
    type: String,
    required: false,
    trim: true,
    validate: {
      validator: function (v) {
        if (!v) return true;
        return /^\d{6}$/.test(v);
      },
      message: 'Pincode must be 6 digits'
    }
  },
  email: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (v) {
        if (!v) return true;
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
      validator: function (v) {
        return /^\d{10}$/.test(v.replace(/\D/g, ''));
      },
      message: 'Please enter a valid 10-digit phone number'
    }
  },
  city: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: false
  },
  isTermsAndConditionsAccepted: {
    type: Boolean,
    default: false
  },
  whatAreYouLookingFor: {
    type: String,
    trim: true
  },
  workingAs: {
    type: String,
    trim: true
  },
  kindOfWork: {
    type: String,
    trim: true
  },
  budget: {
    type: String,
    trim: true
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  industry: {
    type: String,
    trim: true,
    required: false
  },
  jobTitle: {
    type: String,
    trim: true,
    required: false
  },
  workDescription: {
    type: String,
    trim: true,
    required: false
  },
  moveInTimeline: {
    type: String,
    trim: true,
    required: false
  },
  monthlyBudget: {
    type: String,
    trim: true,
    required: false
  },
  bookATour: {
    type: Boolean,
    default: false
  },
  numberOfEmployees: {
    type: Number,
    required: false,
    min: [1, 'Number of employees must be at least 1']
  },
  purpose: {
    type: String,
    required: false,
    enum: ['coworking_space', 'day_pass', 'meeting_room', 'private_office', 'virtual_office', 'event_space', 'private_cabin', 'single_desk', 'ondemand'],
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
  gender: {
    type: String,
    lowercase: true,
    trim: true
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

// virtual for fullName removed as it is now a field

// Ensure virtual fields are serialized
leadSchema.set('toJSON', { virtuals: true });

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;
