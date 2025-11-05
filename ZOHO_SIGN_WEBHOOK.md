# Zoho Sign Webhook Configuration

This document explains how to configure and use the Zoho Sign webhook in the ofis-square project.

## Webhook Endpoints

The webhook system provides several endpoints:

### Main Webhook Endpoint
- **URL**: `POST /api/webhooks/zoho-sign`
- **Purpose**: Primary endpoint for Zoho Sign webhook events
- **Authentication**: HMAC SHA256 signature verification (optional)

### Alternative Endpoints
- `POST /api/webhooks/zoho-sign/events`
- `POST /api/webhooks/zoho/sign`

### Health Check
- **URL**: `GET /api/webhooks/health`
- **Purpose**: Monitor webhook service health

### Test Endpoint (Development Only)
- **URL**: `POST /api/webhooks/test`
- **Purpose**: Test webhook processing in development environment

## Environment Variables

Add these to your `.env` file:

```env
# Optional: Webhook signature verification secret
ZOHO_SIGN_WEBHOOK_SECRET=your_webhook_secret_here

# Required: Zoho Sign API credentials (already configured)
ZOHO_SIGN_ACCESS_TOKEN=your_access_token
ZOHO_SIGN_REFRESH_TOKEN=your_refresh_token
ZOHO_DC=accounts.zoho.in
```

## Zoho Sign Configuration

1. **Login to Zoho Sign Admin Panel**
   - Go to your Zoho Sign account
   - Navigate to Settings > Webhooks

2. **Create New Webhook**
   - **Webhook URL**: `https://yourdomain.com/api/webhooks/zoho-sign`
   - **Events to Subscribe**:
     - Request Signed
     - Request Declined
     - Request Expired
     - Request Completed
     - Document Signed
     - Document Declined

3. **Security (Optional)**
   - Enable webhook signature verification
   - Set the secret in `ZOHO_SIGN_WEBHOOK_SECRET` environment variable

## Supported Events

The webhook handles the following Zoho Sign events:

### Request Status Events
- `completed` / `signed` → Contract status: `active`
- `declined` / `rejected` → Contract status: `draft` (for re-sending)
- `expired` → Contract status: `draft` (for re-sending)
- `in_progress` / `sent` → Contract status: `pending_signature`

### Event Type Events
- `REQUEST_SIGNED` / `DOCUMENT_SIGNED` → Contract activated
- `REQUEST_DECLINED` / `DOCUMENT_DECLINED` → Contract reset to draft
- `REQUEST_EXPIRED` → Contract reset to draft

## Automatic Actions

When a contract is signed and activated via webhook:

1. **Contract Status Update**: Changed from `pending_signature` to `active`
2. **Timestamp Recording**: `signedAt` field is set
3. **Invoice Generation**: Automatic invoice creation with:
   - Issue on activation
   - Prorated billing
   - Security deposit included
   - 7-day payment terms

## Testing

### Health Check
```bash
curl -X GET https://yourdomain.com/api/webhooks/health
```

### Test Webhook (Development)
```bash
curl -X POST https://yourdomain.com/api/webhooks/test \
  -H "Content-Type: application/json"
```

### Manual Webhook Test
```bash
curl -X POST https://yourdomain.com/api/webhooks/zoho-sign \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "your_test_request_id",
    "request_status": "completed",
    "event_type": "REQUEST_SIGNED",
    "recipient_email": "test@example.com"
  }'
```

## Logging

The webhook system provides comprehensive logging:

- Incoming webhook events
- Signature verification results
- Contract status updates
- Invoice creation results
- Error handling

Check your application logs for webhook processing details.

## Security Considerations

1. **Use HTTPS**: Always configure webhooks with HTTPS URLs
2. **Signature Verification**: Enable webhook signature verification in production
3. **IP Whitelisting**: Consider whitelisting Zoho Sign IP addresses
4. **Rate Limiting**: Implement rate limiting for webhook endpoints

## Troubleshooting

### Common Issues

1. **Webhook Not Triggered**
   - Verify webhook URL is accessible from internet
   - Check Zoho Sign webhook configuration
   - Ensure correct event subscriptions

2. **Signature Verification Failed**
   - Verify `ZOHO_SIGN_WEBHOOK_SECRET` matches Zoho configuration
   - Check webhook payload format

3. **Contract Not Found**
   - Ensure contract has `zohoSignRequestId` field set
   - Verify request_id in webhook payload matches database

4. **Invoice Creation Failed**
   - Check invoice service configuration
   - Verify contract has required fields (client, building, pricing)

### Debug Mode

Set `NODE_ENV=development` to enable:
- Test webhook endpoint
- Detailed error logging
- Webhook payload debugging
