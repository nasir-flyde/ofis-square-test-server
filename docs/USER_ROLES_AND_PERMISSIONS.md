# User Roles and Permissions - Ofis Square Admin Panel

## Overview
This document defines the different user roles in the Ofis Square system, their responsibilities, and granular permissions for each module.

---

## 1. Super Admin

**Description:** Full system access with all permissions. Can manage everything including other admins.

### Permissions:
- ✅ **Dashboard:** Full access to all analytics and reports
- ✅ **Buildings:** Create, edit, delete, view all buildings
- ✅ **Clients:** Full CRUD operations, KYC approval, contract management
- ✅ **Members:** Full CRUD operations, workspace assignments
- ✅ **Contracts:** Create, edit, approve, send for signature, terminate
- ✅ **Invoices:** Create, edit, delete, push to Zoho Books, generate e-invoice
- ✅ **Payments:** Record, edit, delete, refund, reconcile
- ✅ **Bookings:** View all, create, modify, cancel any booking
- ✅ **Meeting Rooms:** Full CRUD operations, pricing management
- ✅ **Day Passes:** View all, issue, cancel, refund
- ✅ **Visitors:** View all, check-in/out, manage access
- ✅ **Credits:** Manage credit system, grant credits, generate invoices
- ✅ **Users:** Create, edit, delete, assign roles and permissions
- ✅ **Settings:** Modify all system settings and configurations
- ✅ **Integrations:** Configure Zoho Books, SMS, payment gateways, etc.
- ✅ **Activity Logs:** View all system activity and audit trails
- ✅ **Reports:** Generate and export all reports
- ✅ **Notifications:** Send system-wide notifications

### Use Cases:
- System owner/founder
- Technical administrator
- Senior management with full oversight

---

## 2. Finance Manager

**Description:** Manages all financial operations including invoicing, payments, and reconciliation.

### Permissions:
- ✅ **Dashboard:** View financial metrics and reports
- ✅ **Clients:** View client details, payment history
- ✅ **Contracts:** View contracts, pricing details
- ✅ **Invoices:** Full CRUD operations, push to Zoho Books, generate e-invoice
- ✅ **Payments:** Record, edit, reconcile, generate receipts
- ✅ **Credits:** View credit usage, generate credit invoices
- ✅ **Reports:** Generate financial reports, export data
- ✅ **Integrations:** View Zoho Books sync status
- ❌ **Buildings:** Read-only access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify system settings
- ❌ **Bookings:** Read-only access
- ❌ **Contracts:** Cannot approve or terminate

### Use Cases:
- Accounts manager
- Finance team lead
- Billing specialist

---

## 3. Operations Manager

**Description:** Manages day-to-day operations including bookings, visitors, and facility management.

### Permissions:
- ✅ **Dashboard:** View operational metrics
- ✅ **Buildings:** View, edit building details and amenities
- ✅ **Clients:** View client information
- ✅ **Members:** Full CRUD operations, workspace assignments
- ✅ **Bookings:** Full CRUD operations for all bookings
- ✅ **Meeting Rooms:** Manage availability, create bookings
- ✅ **Day Passes:** Issue, view, cancel day passes
- ✅ **Visitors:** Full visitor management, check-in/out
- ✅ **Notifications:** Send operational notifications
- ✅ **Reports:** Generate operational reports
- ❌ **Invoices:** Read-only access
- ❌ **Payments:** Cannot record or modify payments
- ❌ **Contracts:** Read-only access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify system settings
- ❌ **Integrations:** No access

### Use Cases:
- Operations head
- Facility manager
- Community manager

---

## 4. Building Manager

**Description:** Manages specific building(s) with limited access to assigned locations only.

### Permissions:
- ✅ **Dashboard:** View metrics for assigned buildings only
- ✅ **Buildings:** View and edit assigned building details
- ✅ **Members:** View members in assigned buildings
- ✅ **Bookings:** Manage bookings for assigned buildings
- ✅ **Meeting Rooms:** Manage rooms in assigned buildings
- ✅ **Day Passes:** Issue and manage passes for assigned buildings
- ✅ **Visitors:** Manage visitors for assigned buildings
- ✅ **Maintenance:** Report and track maintenance issues
- ✅ **Notifications:** Send notifications to building members
- ❌ **Clients:** No access to client management
- ❌ **Contracts:** No access
- ❌ **Invoices:** No access
- ❌ **Payments:** No access
- ❌ **Credits:** No access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify settings
- ❌ **Other Buildings:** Cannot access other buildings

### Scope Limitation:
- Can only see and manage data for assigned building(s)
- Cannot view system-wide analytics

### Use Cases:
- On-site building manager
- Location supervisor
- Facility coordinator

---

## 5. Sales Manager

**Description:** Manages client acquisition, leads, and contract creation.

