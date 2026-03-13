import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const SMS_API_KEY = process.env.SMSWAALE_API_KEY || 'nPc9tXq6w8CeJims';
const SMS_SENDER_ID = process.env.SMSWAALE_SENDER_ID || 'EXPROS';
const SMS_BASE_URL = 'http://sms.smswaale.com/V2/http-api.php';

export const SendSMS = async ({ phone, message }) => {
  // Validate inputs
  if (!phone || !message) {
    throw new Error('Phone number and message are required');
  }

  // Clean and validate phone number to 10 digits
  const cleanPhone = phone.toString().replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    throw new Error(`Invalid phone number format: ${phone}`);
  }

  const params = {
    apikey: SMS_API_KEY,
    senderid: SMS_SENDER_ID,
    number: `91${cleanPhone}`,
    message: message.trim(),
    format: 'json',
  };

  // Debug log with masked key
  console.log('📤 Sending SMS:', {
    ...params,
    apikey: '***' + (SMS_API_KEY ? SMS_API_KEY.slice(-4) : 'hidden')
  });

  try {
    const response = await axios.get(SMS_BASE_URL, {
      params,
      timeout: 10000,
    });

    console.log('📱 SMS API Response:', response.data);

    if (response.data?.status === 'success' || response.data?.status === 'OK' || response.data?.status === '1') {
      return {
        success: true,
        data: response.data,
        phone: cleanPhone,
      };
    }

    console.error('❌ SMS API Error Content:', response.data);
    throw new Error(`SMS API returned error: ${JSON.stringify(response.data)}`);
  } catch (error) {
    console.error('❌ SMS sending failed:', {
      phone: cleanPhone,
      errorMessage: error.message,
      response: error.response?.data
    });
    throw new Error(`Failed to send SMS to ${cleanPhone}: ${error.message}`);
  }
};

export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
