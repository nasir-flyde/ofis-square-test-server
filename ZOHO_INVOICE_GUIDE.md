# 🧾 Zoho Books Invoice Integration Guide

## Overview
Complete end-to-end invoice creation and management system integrated with Zoho Books API. Supports the full invoice lifecycle from creation to payment reconciliation.

## 🔧 Environment Setup

Add these variables to your `.env` file:

```env
# Zoho OAuth Credentials
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REFRESH_TOKEN=your_refresh_token

# Zoho Books Configuration
ZOHO_BOOKS_ORG_ID=123456789
ZOHO_DC=accounts.zoho.com  # or .in, .eu, .com.cn

# Optional
COMPANY_NAME=Your Company Name
```

## 📋 Complete Invoice Workflow

### Stage 1: Contract Activation → Invoice Creation

When a contract becomes active, you can automatically create invoices:

```javascript
// POST /api/invoices/from-contract
{
  "contractId": "contract_id_here",
  "billingPeriod": "September 2025"
}
```

### Stage 2: Manual Invoice Creation

Create invoices with multiple line items:

```javascript
// POST /api/invoices
{
  "clientId": "client_id_here",
  "lineItems": [
    {
      "name": "Dedicated Cabin - Monthly",
      "rate": 15000,
      "quantity": 1,
      "description": "Private workspace rental"
    },
    {
      "name": "Meeting Room Credits",
      "rate": 500,
      "quantity": 4,
      "description": "4 hours of meeting room usage"
    }
  ],
  "notes": "Thank you for choosing our workspace!",
  "terms": "Payment due within 7 days.",
  "dueDate": "2025-09-12"
}
```

**Response:**
```json
{
  "success": true,
  "invoice": {
    "_id": "mongo_invoice_id",
    "zohoInvoiceId": "9876543210001",
    "invoiceNumber": "INV-0001",
    "amount": 17000,
    "status": "draft"
  },
  "message": "Invoice created successfully. Use sendInvoice endpoint to email it to client."
}
```

### Stage 3: Send Invoice to Client

Mark invoice as sent and email to client:

```javascript
// POST /api/invoices/{invoice_id}/send
{
  "to": ["client@example.com"],  // Optional - uses client email by default
  "subject": "Your Invoice from Workspace Co",  // Optional
  "customMessage": "Dear Client, please find your invoice attached..."  // Optional
}
```

**What happens:**
1. Invoice status changes from `draft` → `sent` in Zoho Books
2. Email sent to client with PDF attachment and payment link
3. MongoDB invoice updated with `status: "sent"` and `sentAt` timestamp

### Stage 4: Payment Processing

#### Automatic via Webhook (Recommended)

When client pays through Zoho's payment gateway:

1. **Zoho Books** processes payment
2. **Webhook** sent to `/api/invoices/webhook/zoho`
3. **MongoDB** automatically updated:
   - `status: "paid"`
   - `paidAt: payment_date`
   - `paymentId: zoho_payment_id`

#### Manual Payment Recording

```javascript
// POST /api/invoices/{invoice_id}/payments
{
  "amount": 17000,
  "date": "2025-09-06",
  "payment_mode": "Cash",
  "reference_number": "CHQ001234"
}
```

### Stage 5: Status Synchronization

Sync invoice status with Zoho Books:

```javascript
// POST /api/invoices/{invoice_id}/sync
```

## 🔗 API Endpoints Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/invoices` | Create new invoice |
| `POST` | `/api/invoices/from-contract` | Create invoice from contract |
| `GET` | `/api/invoices/{id}` | Get invoice details |
| `GET` | `/api/invoices/client/{clientId}` | List client invoices |
| `POST` | `/api/invoices/{id}/send` | Send invoice to client |
| `POST` | `/api/invoices/{id}/sync` | Sync status with Zoho |
| `POST` | `/api/invoices/{id}/payments` | Record manual payment |
| `GET` | `/api/invoices/{id}/pdf` | Get PDF download URL |
| `POST` | `/api/invoices/webhook/zoho` | Zoho Books webhook |

## 🎯 Invoice Status Flow

```
draft → sent → paid
  ↓       ↓      ↓
  ↓    overdue   ↓
  ↓       ↓   partial
  └───────┴──────┘
```