### Permissions:
- ✅ **Dashboard:** View sales metrics and pipeline
- ✅ **Clients:** Full CRUD operations, onboarding
- ✅ **Contracts:** Create, edit, view contracts (cannot approve)
- ✅ **Buildings:** View availability and pricing
- ✅ **Meeting Rooms:** View availability for demos
- ✅ **Reports:** Generate sales reports
- ✅ **Notifications:** Send client communications
- ❌ **Invoices:** No access
- ❌ **Payments:** No access
- ❌ **Credits:** No access
- ❌ **Contracts:** Cannot approve or terminate
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify settings
- ❌ **Integrations:** No access

### Use Cases:
- Sales team lead
- Business development manager
- Account executive

---

## 6. Receptionist / Front Desk

**Description:** Handles day-to-day front desk operations including visitor management and basic bookings.

### Permissions:
- ✅ **Dashboard:** View basic daily metrics
- ✅ **Visitors:** Full visitor management, check-in/out
- ✅ **Day Passes:** Issue and verify day passes
- ✅ **Bookings:** View bookings, create basic bookings
- ✅ **Meeting Rooms:** View availability, create bookings
- ✅ **Members:** View member directory
- ✅ **Notifications:** Send visitor notifications
- ❌ **Clients:** Read-only access to basic info
- ❌ **Contracts:** No access
- ❌ **Invoices:** No access
- ❌ **Payments:** Cannot record payments
- ❌ **Credits:** No access
- ❌ **Buildings:** Read-only access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify settings
- ❌ **Reports:** Cannot generate reports

### Scope Limitation:
- Limited to assigned building/shift
- Cannot modify pricing or contracts

### Use Cases:
- Front desk staff
- Reception team
- Security personnel with visitor management duties

---

## 7. Accountant

**Description:** Handles accounting tasks including reconciliation and financial reporting.

### Permissions:
- ✅ **Dashboard:** View financial dashboards
- ✅ **Invoices:** View, export invoices
- ✅ **Payments:** View, reconcile, export payment data
- ✅ **Credits:** View credit transactions and reports
- ✅ **Clients:** View client financial information
- ✅ **Contracts:** View contract pricing and terms
- ✅ **Reports:** Generate and export financial reports
- ✅ **Integrations:** View Zoho Books sync status
- ❌ **Invoices:** Cannot create or delete invoices
- ❌ **Payments:** Cannot record new payments
- ❌ **Clients:** Cannot edit client information
- ❌ **Contracts:** Cannot create or modify
- ❌ **Buildings:** No access
- ❌ **Bookings:** No access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify settings

### Use Cases:
- Junior accountant
- Accounts assistant
- Bookkeeper

---

## 8. Customer Support

**Description:** Handles client queries, support tickets, and basic account management.

### Permissions:
- ✅ **Dashboard:** View support metrics
- ✅ **Clients:** View client details, contact information
- ✅ **Members:** View member information
- ✅ **Bookings:** View, create, modify bookings
- ✅ **Meeting Rooms:** View availability, create bookings
- ✅ **Day Passes:** View, issue day passes
- ✅ **Invoices:** View invoices
- ✅ **Payments:** View payment history
- ✅ **Tickets:** Full ticket management (if implemented)
- ✅ **Notifications:** Send support notifications
- ❌ **Contracts:** Read-only access
- ❌ **Invoices:** Cannot create or modify
- ❌ **Payments:** Cannot record payments
- ❌ **Credits:** Read-only access
- ❌ **Buildings:** Read-only access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify settings

### Use Cases:
- Customer support representative
- Help desk staff
- Client success manager

---

## 9. Marketing Manager

**Description:** Manages marketing campaigns, analytics, and client communications.

### Permissions:
- ✅ **Dashboard:** View marketing and engagement metrics
- ✅ **Clients:** View client data for segmentation
- ✅ **Members:** View member engagement data
- ✅ **Notifications:** Create and send marketing communications
- ✅ **Reports:** Generate marketing reports
- ✅ **Events:** Manage events and promotions (if implemented)
- ❌ **Contracts:** No access
- ❌ **Invoices:** No access
- ❌ **Payments:** No access
- ❌ **Credits:** No access
- ❌ **Bookings:** Read-only access
- ❌ **Buildings:** Read-only access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify settings

### Use Cases:
- Marketing team lead
- Growth manager
- Communications specialist

---

## 10. Auditor / Compliance Officer

**Description:** Reviews system activity, compliance, and audit trails. Read-only access to most modules.

### Permissions:
- ✅ **Dashboard:** View all metrics and analytics
- ✅ **Activity Logs:** Full access to audit trails
- ✅ **Clients:** Read-only access to all client data
- ✅ **Contracts:** Read-only access
- ✅ **Invoices:** Read-only access
- ✅ **Payments:** Read-only access
- ✅ **Credits:** Read-only access
- ✅ **Bookings:** Read-only access
- ✅ **Reports:** Generate and export all reports
- ✅ **Users:** View user activity and permissions
- ❌ **All Modules:** Cannot create, edit, or delete anything
- ❌ **Settings:** Cannot modify settings
- ❌ **Integrations:** Read-only access

### Use Cases:
- Internal auditor
- Compliance officer
- External auditor (temporary access)

