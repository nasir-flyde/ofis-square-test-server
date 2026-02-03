import mongoose from 'mongoose';

const bankDetailsSchema = new mongoose.Schema({
    accountHolderName: {
        type: String,
        required: true,
        default: 'OFIS SPACES PRIVATE LIMITED'
    },
    bankName: {
        type: String,
        required: true,
        default: 'HDFC Bank Ltd.'
    },
    branchName: {
        type: String,
        required: true,
        default: 'MG Road, Gurgaon'
    },
    accountType: {
        type: String,
        required: true,
        default: 'Current Account'
    },
    accountNumber: {
        type: String,
        required: true,
        default: '5020 1234 5678'
    },
    ifscCode: {
        type: String,
        required: true,
        default: 'HDFC0009876'
    }
}, {
    timestamps: true
});

export default mongoose.model('BankDetails', bankDetailsSchema);
