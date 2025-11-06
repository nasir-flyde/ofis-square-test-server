# RBAC Implementation Summary - Contract Onboarding Workflow

## Overview
Implemented comprehensive Role-Based Access Control (RBAC) system for the new client onboarding workflow with multi-stage contract approval process.

---

## ✅ Completed Tasks

### 1. Backend Permissions System
**File:** `ofis-square/constants/permissions.js`

**New Permissions Added:**
- `CONTRACT_SEND_TO_CLIENT` - Send contract to client for review
- `CONTRACT_MARK_CLIENT_APPROVED` - Mark client as approved
- `CONTRACT_GENERATE_STAMP_PAPER` - Generate stamp paper version
- `CLIENT_APPROVE` - Approve client
- `CLIENT_APPROVE_ONBOARDING` - Final onboarding approval
- `PAYMENT_APPROVE` - Approve payments
- `INVENTORY_READ/UPDATE/BLOCK` - Inventory management

**New Roles Defined:**
1. **Sales** - Client creation, contract drafting, submission to Legal
2. **Legal Team** - Contract review, drafting, Admin submission, Zoho Sign
3. **Senior Management** - Contract approval/rejection, final oversight
4. **Finance Senior** - Invoice/payment management, financial operations
5. **Operations Senior** - Access provisioning, inventory, member management
6. **Operations Junior** - Day-to-day operations, member support
7. **Community Senior** - Event management, member engagement
8. **Community Junior** - Member support, event assistance

---

### 2. Frontend Permissions System
**File:** `ofis-square-frontend/src/constants/permissions.js`

- Mirrored all backend permissions
- Ready for UI permission gating
- Helper functions: `hasPermission()`, `hasAnyPermission()`, `hasAllPermissions()`

---

### 3. Contract Model Updates
**File:** `ofis-square/models/contractModel.js`

**New Status Values:**
- `draft` → `submitted_to_legal` → `legal_reviewed` → `pending_admin_approval`
- `admin_approved` → `sent_to_client` → `client_approved`
- `stamp_paper_ready` → `sent_for_signature` → `signed`
- Rejection paths: `admin_rejected`, `client_feedback_pending`

**New Fields:**
- `submittedToLegalBy/At` - Sales submission tracking
- `submittedToAdminBy/At` - Legal submission tracking
- `adminApprovedBy/At` - Admin approval tracking
- `adminRejectedBy/At/Reason` - Admin rejection tracking
- `approvalType` - full/partial approval
- `approvalConditions` - Conditions for partial approval
- `sentToClientBy/At` - Client communication tracking
- `clientEmail` - Client email for agreement
- `clientApprovedAt` - Client approval timestamp
- `clientFeedback/At` - Client feedback tracking
- `stampPaperUrl/GeneratedAt` - Stamp paper tracking
- `signatureProvider/EnvelopeId` - E-signature tracking
- `signedBy` - Signature details
- `version` - Version control
- `lastActionBy/At` - Last action tracking
- `comments[]` - Comment thread (review/internal/client)

---

### 4. Contract Workflow Controller
**File:** `ofis-square/controllers/contractWorkflowController.js`

**New Endpoints Implemented:**

| Endpoint | Permission | Description |
|----------|-----------|-------------|
| `POST /:id/submit-to-legal` | `contract:submit` | Sales → Legal |
| `POST /:id/submit-to-admin` | `contract:submit` | Legal → Admin |
| `POST /:id/admin-approve` | `contract:approve` | Admin approval |
| `POST /:id/admin-reject` | `contract:reject` | Admin rejection |
| `POST /:id/send-to-client` | `contract:send_to_client` | Legal → Client |
| `POST /:id/mark-client-approved` | `contract:mark_client_approved` | Mark approved |
| `POST /:id/client-feedback` | `contract:update` | Record feedback |
| `POST /:id/generate-stamp-paper` | `contract:generate_stamp_paper` | Generate stamp |
| `POST /:id/send-for-esignature` | `contract:send_signature` | Zoho Sign |
| `POST /:id/mark-signed` | `contract:update` | Mark signed |
| `POST /:id/comments` | `contract:read` | Add comment |
| `GET /status/:status` | `contract:read` | Filter by status |

**Features:**
- State machine validation (prevents invalid transitions)
- Audit logging for all transitions
- Comment threading support
- Version control
- Idempotency checks

---

### 5. Routes with Permission Enforcement
**File:** `ofis-square/routes/contracts.js`

- All new workflow endpoints registered
- Permission middleware applied to each route
- Uses `requirePermission()` middleware
- Integrated with existing RBAC system

---

### 6. Role Seeding Script
**File:** `ofis-square/scripts/seedNewRoles.js`

**Features:**
- Creates/updates all 8 new roles
- Idempotent (safe to run multiple times)
- Detailed permission breakdown
- Grouped permission display by category
- Success/error reporting

**Usage:**
```bash
cd ofis-square
node scripts/seedNewRoles.js
```

---

## 🔄 Contract Workflow States

```
draft
  ↓ (Sales submits to Legal)
submitted_to_legal
  ↓ (Legal reviews and submits to Admin)
pending_admin_approval
  ↓ (Admin approves)
admin_approved
  ↓ (Legal sends to Client)
sent_to_client
  ↓ (Client approves)
client_approved
  ↓ (Legal generates stamp paper)
stamp_paper_ready
  ↓ (Legal sends via Zoho Sign)
sent_for_signature
  ↓ (Client signs)
signed
```

