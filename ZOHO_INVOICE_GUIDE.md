# 🧾 Zoho Books Invoice Integration Guide

## Overview
End-to-end invoice creation and management integrated with Zoho Books v3 (zohoapis.com). Supports the full lifecycle: local invoice → push to Zoho → email → payment → reconciliation via webhook → manual sync.

## 🔧 Environment Setup

Add these variables to your `.env` file:

```env
# Zoho OAuth (server-to-server via refresh token)
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REFRESH_TOKEN=your_refresh_token

# Zoho Books Configuration
ZOHO_BOOKS_ORG_ID=123456789
# Optional override (defaults to https://books.zohoapis.com/api/v3)
ZOHO_BOOKS_BASE_URL=https://books.zohoapis.com/api/v3

# Optional branding
COMPANY_NAME=Your Company Name

# Webhook security (shared secret header you configure in Zoho)
ZOHO_WEBHOOK_SECRET=your_shared_secret_value
```

Token handling: the backend uses an access token (`Zoho-oauthtoken`) to call Books. Ensure your deployment refreshes this token using the refresh token when it expires. The helper in `utils/zohoBooks.js` is designed to work with a valid access token; wire in automatic refresh where deployed.

## 📋 End-to-End Workflow

### 1) Create a local invoice (MongoDB)

Endpoint: `POST /api/invoices`

Payload (simplified):
```json
{
  "client": "<clientObjectId>",
  "billingPeriod": { "start": "2025-09-01", "end": "2025-09-30" },
  "issueDate": "2025-09-05",
  "dueDate": "2025-09-30",
  "items": [ { "description": "Monthly Rent", "quantity": 1, "unitPrice": 15000 } ],
  "discount": { "type": "flat", "value": 0 },
  "taxes": [ { "name": "GST", "rate": 18, "amount": 2700 } ],
  "notes": "Thank you for your business."
}
```

What happens:
- Local invoice number is generated like `INV-YYYY-MM-0001`.
- Totals are computed server-side (`subtotal`, `taxes`, `total`, `balanceDue`).

### 2) Push invoice to Zoho Books

Endpoint: `POST /api/invoices/:id/push-zoho` (requires auth)

What happens:
- We find or create the Zoho Contact (by email if available).
- We map local items to Zoho `line_items` and set `reference_number` to local `invoiceNumber`.
- A Zoho invoice is created. We store `zohoInvoiceId`, `zohoInvoiceNumber`, `invoice_url`, `pdf_url`, and `status`.

### 3) Email the invoice via Zoho

Endpoint: `POST /api/invoices/:id/send` (requires auth)

Payload (optional):
```json
{ "to": ["client@example.com"], "subject": "Your Invoice", "customMessage": "Please find your invoice attached." }
```

What happens:
- Sends Zoho’s email for that invoice. We mark `sentAt` and local `zohoStatus = sent`.

### 4) Payment processing

- Automatic (recommended): configure Zoho Books webhook to POST to `/api/invoices/webhook/zoho`.
  - On `invoice_payment_made`/`payment_created`, we update local `amountPaid`, `balanceDue`, `status`, `paidAt`.

- Manual record: `POST /api/invoices/:id/payments`
```json
{ "amount": 17000, "date": "2025-09-06", "payment_mode": "Cash", "reference_number": "CHQ001234" }
```

### 5) Status synchronization

Endpoint: `POST /api/invoices/:id/sync` (requires auth)

What happens:
- Fetches the Zoho invoice and updates local `zohoStatus`, `invoiceUrl/pdfUrl`, `amountPaid`/`balanceDue`.

## 💳 Payment Link (optional utility)

Zoho supports generating a payment link for an invoice.

Books API: `GET /share/paymentlink` with query params:
- `organization_id` (we pass org via header internally)
- `transaction_id` = Zoho `invoice_id`
- `transaction_type` = `invoice`
- `link_type` = `public` | `private`
- `expiry_time` = `YYYY-MM-DD`

We plan to expose a helper endpoint: `GET /api/invoices/:id/payment-link` which will return a payment URL using the above API.

## 🔗 API Endpoints (as implemented)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`  | `/api/invoices` | no  | List local invoices (filters supported via query) |
| `POST` | `/api/invoices` | yes | Create a local invoice |
| `GET`  | `/api/invoices/:id` | yes | Get a local invoice by id |
| `PATCH`| `/api/invoices/:id/status` | yes | Update local status and/or amountPaid |
| `POST` | `/api/invoices/:id/push-zoho` | yes | Create the invoice in Zoho Books and store IDs |
| `POST` | `/api/invoices/:id/send` | yes | Email the Zoho invoice to client |
| `POST` | `/api/invoices/:id/sync` | yes | Pull latest status/details from Zoho |
| `GET`  | `/api/invoices/:id/pdf` | yes | Get Zoho `pdf_url`/`invoice_url` |
| `GET`  | `/api/invoices/:id/download-pdf` | yes | Generate and stream local PDF (pdfmake) |
| `POST` | `/api/invoices/:id/payments` | yes | Record a manual payment locally (and adjust aggregates) |
| `POST` | `/api/invoices/webhook/zoho` | no  | Webhook endpoint for Zoho Books events |

