# Client Onboarding Flow

## Overview
Complete client onboarding process from lead to active contract with KYC verification and digital signature.

## Flow Steps

### 1. Lead Creation
**Entry Point:** Lead signup form or admin creation

**Process:**
- Lead submits company information
- Fields captured:
  - firstName, lastName
  - companyName, address, pincode
  - email, phone
  - numberOfEmployees
  - purpose (coworking_space, day_pass, meeting_room, etc.)
- Status: `new`
- Assigned to sales team member

**API:** `POST /api/leads`

**Model:** Lead
- Status progression: new → contacted → qualified → converted → lost

---

### 2. Lead to Client Conversion
**Trigger:** Admin converts qualified lead

**Process:**
- Create Client record from Lead data
- Link Lead.convertedToClient → Client._id
- Create User account if email/phone provided
- Create Member record if applicable
- Initialize ClientCreditWallet (balance: 0, creditValue: 500)

**API:** `POST /api/clients` (from lead data)

**Models Created:**
- Client (status: new, kycStatus: none)
- User (if credentials provided)
- Member (linked to client)
- ClientCreditWallet

---

### 3. Client Details Completion (4-Step Wizard)

#### Step 1: Basic Company Info
**Fields:**
- companyName, legalName
- contactPerson (descriptive)
- primarySalutation, primaryFirstName, primaryLastName (for Zoho)
- email, phone, website
- industry, companyAddress

**API:** `PUT /api/clients/:id/basic-details`

#### Step 2: Commercial Details
**Fields:**
- contactType (customer/vendor/both)
- customerSubType (business/individual)
- creditLimit, contactNumber
- paymentTerms, paymentTermsLabel
- isPortalEnabled
- notes

**API:** `PUT /api/clients/:id/commercial`

#### Step 3: Address Details
**Fields:**
- billingAddress (attention, address, street2, city, state, zip, country, phone)
- shippingAddress (same fields)
- Option: "Same as billing address"

**API:** `PUT /api/clients/:id/addresses`

#### Step 4: Contact Persons
**Fields (array):**
- salutation, first_name, last_name
- email, phone, mobile
- designation, department
- is_primary_contact (only one allowed)
- enable_portal
- communication_preference (SMS, WhatsApp)

**API:** `PUT /api/clients/:id/contacts`

**Completion:**
- Set companyDetailsComplete: true
- Update kycStatus: pending

---

### 4. KYC Verification
**Trigger:** Client uploads KYC documents

**Process:**
- Client uploads documents (GST, PAN, etc.)
- Admin reviews documents
- Status updates:
  - pending → verified (approved)
  - pending → rejected (with reason)

**API:** 
- `POST /api/clients/:id/kyc` (upload)
- `PUT /api/clients/:id/kyc/verify` (admin approval)

**On Verification:**
- kycStatus: verified
- Auto-create draft Contract

---

### 5. Contract Creation
**Trigger:** KYC verified

**Process:**
- Create Contract with:
  - client, building
  - startDate, endDate
  - capacity, monthlyRent
  - credit_enabled: true
  - allocated_credits (monthly allocation)
  - credit_value: 500 (₹/credit)
  - credit_terms_days: 30
  - status: draft

**API:** `POST /api/contracts`

**Model:** Contract
- Linked to Client and Building
- Contains credit system configuration

---

### 6. Digital Signature (Zoho Sign)
**Trigger:** Admin sends contract for signature

**Process:**
1. Admin initiates signature request
2. System calls Zoho Sign API:
   - Create document
   - Add recipient (client email)
   - Submit for signature
3. Contract status: draft → pending_signature
4. Client receives email with signature link
5. Client signs document
6. Webhook updates contract:
   - status: pending_signature → active
   - signedAt: timestamp
   - zohoSignRequestId stored

**API:** 
- `POST /api/contracts/:id/send-for-signature`
- `POST /api/contracts/zoho-webhook` (callback)
- `GET /api/contracts/:id/signature-status`

**Status Flow:** draft → pending_signature → active

---

### 7. Space Allocation
**Trigger:** Contract becomes active

**Process:**
- Admin allocates Cabin to client
- Create/allocate Desks within cabin
- Update Cabin:
  - allocatedTo: client._id
  - contract: contract._id
  - status: occupied
  - allocatedAt: timestamp
- Update Desk:
  - status: occupied
  - allocatedAt: timestamp
- Assign Member to specific Desk

**API:** 
- `POST /api/cabins/:id/allocate`
- `POST /api/desks/:id/allocate`

**Models Updated:**
- Cabin (allocatedTo, contract, status)
- Desk (status, allocatedAt)
- Member (desk reference)

---

### 8. Credit Wallet Initialization
**Trigger:** Contract activation

**Process:**
- Update ClientCreditWallet:
  - balance: contract.initialCredits
  - creditValue: contract.creditValueAtSignup || 500
  - status: active
- Create CreditTransaction:
  - transactionType: grant
  - creditsDelta: initialCredits
  - purpose: "Initial credit allocation"

**API:** `POST /api/credits/grant`

**Models:**
- ClientCreditWallet (balance updated)
- CreditTransaction (audit trail)

---

### 9. Zoho Books Sync
**Trigger:** Client creation/update

**Process:**
- Auto-sync client to Zoho Books as Contact
- Map fields:
  - companyName → contact_name
  - contactPersons → contact_persons array
  - billingAddress, shippingAddress
  - gstNo, gstTreatment
  - paymentTerms
- Store zohoBooksContactId for future reference
- Bi-directional sync via webhooks

**API:** Auto-triggered on client CRUD operations

**Webhook:** `POST /api/webhooks/zoho-books`

---

## Complete Flow Diagram

```
Lead Created
    ↓
Lead Qualified
    ↓
Convert to Client → Create User/Member → Initialize Wallet
    ↓
Complete Details (4 Steps)
    ↓
Upload KYC Documents
    ↓
Admin Verifies KYC
    ↓
Auto-Create Draft Contract
    ↓
Send for Digital Signature (Zoho Sign)
    ↓
Client Signs Contract
    ↓
Contract Activated
    ↓
Allocate Space (Cabin/Desk)
    ↓
Grant Initial Credits
    ↓
Sync to Zoho Books
    ↓
✓ Client Fully Onboarded
```

## Key Models Involved
- Lead
- Client
- User
- Member
- Contract
- ClientCreditWallet
- CreditTransaction
- Cabin
- Desk
- Building
- ActivityLog (audit trail)

## Integration Points
- **Zoho Sign:** Digital signature workflow
- **Zoho Books:** Contact sync, invoicing
- **SMS Service:** OTP and notifications
- **Email Service:** Welcome emails, notifications