**Rejection Paths:**
- Admin rejects → back to `draft`
- Client feedback → back to `draft`

---

## 📋 Role Permission Matrix

### Sales
- Client: create, read, update
- Contract: create, read, update, submit
- Invoice/Payment: read
- Reports: read

### Legal Team
- Client: read
- Contract: read, update, submit, send_to_client, mark_client_approved, generate_stamp_paper, send_signature
- Integration: read
- Reports: read

### Senior Management (Admin)
- Contract: read, approve, reject
- Client: read, update, approve, approve_onboarding
- Invoice: read, approve
- Payment: read, approve
- Late Fee: waive
- Reports: read, export
- Transaction: read, monitor
- User: read, update, assign_role
- Integration: read, update

### Finance Senior
- Client: create, read, update
- Contract: create, read, update, submit
- Invoice: create, read, update, generate, send, approve
- Payment: create, read, update, process, refund
- Late Fee: create, read, apply, waive
- Reports: read, export
- Transaction: read, monitor

### Operations Senior
- Client: create, read, update
- Contract: read, update
- Invoice: read, update
- Payment: read, create
- Member: create, read, update, activate, deactivate, assign_workspace, manage_access
- Booking: create, read, update, approve, cancel
- Ticket: read, update, assign, resolve
- Inventory: read, update, block
- Reports: read, export

### Operations Junior
- Client: read, update
- Contract: read
- Invoice/Payment: read
- Member: create, read, update, manage_access
- Booking: create, read, update
- Ticket: create, read, update
- Inventory: read
- Reports: read

### Community Senior
- Client: read
- Member: create, read, update, activate, deactivate, manage_access
- Event: create, read, update, delete, publish
- Booking: create, read, update, approve, cancel
- Ticket: create, read, update, assign, resolve
- Reports: read

### Community Junior
- Client: read
- Member: read, update
- Event: read, update
- Booking: create, read, update
- Ticket: create, read, update
- Reports: read

---

## 🎯 Next Steps

### High Priority
1. **Frontend UI Implementation**
   - Create contract detail page with status-based action buttons
   - Implement permission-based button visibility
   - Add comment thread UI
   - Create status timeline component
   - Add approval/rejection modals

2. **Testing**
   - Test each role's access to endpoints
   - Verify state transitions
   - Test permission enforcement
   - Validate audit logging

### Medium Priority
1. **Notifications**
   - Email notifications for each transition
   - In-app notifications
   - Notification preferences

2. **User Assignment**
   - Migrate existing users to new roles
   - Create admin UI for role assignment

### Low Priority
1. **Documentation**
   - API documentation for new endpoints
   - User guide for each role
   - Admin guide for role management

---

## 🔧 Configuration Required

### Environment Variables
No new environment variables required. Uses existing:
- `MONGO_URI` - Database connection
- Zoho Sign credentials (already configured)

### Database Migration
Run the role seeding script:
```bash
cd ofis-square
node scripts/seedNewRoles.js
```

---

## 📝 API Usage Examples

### Submit to Legal
```javascript
POST /api/contracts/:id/submit-to-legal
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Contract submitted to Legal team for review",
  "contract": { ... }
}
```

### Admin Approve
```javascript
POST /api/contracts/:id/admin-approve
Authorization: Bearer <token>
Content-Type: application/json

{
  "approvalType": "full",
  "conditions": "Optional conditions for partial approval"
}

Response:
{
  "success": true,
  "message": "Contract approved by Admin",
  "contract": { ... }
}
```

### Admin Reject
```javascript
POST /api/contracts/:id/admin-reject
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "Pricing needs revision"
}

Response:
{
  "success": true,
  "message": "Contract rejected and returned to draft",
  "contract": { ... }
}
```

### Add Comment
```javascript
POST /api/contracts/:id/comments
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Please review the payment terms",
  "type": "review"  // review | internal | client
}

Response:
{
  "success": true,
  "message": "Comment added to contract",
  "contract": { ... }
}
```

---

## 🔒 Security Features

1. **Permission Enforcement** - All routes protected by permission middleware
2. **State Validation** - Invalid transitions blocked at controller level
3. **Audit Logging** - All actions logged with user, timestamp, metadata
4. **Version Control** - Contract version incremented on each change
5. **Idempotency** - Safe to retry operations
6. **Comment Threading** - Maintains audit trail of discussions

---

## 📊 Monitoring & Debugging

### Activity Logs
All workflow transitions are logged to the activity logs system with:
- Action type (e.g., `CONTRACT_SUBMITTED_TO_LEGAL`)
- Entity type (`Contract`)
- Entity ID
- User who performed action
- Metadata (previous status, new status, reasons, etc.)

### Contract Comments
Each contract maintains a comment thread for:
- Review comments (Legal, Admin feedback)
- Internal notes (team coordination)
- Client feedback (external communication)

---

## ✅ Implementation Status

- ✅ Backend permissions defined
- ✅ Frontend permissions defined
- ✅ Contract model updated
- ✅ Workflow controller implemented
- ✅ Routes with permission enforcement
- ✅ Role seeding script created
- ✅ Audit logging integrated
- ⏳ Frontend UI (pending)
- ⏳ Testing (pending)
- ⏳ User migration (pending)

---

**Last Updated:** 2025-11-04
**Version:** 1.0