Notes:
- The previously documented routes like `/api/invoices/from-contract` and `/api/invoices/client/{clientId}` are not present in the current router. Use the listed routes above.

## 🎯 Invoice Status Flow (local)

```
draft → issued → paid
  ↓         ↓
  └──── overdue
```

**Status definitions**
- `draft`: Created locally, not sent/pushed.
- `issued`: Created and active (locally and/or in Zoho).
- `overdue`: Past `dueDate` and unpaid.
- `paid`: Fully paid (based on aggregates or Zoho sync).
- `void`: Invalidated locally (does not call Zoho void automatically).

## 🔔 Webhook Configuration

1) In Zoho Books, go to Settings → Automation → Webhooks.
2) URL: `https://yourdomain.com/api/invoices/webhook/zoho`
3) Events:
   - `invoice_payment_made`
   - `payment_created`
   - `invoice_status_changed`
   - `invoice_sent`
4) Security: configure a custom header like `X-Zoho-Webhook-Secret: <your value>` and set the same value in `ZOHO_WEBHOOK_SECRET`. Reject requests not carrying this header.

### Sample Events

```json
// Payment Made
{
  "event_type": "invoice_payment_made",
  "data": { "invoice_id": "9876543210001", "amount": 17000, "payment_id": "pay_123", "date": "2025-09-06" }
}

// Status Changed
{
  "event_type": "invoice_status_changed",
  "data": { "invoice_id": "9876543210001", "status": "sent" }
}
```

## 💾 MongoDB Shapes (simplified)

### Invoices (`models/invoiceModel.js`)
```js
{
  _id: ObjectId,
  client: ObjectId,
  invoiceNumber: "INV-2025-09-0001",
  issueDate: ISODate,
  dueDate: ISODate,
  billingPeriod: { start: ISODate, end: ISODate },
  items: [{ description, quantity, unitPrice, amount }],
  subtotal: Number,
  discount: { type: "percent"|"flat", value, amount },
  taxes: [{ name, rate, amount }],
  total: Number,
  amountPaid: Number,
  balanceDue: Number,
  status: "draft"|"issued"|"paid"|"overdue"|"void",
  notes: String,
  // Zoho fields
  zohoInvoiceId: String,
  zohoInvoiceNumber: String,
  zohoStatus: String,
  zohoPdfUrl: String,
  invoiceUrl: String,
  sentAt: ISODate,
  paidAt: ISODate,
  paymentId: String,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

### Clients (recommended enhancement)
Store and reuse the Zoho Contact ID to avoid duplicates when email is missing.
```js
{
  _id: ObjectId,
  companyName: "Acme Pvt Ltd",
  email: "client@acme.com",
  zohoBooksContactId: "1234567890001"
}
```

## 🚀 Quick Usage Examples

### Create → Push → Send → Sync
```js
// 1) Create local
await fetch('/api/invoices', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client: 'client_123', billingPeriod: { start: '2025-09-01', end: '2025-09-30' }, items: [{ description: 'Workspace Rent', quantity: 1, unitPrice: 10000 }] })
});

// 2) Push to Zoho
await fetch(`/api/invoices/${invoiceId}/push-zoho`, { method: 'POST' });

// 3) Send via Zoho
await fetch(`/api/invoices/${invoiceId}/send`, { method: 'POST', body: JSON.stringify({ to: ['client@example.com'] }) });

// 4) Sync later
await fetch(`/api/invoices/${invoiceId}/sync`, { method: 'POST' });
```

## 🔍 Error Handling & Tips

- Zoho API failures return detailed messages; check `error.response` for Books `code` and `message`.
- Missing client email: contact creation falls back to company name; prefer storing `zohoBooksContactId` on `Client`.
- Access token expiry: implement refresh using `ZOHO_REFRESH_TOKEN` and retry once on 401.
- Webhook: validate `ZOHO_WEBHOOK_SECRET` header and log events for audit.

## 🎉 Benefits

- Automated workflow: local → Zoho → payment → reconciliation
- Real-time updates via webhook
- Flexible billing with multiple items and discounts
- Payment link support (optional utility)
- Clear audit of invoice and payment history

---

This guide reflects the current implementation in `controllers/invoiceController.js`, `utils/zohoBooks.js`, `routes/invoices.js`, and `models/invoiceModel.js`.
