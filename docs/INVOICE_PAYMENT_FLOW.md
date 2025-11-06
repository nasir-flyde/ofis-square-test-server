# Invoice & Payment Flow

## Overview
Automated invoicing system integrated with Zoho Books for seamless billing, payment tracking, and financial management.

---

## Types of Invoices

### 1. Regular Invoices
**Generated For:**
- Monthly rent
- Day pass purchases
- Meeting room bookings
- One-time services
- Custom items

**Characteristics:**
- Single transaction billing
- Immediate payment expected
- Standard payment terms

### 2. Credit Monthly Invoices
**Generated For:**
- Exceeded credit allocation
- Month-end credit reconciliation
- Consolidated credit usage

**Characteristics:**
- Monthly billing cycle
- Only for excess usage
- 30-day payment terms
- Itemized breakdown

---

## Invoice Generation Flow

### Automatic Invoice Creation

#### Scenario 1: Day Pass Purchase
**Trigger:** Day pass payment successful

**What Happens:**
1. System creates invoice immediately
2. Invoice details:
   - Customer: Guest or Member
   - Item: Day pass for [Building] on [Date]
   - Amount: Day pass price
   - GST: 18%
   - Total: Amount + GST
3. Invoice number generated (e.g., INV-2025-0042)
4. Status: Paid (since payment already received)
5. Linked to day pass record
6. Synced to Zoho Books

#### Scenario 2: Meeting Room Booking
**Trigger:** Meeting room payment successful

**What Happens:**
1. Invoice created with:
   - Meeting room details
   - Date and time slot
   - Amenities charged
   - Base rate + amenities
   - GST: 18%
2. Status: Paid
3. Linked to booking record
4. Synced to Zoho Books

#### Scenario 3: Monthly Rent
**Trigger:** Start of billing cycle

**What Happens:**
1. Invoice generated on 1st of month
2. Details:
   - Monthly rent amount
   - Allocated credits value
   - Total package amount
3. Due date: As per contract terms
4. Status: Sent
5. Email sent to client
6. Synced to Zoho Books

#### Scenario 4: Exceeded Credits
**Trigger:** End of month credit reconciliation

**What Happens:**
1. System calculates:
   - Total credits used: 28
   - Allocated credits: 20
   - Excess: 8 credits
2. Creates invoice:
   - Line items by service type
   - Credits used per service
   - Amount: 8 × ₹500 = ₹4,000
   - GST: ₹720
   - Total: ₹4,720
3. Status: Sent
4. Payment terms: 30 days
5. Synced to Zoho Books

---

## Invoice Details Explained

### Invoice Number Format:
- **Local:** INV-2025-0042
  - INV = Invoice prefix
  - 2025 = Year
  - 0042 = Sequential number
- **Zoho Books:** Separate numbering (e.g., INV-000123)

### Invoice Contains:

**Header Information:**
- Invoice number
- Invoice date
- Due date
- Client/Guest details
- Billing address
- GST number (if applicable)

**Line Items:**
Each service listed separately:
- Description (e.g., "Day Pass - Building A - Jan 15, 2025")
- Quantity
- Unit price
- Tax rate
- Line total

**Summary:**
- Subtotal (before tax)
- Discount (if any)
- Tax amount (GST 18%)
- **Total Amount**
- Amount paid (if any)
- **Balance Due**

**Payment Information:**
- Payment terms (e.g., Net 30)
- Due date
- Payment methods accepted
- Bank details

**Notes:**
- Terms and conditions
- Late payment policy
- Contact for queries

---

## Invoice Status Flow

### Status Progression:

```
Draft → Sent → Partially Paid → Paid
   ↓
Issued (for prepaid items like day pass)
```

**Draft:**
- Invoice created but not finalized
- Can be edited
- Not sent to client
- Not synced to Zoho

**Sent:**
- Invoice finalized and sent to client
- Email delivered
- Awaiting payment
- Synced to Zoho Books

**Issued:**
- For prepaid services
- Payment already received
- No action needed from client
- Synced to Zoho Books

**Partially Paid:**
- Some payment received
- Balance still due
- Partial payment recorded
- Reminder sent for balance

**Paid:**
- Full payment received
- Invoice closed
- Receipt generated
- No further action needed

