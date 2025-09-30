import axios from 'axios';

class SMSProvider {
  constructor() {
    this.apiKey = process.env.SMS_API_KEY || '8jDnuC7fFniF77TC';
    this.baseUrl = 'https://www.smswaale.com/api/v1';
  }

  async send({ toPhone, text }) {
    try {
      // Clean phone number - remove any non-digits and ensure it starts with country code
      let cleanPhone = toPhone.replace(/\D/g, '');
      if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
        // Already has country code
      } else if (cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone;
      } else {
        throw new Error(`Invalid phone number format: ${toPhone}`);
      }

      const payload = {
        apikey: this.apiKey,
        mobile: cleanPhone,
        msg: text,
        senderid: 'OFISSQ', // You may need to register this sender ID
        response: 'json'
      };

      const response = await axios.post(`${this.baseUrl}/sendSMS`, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data && response.data.status === 'success') {
        return {
          success: true,
          providerMessageId: response.data.msgid || response.data.message_id,
          providerResponse: response.data
        };
      } else {
        throw new Error(response.data?.message || 'SMS sending failed');
      }
    } catch (error) {
      console.error('SMS Provider Error:', error);
      return {
        success: false,
        error: error.message,
        errorCode: error.response?.status?.toString() || 'NETWORK_ERROR',
        providerResponse: error.response?.data
      };
    }
  }

  async getDeliveryStatus(providerMessageId) {
    try {
      const response = await axios.get(`${this.baseUrl}/dlr`, {
        params: {
          apikey: this.apiKey,
          msgid: providerMessageId
        },
        timeout: 5000
      });

      return {
        success: true,
        status: response.data?.status || 'unknown',
        providerResponse: response.data
      };
    } catch (error) {
      console.error('SMS Status Check Error:', error);
      return {
        success: false,
        error: error.message,
        providerResponse: error.response?.data
      };
    }
  }
}

// Mock provider for testing
class MockSMSProvider {
  async send({ toPhone, text }) {
    console.log(`[MOCK SMS] To: ${toPhone}, Message: ${text}`);
    
    // Simulate random success/failure for testing
    const success = Math.random() > 0.1; // 90% success rate
    
    if (success) {
      return {
        success: true,
        providerMessageId: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        providerResponse: { status: 'sent', mock: true }
      };
    } else {
      return {
        success: false,
        error: 'Mock SMS failure for testing',
        errorCode: 'MOCK_ERROR',
        providerResponse: { status: 'failed', mock: true }
      };
    }
  }

  async getDeliveryStatus(providerMessageId) {
    return {
      success: true,
      status: 'delivered',
      providerResponse: { status: 'delivered', mock: true }
    };
  }
}

// Factory function to get the appropriate provider
export const getSMSProvider = () => {
  const useMock = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_SMS === 'true';
  return useMock ? new MockSMSProvider() : new SMSProvider();
};

export { SMSProvider, MockSMSProvider };
