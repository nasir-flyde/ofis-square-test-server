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

    // Debug log with masked key
    console.log('📤 Sending WhatsApp OTP via Interakt:', {
        ...payload,
        phoneNumber: `***${payload.phoneNumber.slice(-4)}`
    });

    try {
        const response = await axios.post(INTERAKT_BASE_URL, payload, {
            headers: {
                'Authorization': `Basic ${INTERAKT_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ WhatsApp OTP API Response for ${cleanPhone}:`, response.data);

        return {
            success: true,
            data: response.data,
            phone: cleanPhone
        };

    } catch (error) {
        console.error('❌ Interakt WhatsApp send failed:', {
            phone: cleanPhone,
            error: error.response?.data || error.message
        });
        throw new Error(`Failed to send WhatsApp OTP: ${JSON.stringify(error.response?.data) || error.message}`);
    }
};
