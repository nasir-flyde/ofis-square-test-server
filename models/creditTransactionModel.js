import mongoose from "mongoose";

const creditTransactionSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: true,
    index: true
  },
  contractId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Contract",
    default: null
  },
  contractId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Contract",
    default: null
  },
  itemSnapshot: {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    unit: {
      type: String,
      default: 'unit',
      trim: true
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
        validator: function (value) {
          return this.itemSnapshot.pricingMode !== 'credits' || (value != null && value > 0);
        },
        message: 'unitCredits required when pricingMode is credits'
      }
    },
    unitPriceINR: {
      type: Number,
      min: 0,
      validate: {
        validator: function (value) {
          return this.itemSnapshot.pricingMode !== 'inr' || (value != null && value > 0);
        },
        message: 'unitPriceINR required when pricingMode is inr'
      }
    },
    taxable: {
      type: Boolean,
      default: true
    },
    gstRate: {
      type: Number,
      default: 18
    },
    zohoItemId: {
      type: String,
      default: null
    }
  },
  quantity: {
    type: Number,
    required: true,
    min: 0.01
  },
  transactionType: {
    type: String,
    enum: ["grant", "usage", "deduct", "refund"],
    required: true
  },
  pricingSnapshot: {
    pricingMode: {
      type: String,
      enum: ['credits', 'inr'],
      required: true
    },
    unitCredits: {
      type: Number,
      default: null
    },
    unitPriceINR: {
      type: Number,
      default: null
    },
    creditValueINR: {
      type: Number,
      required: true
    }
  },
  creditsDelta: {
    type: Number,
    required: true
  },
  amountINRDelta: {
    type: Number,
    required: true
  },
  purpose: {
    type: String,
    trim: true,
    maxlength: 500
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'completed'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  relatedInvoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },
  idempotencyKey: {
    type: String,
    default: null,
    sparse: true
  },
  metadata: {
    dayPassId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DayPass',
      default: null
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    customData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  }
}, {
  timestamps: true
});

// Indexes
creditTransactionSchema.index({ clientId: 1 });
creditTransactionSchema.index({ contractId: 1 });
creditTransactionSchema.index({ transactionType: 1 });
creditTransactionSchema.index({ status: 1 });
creditTransactionSchema.index({ createdBy: 1 });
creditTransactionSchema.index({ createdAt: -1 });
creditTransactionSchema.index({ relatedInvoiceId: 1 });

// Compound indexes
creditTransactionSchema.index({ clientId: 1, createdAt: -1 });
creditTransactionSchema.index({ clientId: 1, transactionType: 1 });

// Unique compound index for idempotency (when key is provided)
creditTransactionSchema.index(
  { clientId: 1, idempotencyKey: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { idempotencyKey: { $ne: null } }
  }
);


// Instance methods
creditTransactionSchema.methods.calculateTotals = function () {
  const { pricingMode, unitCredits, unitPriceINR, creditValueINR } = this.pricingSnapshot;
  let subtotal = 0;
  let credits = 0;

  if (pricingMode === 'credits') {
    credits = this.quantity * unitCredits;
    subtotal = credits * creditValueINR;
  } else {
    subtotal = this.quantity * unitPriceINR;
  }

  const tax = this.itemSnapshot.taxable ? subtotal * (this.itemSnapshot.gstRate / 100) : 0;

  return {
    subtotal,
    tax,
    total: subtotal + tax,
    credits,
    quantity: this.quantity
  };
};

// Static methods
creditTransactionSchema.statics.findByClient = function (clientId, options = {}) {
  const query = { clientId };
  if (options.status) query.status = options.status;
  if (options.transactionType) query.transactionType = options.transactionType;

  return this.find(query)
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });
};

creditTransactionSchema.statics.getUsageSummary = function (clientId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        clientId: mongoose.Types.ObjectId(clientId),
        transactionType: 'usage',
        status: 'completed',
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$itemSnapshot.name',
        itemName: { $first: '$itemSnapshot.name' },
        totalQuantity: { $sum: '$quantity' },
        totalCredits: { $sum: { $abs: '$creditsDelta' } },
        totalAmount: { $sum: { $abs: '$amountINRDelta' } },
        transactions: { $push: '$$ROOT' }
      }
    }
  ]);
};

const CreditTransaction = mongoose.model("CreditTransaction", creditTransactionSchema);

export default CreditTransaction;
