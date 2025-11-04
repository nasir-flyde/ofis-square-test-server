# RBAC Implementation Guide

## Overview

This document describes the Role-Based Access Control (RBAC) system implemented for the ofis-square admin panel. The system provides fine-grained permission control with 5 predefined roles and a contract approval workflow.

## Architecture

```
User → Role → Permissions → Actions
```

- Each user has **ONE role** (stored in `user.role` field)
- Each role has **multiple permissions** (array of permission strings)
- Permissions follow the format: `resource:action` (e.g., `contract:create`)

## Roles & Permissions

### 1. Contract Creator
**Description:** Creates and manages contracts

**Permissions:**
- `contract:create` - Create new contracts
- `contract:read` - View contracts
- `contract:update` - Edit contracts
- `contract:submit` - Submit contracts for approval
- `client:read` - View client information
- `report:read` - View reports

**Workflow:**
1. Create contract → Status: `draft`
2. Edit contract (optional)
3. Submit contract → Status: `pending_approval`
4. Wait for approval from Approver/Admin

---

### 2. Approver / Finance Admin
**Description:** Approves contracts and invoices

**Permissions:**
- `contract:create` - Create new contracts
- `contract:read` - View all contracts
- `contract:update` - Edit any contract
- `contract:submit` - Submit contracts
- `contract:approve` - **Approve/reject contracts**
- `contract:reject` - Reject contracts
- `contract:send_signature` - Send for signature
- `invoice:read` - View invoices
- `invoice:approve` - Approve invoices
- `invoice:update` - Edit invoices
- `payment:read` - View payments
- `client:read` - View clients
- `report:read` - View reports

**Workflow:**
1. Create contract → Status: `draft`
2. Submit contract → **Auto-approved** → Status: `approved`
3. Send for signature immediately

**OR**

1. Review pending contracts from Contract Creators
2. Approve or reject with reason

---

### 3. Billing Admin
**Description:** Handles invoicing, payments, and late fees

**Permissions:**
- `invoice:create` - Create invoices
- `invoice:read` - View invoices
- `invoice:update` - Edit invoices
- `invoice:generate` - Generate invoices
- `invoice:send` - Send invoices
- `payment:create` - Create payments
- `payment:read` - View payments
- `payment:update` - Edit payments
- `payment:process` - Process payments
- `late_fee:create` - Create late fees
- `late_fee:read` - View late fees
- `late_fee:apply` - Apply late fees
- `late_fee:waive` - Waive late fees
- `client:read` - View clients
- `contract:read` - View contracts
- `report:read` - View reports
- `report:export` - Export reports

---

### 4. Operations Admin
**Description:** Handles day-to-day operations

**Permissions:**
- `client:create` - Create clients
- `client:read` - View clients
- `client:update` - Edit clients
- `contract:read` - View contracts
- `invoice:read` - View invoices
- `payment:read` - View payments
- `transaction:read` - View transactions
- `transaction:monitor` - Monitor transactions
- `report:read` - View reports
- `report:export` - Export reports

---

### 5. System Admin (Super Admin)
**Description:** Full system access

**Permissions:**
- `*:*` - **All permissions** (wildcard)

**Additional Capabilities:**
- Manage users
- Manage roles
- Configure integrations
- Access all system features

---

## Contract Approval Workflow

### Status Flow

```
draft → pending_approval → approved → pending_signature → active
                    ↓
                rejected
```

### Workflow by Role

#### Contract Creator:
```javascript
1. POST /api/contracts (create) → status: "draft", requiresApproval: true
2. PUT /api/contracts/:id (edit) → still "draft"
3. POST /api/contracts/:id/submit → status: "pending_approval"
4. Wait for approval...
5. After approval → status: "approved"
6. Approver sends for signature → status: "pending_signature"
```

#### Approver / Finance Admin / System Admin:
```javascript
1. POST /api/contracts (create) → status: "draft", requiresApproval: false
2. POST /api/contracts/:id/submit → Auto-approved → status: "approved"
3. POST /api/contracts/:id/send-for-signature → status: "pending_signature"
```

---

## API Endpoints

### Contract Endpoints

| Method | Endpoint | Permission Required | Description |
|--------|----------|---------------------|-------------|
| GET | `/api/contracts` | `contract:read` | Get all contracts |
| GET | `/api/contracts/pending-approval` | `contract:approve` | Get pending contracts |
| GET | `/api/contracts/:id` | `contract:read` | Get contract by ID |
| POST | `/api/contracts` | `contract:create` | Create contract |
| PUT | `/api/contracts/:id` | `contract:update` | Update contract |
| DELETE | `/api/contracts/:id` | `contract:delete` | Delete contract |
| POST | `/api/contracts/:id/submit` | `contract:submit` | Submit for approval |
| POST | `/api/contracts/:id/approve` | `contract:approve` | Approve contract |
| POST | `/api/contracts/:id/reject` | `contract:approve` | Reject contract |
| POST | `/api/contracts/:id/send-for-signature` | `contract:send_signature` | Send for signature |

### Role Management Endpoints

| Method | Endpoint | Permission Required | Description |
|--------|----------|---------------------|-------------|
| GET | `/api/roles` | Any authenticated user | Get all roles |
| GET | `/api/roles/:id` | Any authenticated user | Get role by ID |
| POST | `/api/roles` | `role:create` (System Admin) | Create role |
| PUT | `/api/roles/:id` | `role:update` (System Admin) | Update role |
| DELETE | `/api/roles/:id` | `role:delete` (System Admin) | Delete role |

