import apiLogger from './apiLogger.js';
import crypto from 'crypto';

/**
 * Logged wrapper for Razorpay API calls
 */
class LoggedRazorpay {
  constructor() {
    this.service = 'razorpay';
    this.keyId = process.env.RAZORPAY_KEY_ID || "rzp_test_02U4mUmreLeYrU";
    this.keySecret = process.env.RAZORPAY_KEY_SECRET;
    this.baseUrl = 'https://api.razorpay.com/v1';
  }

  /**
   * Create order with logging
   */
  async createOrder(orderData, { userId = null, clientId = null, relatedEntity = null, relatedEntityId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'create_order',
      userId,
      clientId,
      relatedEntity,
      relatedEntityId,
      maxAttempts: 3,
      retryCondition: (response, responseBody) => {
        if (response?.status >= 500) return true;
        if (response?.status === 429) return true;
        return false;
      }
    });

    try {
      const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
      
      const response = await loggedFetch(`${this.baseUrl}/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderData)
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.description || result.message || 'Razorpay API error');
      }

      return result;
    } catch (error) {
      console.error('Razorpay create order error:', error);
      throw error;
    }
  }

  /**
   * Fetch payment details with logging
   */
  async fetchPayment(paymentId, { userId = null, clientId = null, relatedEntity = null, relatedEntityId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'fetch_payment',
      userId,
      clientId,
      relatedEntity,
      relatedEntityId,
      maxAttempts: 2
    });

    try {
      const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
      
      const response = await loggedFetch(`${this.baseUrl}/payments/${paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.description || result.message || 'Razorpay API error');
      }

      return result;
    } catch (error) {
      console.error('Razorpay fetch payment error:', error);
      throw error;
    }
  }

  /**
   * Capture payment with logging
   */
  async capturePayment(paymentId, amount, { userId = null, clientId = null, relatedEntity = null, relatedEntityId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'capture_payment',
      userId,
      clientId,
      relatedEntity,
      relatedEntityId,
      maxAttempts: 2
    });

    try {
      const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
      
      const response = await loggedFetch(`${this.baseUrl}/payments/${paymentId}/capture`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.description || result.message || 'Razorpay API error');
      }

      return result;
    } catch (error) {
      console.error('Razorpay capture payment error:', error);
      throw error;
    }
  }

  /**
   * Create refund with logging
   */
  async createRefund(paymentId, refundData, { userId = null, clientId = null, relatedEntity = null, relatedEntityId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'create_refund',
      userId,
      clientId,
      relatedEntity,
      relatedEntityId,
      maxAttempts: 2
    });

    try {
      const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
      
      const response = await loggedFetch(`${this.baseUrl}/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(refundData)
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.description || result.message || 'Razorpay API error');
      }

      return result;
    } catch (error) {
      console.error('Razorpay create refund error:', error);
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(body, signature, secret = null) {
    try {
      const webhookSecret = secret || process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.warn('Razorpay webhook secret not configured');
        return false;
      }

      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      return signature === expectedSignature;
    } catch (error) {
      console.error('Razorpay webhook signature verification error:', error);
      return false;
    }
  }

  /**
   * Log webhook received
   */
  async logWebhook({
    method = 'POST',
    url,
    headers = {},
    body,
    signature = null,
    verified = false,
    event = null,
    statusCode = 200,
    responseBody = null,
    success = true,
    errorMessage = null,
    userAgent = null,
    ipAddress = null
  }) {
    return await apiLogger.logIncomingWebhook({
      service: this.service,
      operation: 'webhook_received',
      method,
      url,
      headers,
      requestBody: body,
      webhookSignature: signature,
      webhookVerified: verified,
      webhookEvent: event,
      statusCode,
      responseBody,
      success,
      errorMessage,
      userAgent,
      ipAddress
    });
  }

  /**
   * Get payment configuration for frontend
   */
  getPaymentConfig(amount, currency = 'INR', orderId = null) {
    return {
      key: this.keyId,
      amount: amount * 100, // Convert to paise
      currency,
      order_id: orderId,
      name: process.env.COMPANY_NAME || 'Ofis Square',
      description: 'Payment for services',
      theme: {
        color: '#3399cc'
      }
    };
  }
}

// Create singleton instance
const loggedRazorpay = new LoggedRazorpay();

export default loggedRazorpay;
