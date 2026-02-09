import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;
const INTERAKT_BASE_URL = process.env.INTERAKT_BASE_URL || 'https://api.interakt.ai/v1/public/message/';

export const sendWhatsAppOTP = async ({ phone, otp }) => {
    if (!phone || !otp) {
        throw new Error('Phone number and OTP are required');
    }

    const cleanPhone = phone.toString().replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
        throw new Error(`Invalid phone number format: ${phone}`);
    }

    const payload = {
        countryCode: "+91",
        phoneNumber: cleanPhone,
        callbackData: "OTP Verification",
        type: "Template",
        template: {
            name: "otp_verification",
            languageCode: "en",
            bodyValues: [
                otp
            ],
            buttonValues: {
                "0": [
                    otp
                ]
            }
        }
    };

    try {
        const response = await axios.post(INTERAKT_BASE_URL, payload, {
            headers: {
                'Authorization': `Basic ${INTERAKT_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`WhatsApp OTP sent to ${cleanPhone}:`, response.data);

        return {
            success: true,
            data: response.data,
            phone: cleanPhone
        };

    } catch (error) {
        console.error('Interakt WhatsApp send failed:', error.response?.data || error.message);
        // Don't throw logic error effectively, to match smsService throwing pattern or handle gracefully?
        // smsService throws, so we should too if we want catch block in controller to handle it.
        throw new Error(`Failed to send WhatsApp OTP: ${error.response?.data?.message || error.message}`);
    }
};