---

## Payment Processing

### Payment Methods Accepted:

**For Invoices:**
- Bank Transfer (NEFT/RTGS/IMPS)
- UPI
- Credit/Debit Card
- Cheque
- Online Banking

**For Immediate Purchases:**
- Razorpay Gateway (Card/UPI/Net Banking)
- Credit Wallet (Members only)

### Payment Recording

#### Automatic (via Razorpay):
1. Customer pays via payment gateway
2. Payment success callback received
3. System creates payment record
4. Links to invoice
5. Updates invoice status
6. Sends receipt to customer

#### Manual (Bank Transfer):
1. Client makes bank transfer
2. Client uploads payment proof
3. Creates draft payment record
4. Admin reviews and approves
5. Payment linked to invoice
6. Invoice status updated
7. Confirmation sent to client

#### Via Zoho Books Webhook:
1. Payment recorded in Zoho Books
2. Webhook sent to our system
3. System finds matching invoice
4. Creates payment record
5. Updates invoice balance
6. Status updated automatically

---

## Complete Payment Journey

### For Day Pass (Prepaid):
```
Select Day Pass → Add to Cart → Checkout
    ↓
Razorpay Payment Gateway Opens
    ↓
Customer Pays → Payment Success
    ↓
Invoice Auto-Created (Status: Paid)
    ↓
Day Pass Issued → Receipt Emailed
    ↓
Synced to Zoho Books
```

### For Monthly Rent:
```
Start of Month → Invoice Generated
    ↓
Invoice Sent to Client (Email)
    ↓
Client Reviews Invoice
    ↓
Client Makes Payment (Bank Transfer)
    ↓
Client Uploads Payment Proof
    ↓
Admin Reviews → Approves Payment
    ↓
Invoice Status: Paid → Receipt Sent
    ↓
Synced to Zoho Books
```

### For Exceeded Credits:
```
End of Month → Credit Usage Calculated
    ↓
Excess Credits Identified
    ↓
Invoice Generated (Itemized)
    ↓
Invoice Sent to Client
    ↓
30-Day Payment Terms
    ↓
Client Pays → Payment Recorded
    ↓
Invoice Closed → Synced to Zoho
```

---

## Draft Payment System

### What is Draft Payment?
- Client-submitted payment proof
- Awaiting admin approval
- Used for bank transfers, cheques
- Ensures payment verification before crediting

### Client Submits Draft Payment:

**Step 1: Upload Payment Details**
- Select invoice to pay
- Choose payment method:
  - Bank Transfer
  - UPI
  - Cash
  - Cheque
  - Card
- Enter reference number (transaction ID)
- Enter amount paid
- Upload screenshots/proof (up to 5 files)
- Add notes (optional)

**Step 2: Submission**
- Draft payment created
- Status: Pending
- Admin notified
- Client receives acknowledgment

### Admin Reviews:

**Step 3: Verification**
- Admin views draft payment
- Checks payment proof
- Verifies amount
- Confirms bank transaction
- Reviews reference number

**Step 4: Decision**
- **Approve:**
  - Creates official payment record
  - Links to invoice
  - Updates invoice balance
  - Status: Paid (if full) or Partially Paid
  - Client notified
  - Receipt sent
  
- **Reject:**
  - Adds rejection reason
  - Client notified
  - Client can resubmit with corrections

---

## Zoho Books Integration

### Two-Way Sync:

#### From Our System to Zoho:
**When Invoice Created:**
1. Invoice generated locally
2. Pushed to Zoho Books API
3. Zoho creates matching invoice
4. Returns Zoho invoice ID
5. We store Zoho ID for reference

**Data Synced:**
- Client details (as Contact)
- Invoice line items
- Amounts and taxes
- Payment terms
- Due dates

#### From Zoho to Our System:
**When Payment Received in Zoho:**
1. Payment recorded in Zoho Books
2. Zoho sends webhook to our system
3. We receive payment data
4. Find matching invoice by Zoho ID
5. Create payment record
6. Update invoice status
7. Send confirmation to client

**Benefits:**
- Single source of truth
- Real-time synchronization
- Automatic reconciliation
- Reduced manual work
- Accurate accounting

---

## Late Payment Handling

