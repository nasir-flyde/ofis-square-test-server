# Ofis Square - System Documentation

## Overview
Comprehensive documentation for all major workflows and features in the Ofis Square coworking space management system.

---

## Documentation Index

### 1. [Client Onboarding Flow](./ONBOARDING_FLOW.md)
Complete journey from lead to active client with workspace allocation.

**Covers:**
- Lead creation and qualification
- Client registration (4-step wizard)
- KYC verification process
- Contract creation and digital signature
- Space allocation (cabins and desks)
- Credit wallet initialization
- Zoho Books integration

**Key Stakeholders:** Sales team, Admin, Clients

---

### 2. [Day Pass System](./DAY_PASS_FLOW.md)
Guest and member day pass booking with QR code access.

**Covers:**
- Single day pass purchase
- Bundle packages (multi-pass)
- Guest vs Member flows
- Credit-based payments
- Visitor invitation and QR codes
- Check-in/check-out process
- Bundle management

**Key Stakeholders:** Guests, Members, Reception, Admin

---

### 3. [Meeting Room Bookings](./MEETING_ROOM_FLOW.md)
Complete meeting room reservation and management system.

**Covers:**
- Room availability checking
- Time slot booking
- Visitor management for meetings
- Amenity selection
- Credit and card payments
- Check-in process
- Cancellation and modifications

**Key Stakeholders:** Members, Clients, Reception, Admin

---

### 4. [Support Ticket System](./TICKET_SUPPORT_FLOW.md)
Issue tracking and resolution workflow.

**Covers:**
- Ticket creation and categorization
- Priority levels and SLA
- Assignment and routing
- Status tracking
- Resolution and closure
- Escalation process
- Reporting and analytics

**Key Stakeholders:** Members, Clients, Support Staff, Admin

---

### 5. [Credit System](./CREDIT_SYSTEM_FLOW.md)
Pre-paid credit wallet for simplified billing.

**Covers:**
- Credit wallet setup
- Monthly credit allocation
- Credit usage and deduction
- Exceeded credit billing
- Transaction tracking
- Custom items and services
- Month-end reconciliation

**Key Stakeholders:** Clients, Members, Accounts Team, Admin

---

### 6. [Visitor Management](./VISITOR_MANAGEMENT_FLOW.md)
Comprehensive visitor tracking from invitation to exit.

**Covers:**
- Visitor invitation process
- QR code generation
- Check-in/check-out procedures
- Different visitor types
- Security and compliance
- Recurring visitors
- Reception dashboard

**Key Stakeholders:** Members, Clients, Visitors, Reception, Security

---

### 7. [Invoice & Payment Processing](./INVOICE_PAYMENT_FLOW.md)
Automated invoicing and payment tracking.

**Covers:**
- Invoice types and generation
- Payment methods
- Draft payment approval
- Zoho Books integration
- Late payment handling
- Payment reconciliation
- Financial reporting

**Key Stakeholders:** Clients, Accounts Team, Admin

---

## Quick Reference

### User Roles

| Role | Access Level | Primary Functions |
|------|-------------|-------------------|
| **Admin** | Full system access | Manage all operations, users, settings |
| **Client** | Company-level access | Manage members, view invoices, bookings |
| **Member** | Individual access | Book services, raise tickets, use credits |
| **Guest** | Limited access | Purchase day passes, book visits |
| **Reception** | Operational access | Check-in/out, visitor management |
| **Support Staff** | Department access | Handle tickets, resolve issues |

---

### Key Concepts

#### Credits
- 1 Credit = ₹500
- Pre-paid wallet system
- Monthly allocation per contract
- Used for day passes, meetings, services
- Excess usage billed monthly

#### QR Codes
- Unique per visit/booking
- Contactless check-in/out
- Expires after use
- Sent via email/SMS
- Cannot be reused

#### Invoices
- Auto-generated for all transactions
- Synced with Zoho Books
- Multiple payment methods
- 30-day payment terms (standard)
- Late fees for overdue payments

#### Visitor Status
- Invited → Checked In → Checked Out
- QR code-based tracking
- Security compliance
- Audit trail maintained

---

### Integration Points

#### Zoho Books
- **Purpose:** Accounting and invoicing
- **Sync:** Bi-directional
- **Data:** Clients (Contacts), Invoices, Payments, Items
- **Webhooks:** Real-time updates

#### Zoho Sign
- **Purpose:** Digital contract signatures
- **Flow:** Draft → Send → Sign → Active
- **Status:** Real-time webhook updates

#### Razorpay
- **Purpose:** Payment gateway
- **Used For:** Day passes, meeting rooms, online payments
- **Features:** Card, UPI, Net Banking

#### SMS Service (SMSWaale)
- **Purpose:** OTP and notifications
- **Used For:** Authentication, alerts, reminders

---

### Common Workflows

#### New Client Onboarding
1. Lead created → Qualified → Converted to Client
2. Complete 4-step registration
3. Upload KYC documents
4. Admin verifies KYC
5. Contract created and sent for signature
6. Client signs digitally
7. Contract activated
8. Space allocated
9. Credits initialized
10. ✓ Client active

**Timeline:** 3-7 days

#### Day Pass Purchase
1. Guest registers
2. Selects building and date
3. Pays via Razorpay
4. Receives QR code
5. Visits on scheduled date
6. Checks in with QR
7. Accesses workspace
8. Checks out when leaving

**Timeline:** Instant booking, same-day or advance

#### Support Ticket Resolution
1. User raises ticket
2. Ticket auto-assigned
3. Staff acknowledges
4. Issue investigated
5. Resolution implemented
6. User verifies
7. Ticket closed

**Timeline:** 4 hours (urgent) to 7 days (low priority)

---

### Business Rules Summary

#### Credits
- Monthly allocation doesn't carry forward
- Always rounded up to nearest whole credit
- Excess usage billed monthly
- Non-transferable between clients

#### Bookings
- Maximum 30 days advance booking
- Cancellation: 24 hours for full refund
- No-show: No refund
- Modifications: Subject to availability

#### Payments
- Prepaid: Day passes, meeting rooms
- Postpaid: Monthly rent, excess credits
- Payment terms: Net 30 days
- Late fee: 2% per month

#### Visitors
- QR code mandatory for check-in
- ID verification required
- Badge must be visible
- Host responsible for visitor conduct

---

### Support & Contacts

#### For Users:
- **General Queries:** support@ofissquare.com
- **Billing Issues:** accounts@ofissquare.com
- **Technical Support:** tech@ofissquare.com
- **Emergency:** Building reception

#### For Admins:
- **System Issues:** Contact development team
- **Zoho Integration:** Check webhook logs
- **Payment Gateway:** Razorpay dashboard
- **Reports:** Admin analytics section

---

## Document Updates

**Last Updated:** January 2025

**Version:** 1.0

**Maintained By:** Ofis Square Operations Team

**Review Cycle:** Quarterly

---

## Feedback

Found an error or need clarification? Contact: documentation@ofissquare.com

Suggestions for improvement are always welcome!
