import BankDetails from '../models/bankDetailsModel.js';

// @desc    Get bank details
// @route   GET /api/bank-details
// @access  Public (or Private depending on needs, usually Public for billing display)
export const getBankDetails = async (req, res) => {
    try {
        // Try to find existing bank details
        let bankDetails = await BankDetails.findOne();

        // If none exist, create the default one provided in the requirements
        if (!bankDetails) {
            bankDetails = await BankDetails.create({
                accountHolderName: 'OFIS SPACES PRIVATE LIMITED',
                bankName: 'HDFC Bank Ltd.',
                branchName: 'MG Road, Gurgaon',
                accountType: 'Current Account',
                accountNumber: '5020 1234 5678',
                ifscCode: 'HDFC0009876'
            });
        }

        res.status(200).json({
            success: true,
            data: bankDetails
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server Error',
            error: error.message
        });
    }
};