### Payment Terms:
- **Standard:** Net 30 (payment due in 30 days)
- **Contract-Specific:** As per agreement
- **Prepaid Services:** Immediate payment

### Overdue Process:

**Day 1-7 (Grace Period):**
- Friendly reminder email
- No penalties
- Payment link included

**Day 8-15:**
- Second reminder
- Late fee warning
- Phone call from accounts team

**Day 16-30:**
- Final notice
- Late fee applied (2% per month)
- Service suspension warning

**Day 31+:**
- Services suspended
- Credit facility revoked
- Legal notice (if significant amount)
- Contract termination possible

### Late Fees:
- 2% per month on outstanding amount
- Calculated from due date
- Added to next invoice
- Waived for first-time delays (discretionary)

---

## Client Invoice Dashboard

### My Invoices Section:

**Filters:**
- All invoices
- Unpaid invoices
- Paid invoices
- Overdue invoices
- By date range

**Information Displayed:**
- Invoice number
- Date and due date
- Amount and balance
- Status
- Download PDF
- Payment options

**Actions Available:**
- View invoice details
- Download PDF
- Submit payment proof
- Pay online (if enabled)
- Dispute invoice
- Request payment plan

---

## Admin Invoice Management

### Dashboard Features:

**Overview:**
- Total invoices this month
- Total revenue
- Outstanding amount
- Overdue invoices count
- Collection rate

**Invoice List:**
- All invoices across clients
- Filter by status, client, date
- Bulk actions
- Export to Excel/CSV

**Actions:**
- Create manual invoice
- Edit draft invoices
- Send/resend invoices
- Record payments
- Apply discounts
- Write off bad debts
- Generate reports

---

## Reporting & Analytics

### Financial Reports:

**Revenue Reports:**
- Monthly revenue breakdown
- Service-wise revenue
- Client-wise revenue
- Building-wise revenue
- Payment method analysis

**Outstanding Reports:**
- Aging report (30/60/90 days)
- Client-wise outstanding
- Overdue invoices
- Collection forecast

**Payment Reports:**
- Payments received
- Payment methods used
- Average payment time
- Collection efficiency

**Tax Reports:**
- GST collected
- Tax liability
- Input tax credit
- GST returns ready data

---

## Best Practices

### For Clients:
1. **Review Promptly:** Check invoices as soon as received
2. **Pay on Time:** Avoid late fees and service disruption
3. **Keep Records:** Download and save all invoices
4. **Upload Proof:** Submit payment proof immediately after paying
5. **Query Early:** Raise disputes within 7 days
6. **Use Reference:** Always mention invoice number in payments

### For Admins:
1. **Timely Generation:** Send invoices on schedule
2. **Accurate Details:** Double-check amounts and items
3. **Quick Approval:** Review draft payments within 24 hours
4. **Follow Up:** Send reminders for overdue payments
5. **Reconcile Daily:** Match payments with invoices
6. **Sync Check:** Ensure Zoho Books sync is working

---

## Common Scenarios

### Scenario 1: Partial Payment
**Client pays ₹5,000 on ₹10,000 invoice**
- Payment recorded: ₹5,000
- Invoice status: Partially Paid
- Balance: ₹5,000
- Reminder sent for balance

### Scenario 2: Overpayment
**Client pays ₹12,000 on ₹10,000 invoice**
- Payment recorded: ₹12,000
- Invoice status: Paid
- Excess: ₹2,000 (credit balance)
- Applied to next invoice or refunded

### Scenario 3: Multiple Invoices Payment
**Client pays ₹25,000 for 3 invoices**
- Payment allocated across invoices
- Each invoice updated proportionally
- Payment application recorded
- All invoices status updated

### Scenario 4: Refund
**Service cancelled, refund needed**
- Original invoice marked as cancelled
- Credit note issued
- Refund processed
- New invoice generated (if partial refund)

---

## Troubleshooting

**Invoice Not Received:**
- Check spam folder
- Verify email address
- Download from portal
- Contact support

**Payment Not Reflected:**
- Allow 24-48 hours for bank transfers
- Check if draft payment submitted
- Verify reference number
- Contact accounts team

**Zoho Sync Failed:**
- System retries automatically
- Manual sync available
- Admin notified of failures
- Resolved within 24 hours
