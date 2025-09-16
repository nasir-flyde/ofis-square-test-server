import crypto from "crypto";

// Generate a secure webhook secret
export function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Create HMAC signature for webhook verification
export function createWebhookSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Verify webhook signature
export function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = createWebhookSignature(payload, secret);
  const expectedWithPrefix = `sha256=${expectedSignature}`;
  
  // Support multiple signature formats
  return signature === expectedSignature || 
         signature === expectedWithPrefix ||
         crypto.timingSafeEqual(
           Buffer.from(signature, 'hex'),
           Buffer.from(expectedSignature, 'hex')
         );
}

// Generate a simple API key for webhook authentication
export function generateApiKey() {
  return `zbw_${crypto.randomBytes(24).toString('hex')}`;
}