**Status Definitions:**
- `draft`: Created but not sent
- `sent`: Emailed to client
- `paid`: Fully paid
- `partial`: Partially paid
- `overdue`: Past due date
- `unpaid`: Legacy status

## 🔔 Webhook Configuration

### Setup in Zoho Books

1. Go to **Settings** → **Automation** → **Webhooks**
2. Add webhook URL: `https://yourdomain.com/api/invoices/webhook/zoho`
3. Select events:
   - `invoice_payment_made`
   - `invoice_status_changed`
   - `invoice_sent`

### Webhook Events Handled

```javascript
// Payment Made
{
  "event_type": "invoice_payment_made",
  "data": {
    "invoice_id": "9876543210001",
    "amount": 17000,
    "payment_id": "pay_123",
    "date": "2025-09-06"
  }
}

// Status Changed
{
  "event_type": "invoice_status_changed",
  "data": {
    "invoice_id": "9876543210001",
    "status": "sent"
  }
}
```

## 💾 MongoDB Collections

### Invoices Collection
```javascript
{
  "_id": ObjectId,
  "client": ObjectId,  // Reference to clients collection
  "zohoInvoiceId": "9876543210001",
  "invoiceNumber": "INV-0001",
  "amount": 17000,
  "status": "paid",
  "dueDate": ISODate,
  "invoiceUrl": "https://books.zoho.com/...",
  "lineItems": [
    {
      "name": "Dedicated Cabin",
      "rate": 15000,
      "quantity": 1,
      "description": "Monthly rental"
    }
  ],
  "notes": "Thank you for your business!",
  "terms": "Payment due within 7 days.",
  "paidAt": ISODate,
  "sentAt": ISODate,
  "paymentId": "pay_123",
  "paidAmount": 17000,
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```

### Clients Collection Enhancement
```javascript
{
  "_id": ObjectId,
  "companyName": "Acme Pvt Ltd",
  "email": "client@acme.com",
  "zohoBooksContactId": "1234567890001",  // Auto-created
  // ... other client fields
}
```

## 🚀 Usage Examples

### Complete Flow Example

```javascript
// 1. Create Invoice
const invoice = await fetch('/api/invoices', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId: 'client_123',
    lineItems: [
      { name: 'Workspace Rent', rate: 10000, quantity: 1 }
    ]
  })
});

// 2. Send to Client
await fetch(`/api/invoices/${invoice.id}/send`, {
  method: 'POST'
});

// 3. Client pays via Zoho link (automatic webhook updates status)

// 4. Check status
const status = await fetch(`/api/invoices/${invoice.id}`);
console.log(status.invoice.status); // "paid"
```

### Contract-Based Billing

```javascript
// Monthly billing for all active contracts
const activeContracts = await Contract.find({ status: 'active' });

for (const contract of activeContracts) {
  await fetch('/api/invoices/from-contract', {
    method: 'POST',
    body: JSON.stringify({
      contractId: contract._id,
      billingPeriod: 'September 2025'
    })
  });
}
```

## 🔍 Error Handling

The system includes comprehensive error handling:

- **Zoho API failures**: Detailed error messages with API response
- **Missing clients**: Automatic Zoho customer creation
- **Duplicate invoices**: Prevention via status checks
- **Webhook failures**: Graceful degradation with manual sync option

## 🎉 Benefits

✅ **Automated Workflow**: Contract → Invoice → Payment → Reconciliation  
✅ **Real-time Updates**: Webhook-driven status synchronization  
✅ **Flexible Billing**: Support for multiple line items and services  
✅ **Payment Integration**: Built-in Zoho payment gateway support  
✅ **Audit Trail**: Complete payment and status history  
✅ **Error Recovery**: Manual sync and payment recording options  

## 🔧 Troubleshooting

### Common Issues

1. **"Client email required"**: Ensure client has email in MongoDB
2. **"Failed to create Zoho contact"**: Check Zoho Books permissions
3. **"Invoice missing zohoInvoiceId"**: Re-create invoice or check Zoho API
4. **Webhook not working**: Verify webhook URL and Zoho configuration

### Manual Recovery

```javascript
// Sync all invoices with Zoho
const invoices = await Invoice.find({ status: { $ne: 'paid' } });
for (const inv of invoices) {
  await fetch(`/api/invoices/${inv._id}/sync`, { method: 'POST' });
}
```

---

**Ready to use!** Your invoice system now supports the complete Zoho Books integration workflow. 🎯
