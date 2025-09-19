import mongoose from 'mongoose';

const creditCustomItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  code: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true
  },
  unit: {
    type: String,
    default: 'unit',
    trim: true,
    maxlength: 50
  },
  pricingMode: {
    type: String,
    enum: ['credits', 'inr'],
    required: true
  },
  unitCredits: {
    type: Number,
    min: 0,
    validate: {
      validator: function(value) {
        return this.pricingMode !== 'credits' || (value != null && value > 0);
      },
      message: 'unitCredits is required and must be positive when pricingMode is credits'
    }
  },
  unitPriceINR: {
    type: Number,
    min: 0,
    validate: {
      validator: function(value) {
        return this.pricingMode !== 'inr' || (value != null && value > 0);
      },
      message: 'unitPriceINR is required and must be positive when pricingMode is inr'
    }
  },
  taxable: {
    type: Boolean,
    default: true
  },
  gstRate: {
    type: Number,
    default: 18,
    min: 0,
    max: 100
  },
  active: {
    type: Boolean,
    default: true
  },
  zohoItemId: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
creditCustomItemSchema.index({ active: 1 });
creditCustomItemSchema.index({ pricingMode: 1 });
creditCustomItemSchema.index({ tags: 1 });
creditCustomItemSchema.index({ name: 'text', code: 'text' });

// Virtual for display name
creditCustomItemSchema.virtual('displayName').get(function() {
  return this.code ? `${this.name} (${this.code})` : this.name;
});

// Pre-save middleware
creditCustomItemSchema.pre('save', function(next) {
  // Auto-generate code if not provided
  if (!this.code && this.name) {
    this.code = this.name
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .toUpperCase()
      .substring(0, 20);
  }
  next();
});

// Instance methods
creditCustomItemSchema.methods.calculateAmount = function(quantity, creditValueINR = 500) {
  let subtotal = 0;
  
  if (this.pricingMode === 'credits') {
    subtotal = quantity * this.unitCredits * creditValueINR;
  } else {
    subtotal = quantity * this.unitPriceINR;
  }
  
  const tax = this.taxable ? subtotal * (this.gstRate / 100) : 0;
  return {
    subtotal,
    tax,
    total: subtotal + tax,
    credits: this.pricingMode === 'credits' ? quantity * this.unitCredits : 0
  };
};

// Static methods
creditCustomItemSchema.statics.findActive = function() {
  return this.find({ active: true }).sort({ name: 1 });
};

creditCustomItemSchema.statics.findByCategory = function(tags) {
  return this.find({ 
    active: true,
    tags: { $in: Array.isArray(tags) ? tags : [tags] }
  }).sort({ name: 1 });
};

const CreditCustomItem = mongoose.model('CreditCustomItem', creditCustomItemSchema);

export default CreditCustomItem;