---

## 11. Maintenance Staff

**Description:** Manages maintenance requests and facility upkeep.

### Permissions:
- ✅ **Dashboard:** View maintenance metrics
- ✅ **Buildings:** View building details and floor plans
- ✅ **Maintenance:** Full CRUD for maintenance tickets
- ✅ **Meeting Rooms:** View room status and availability
- ✅ **Notifications:** Receive maintenance alerts
- ❌ **Clients:** No access
- ❌ **Contracts:** No access
- ❌ **Invoices:** No access
- ❌ **Payments:** No access
- ❌ **Bookings:** Read-only access
- ❌ **Users:** Cannot manage users
- ❌ **Settings:** Cannot modify settings

### Scope Limitation:
- Limited to assigned building(s)
- Cannot access financial or client data

### Use Cases:
- Maintenance technician
- Facilities staff
- Housekeeping supervisor

---

## Permission Matrix Summary

| Module | Super Admin | Finance | Operations | Building Mgr | Sales | Receptionist | Accountant | Support | Marketing | Auditor | Maintenance |
|--------|------------|---------|------------|--------------|-------|--------------|------------|---------|-----------|---------|-------------|
| **Dashboard** | Full | Financial | Operations | Building | Sales | Basic | Financial | Support | Marketing | Full | Maintenance |
| **Buildings** | Full | Read | Edit | Assigned | Read | Read | None | Read | Read | Read | Read |
| **Clients** | Full | View | View | None | Full | Read | View | View | View | Read | None |
| **Members** | Full | None | Full | View | None | View | None | View | View | Read | None |
| **Contracts** | Full | View | Read | None | Create | None | View | Read | None | Read | None |
| **Invoices** | Full | Full | Read | None | None | None | View | View | None | Read | None |
| **Payments** | Full | Full | Read | None | None | None | View | View | None | Read | None |
| **Bookings** | Full | Read | Full | Assigned | None | Create | None | Full | Read | Read | Read |
| **Meeting Rooms** | Full | None | Full | Assigned | View | Create | None | Create | None | Read | View |
| **Day Passes** | Full | None | Full | Assigned | None | Issue | None | Issue | None | Read | None |
| **Visitors** | Full | None | Full | Assigned | None | Full | None | None | None | Read | None |
| **Credits** | Full | Full | None | None | None | None | View | Read | None | Read | None |
| **Users** | Full | None | None | None | None | None | None | None | None | View | None |
| **Settings** | Full | None | None | None | None | None | None | None | None | None | None |
| **Activity Logs** | Full | View | View | None | None | None | None | None | None | Full | None |
| **Reports** | Full | Financial | Operations | Building | Sales | None | Financial | None | Marketing | Full | None |
| **Integrations** | Full | View | None | None | None | None | View | None | None | Read | None |
| **Maintenance** | Full | None | View | Assigned | None | None | None | None | None | Read | Full |

**Legend:**
- **Full:** Complete CRUD operations
- **Create:** Can create new records
- **Edit:** Can modify existing records
- **View/Read:** Read-only access
- **Assigned:** Limited to assigned buildings/resources
- **None:** No access

---

## Implementation Recommendations

### 1. Role-Based Access Control (RBAC)
```javascript
// Example middleware structure
const permissions = {
  super_admin: ['*'],
  finance_manager: ['invoices:*', 'payments:*', 'clients:read', 'reports:financial'],
  operations_manager: ['bookings:*', 'members:*', 'visitors:*', 'buildings:edit'],
  // ... etc
};
```

### 2. Granular Permissions
Each permission should follow the format: `module:action`
- `clients:create`, `clients:read`, `clients:update`, `clients:delete`
- `invoices:create`, `invoices:push_to_zoho`, `invoices:generate_einvoice`
- `contracts:approve`, `contracts:terminate`

### 3. Building/Location Scoping
For roles like Building Manager and Receptionist:
```javascript
{
  role: 'building_manager',
  assignedBuildings: ['building_id_1', 'building_id_2'],
  permissions: ['bookings:*', 'visitors:*']
}
```

### 4. Custom Roles
Consider allowing Super Admins to create custom roles by combining permissions for specific organizational needs.

---

## Security Best Practices

1. **Principle of Least Privilege:** Grant minimum permissions required
2. **Regular Audits:** Review user permissions quarterly
3. **Temporary Access:** Support time-limited elevated permissions
4. **Activity Logging:** Log all permission changes and access attempts
5. **Multi-Factor Authentication:** Require MFA for admin roles
6. **Session Management:** Implement appropriate session timeouts per role
7. **IP Whitelisting:** Consider for sensitive financial roles

---

## Future Considerations

- **Custom Roles:** Allow creating custom roles with specific permission sets
- **Department-Based Access:** Group users by departments with shared permissions
- **Time-Based Permissions:** Temporary elevated access for specific tasks
- **Approval Workflows:** Multi-level approvals for sensitive operations
- **Delegation:** Allow managers to temporarily delegate permissions