---

## Usage Examples

### 1. Protect a Route with Permission

```javascript
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";

// Single permission
router.post("/invoices", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.INVOICE_CREATE), 
  createInvoice
);

// Multiple permissions (user needs ANY one)
router.get("/reports", 
  authMiddleware, 
  populateUserRole, 
  requireAnyPermission([
    PERMISSIONS.REPORT_READ,
    PERMISSIONS.SYSTEM_ADMIN
  ]), 
  getReports
);
```

### 2. Check Permission in Controller

```javascript
export const createContract = async (req, res) => {
  // Check if user can auto-approve
  const canAutoApprove = req.hasPermission('contract:approve');
  
  const contract = new Contract({
    ...req.body,
    requiresApproval: !canAutoApprove,
    createdBy: req.user._id
  });
  
  await contract.save();
};
```

### 3. Get User Permissions

```javascript
import { getUserPermissions } from "../utils/rbacHelper.js";

const permissions = await getUserPermissions(userId);
console.log(permissions); // ['contract:create', 'contract:read', ...]
```

---

## Database Models

### User Model
```javascript
{
  role: ObjectId (ref: "Role"),  // Single role reference
  name: String,
  email: String,
  phone: String,
  password: String,
  buildingId: ObjectId
}
```

### Role Model
```javascript
{
  roleName: String (unique),
  description: String,
  canLogin: Boolean,
  permissions: [String]  // Array of permission strings
}
```

### Contract Model (Updated)
```javascript
{
  // ... existing fields ...
  status: String,  // draft, pending_approval, approved, rejected, pending_signature, active
  requiresApproval: Boolean,
  createdBy: ObjectId (ref: "User"),
  submittedBy: ObjectId (ref: "User"),
  submittedAt: Date,
  approvedBy: ObjectId (ref: "User"),
  approvedAt: Date,
  rejectedBy: ObjectId (ref: "User"),
  rejectedAt: Date,
  rejectionReason: String
}
```

---

## Setup Instructions

### 1. Seed Roles

Run the seed script to create the 5 predefined roles:

```bash
node scripts/seedRoles.js
```

This will create/update:
- Contract Creator
- Approver / Finance Admin
- Billing Admin
- Operations Admin
- System Admin

### 2. Assign Roles to Users

Update existing users or create new users with roles:

```javascript
// Update user with role
await User.findByIdAndUpdate(userId, { 
  role: roleId  // ObjectId of the role
});
```

### 3. Test Permissions

```bash
# Login as user
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password"
}

# Get current user's permissions
GET /api/auth/me/permissions

# Try creating a contract
POST /api/contracts
{
  "clientId": "...",
  "buildingId": "...",
  "capacity": 10,
  "monthlyRent": 50000
}
```

---

## Middleware Chain

All protected routes should follow this pattern:

```javascript
router.post("/resource", 
  authMiddleware,           // 1. Verify JWT token
  populateUserRole,         // 2. Load user with role & permissions
  requirePermission(...),   // 3. Check specific permission
  controllerFunction        // 4. Execute business logic
);
```

---

## Permission Helpers

### In Request Object (after populateUserRole)

```javascript
req.hasPermission(permission)           // Check single permission
req.hasAnyPermission([permissions])     // Check if user has any
req.hasAllPermissions([permissions])    // Check if user has all
req.isSystemAdmin()                     // Check if super admin
```

### Utility Functions

```javascript
import { 
  getUserWithPermissions,
  userHasPermission,
  canApproveContracts,
  isSystemAdmin 
} from "../utils/rbacHelper.js";

// Check if user can approve
const canApprove = await canApproveContracts(userId);

// Get user with populated role
const user = await getUserWithPermissions(userId);
```

---

## Error Responses

### 401 Unauthorized
```json
{
  "message": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "message": "Access denied. Insufficient permissions.",
  "required": "contract:approve",
  "userRole": "Contract Creator"
}
```

---

## Best Practices

1. **Always use populateUserRole** after authMiddleware for protected routes
2. **Use permission constants** from `constants/permissions.js` instead of hardcoded strings
3. **Check permissions in controllers** when business logic requires conditional behavior
4. **Log permission checks** for audit trail
5. **Test with different roles** to ensure proper access control
6. **Never bypass permission checks** in production code

---

## Future Enhancements

- [ ] Custom role creation via UI
- [ ] Permission groups/categories
- [ ] Role hierarchy (inheritance)
- [ ] Temporary permission grants
- [ ] Permission audit logs
- [ ] Role-based UI rendering
- [ ] API rate limiting per role

---

## Troubleshooting

### Issue: "Access denied" even with correct role

**Solution:** Ensure `populateUserRole` middleware is called before `requirePermission`:

```javascript
// ❌ Wrong
router.post("/", authMiddleware, requirePermission(...), handler);

// ✅ Correct
router.post("/", authMiddleware, populateUserRole, requirePermission(...), handler);
```

### Issue: User has no permissions

**Solution:** Check if user has a role assigned:

```javascript
const user = await User.findById(userId).populate('role');
console.log(user.role); // Should not be null
console.log(user.role.permissions); // Should be an array
```

### Issue: Auto-approve not working

**Solution:** Ensure `populateUserRole` is called before contract creation so `req.hasPermission` is available.

---

## Contact

For questions or issues with the RBAC system, contact the development team.
