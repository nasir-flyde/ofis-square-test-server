import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const SMS_API_KEY = process.env.SMSWAALE_API_KEY || 'nPc9tXq6w8CeJims';
const SMS_SENDER_ID = process.env.SMSWAALE_SENDER_ID || 'EXPROS';
const SMS_BASE_URL = 'http://sms.smswaale.com/V2/http-api-post.php';

export const SendSMS = async ({ phone, message }) => {
  try {
    const normalizedPhone = phone.replace(/\D/g, '');
    
    // For domestic SMS in India, use 10-digit number without country code
    const phoneNumber = normalizedPhone.startsWith('91') 
      ? normalizedPhone.substring(2) 
      : normalizedPhone;

    const payload = {
      apikey: SMS_API_KEY,
      senderid: SMS_SENDER_ID,
      number: phoneNumber,
      message: message
    };

    const response = await axios.post(SMS_BASE_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.data && (response.data.status === 'OK' || response.status === 200)) {
      console.log('SMS sent successfully:', response.data);
      return { success: true, data: response.data };
    } else {
      console.error('SMS API error:', response.data);
      throw new Error(response.data?.message || 'SMS sending failed');
    }
  } catch (error) {
    console.error('SMS service error:', error);
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
};

export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
