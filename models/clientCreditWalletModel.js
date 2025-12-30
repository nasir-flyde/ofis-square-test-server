import mongoose from "mongoose";

const clientCreditWalletSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: true,
    unique: true,
    index: true
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: "Balance must be an integer"
    }
  },
  creditValue: {
    type: Number,
    required: true,
    default: 500, // INR per credit
    min: 0
  },
  // Separate printer credits tracking
  printerBalance: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: "Printer balance must be an integer"
    }
  },
  printerCreditValue: {
    type: Number,
    required: true,
    default: 1, // default unit value per printer credit (configurable)
    min: 0
  },
  currency: {
    type: String,
    default: "INR",
    enum: ["INR", "USD"]
  },
  expiresAt: {
    type: Date,
    default: null // null means no expiry
  },
  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active"
  }
}, {
  timestamps: true
});

clientCreditWalletSchema.index({ client: 1 }, { unique: true });
clientCreditWalletSchema.index({ status: 1 });

const ClientCreditWallet = mongoose.model("ClientCreditWallet", clientCreditWalletSchema);

export default ClientCreditWallet;
