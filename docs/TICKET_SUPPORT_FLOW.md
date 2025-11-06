# Support Ticket System Flow

## Overview
Members and clients can raise support tickets for issues, requests, or complaints. Tickets are tracked, assigned, and resolved with full audit trail.

---

## Step 1: Create a Ticket

### Who Can Create:
- Members (for workspace issues)
- Clients (for company-wide issues)
- Admin (on behalf of users)

### How to Create:
1. Click "New Ticket" or "Raise Issue"
2. Fill in ticket details
3. Submit for review

### Required Information:

#### Basic Details:
- **Subject:** Brief description (e.g., "AC not working in Cabin 205")
- **Description:** Detailed explanation of the issue
- **Priority:**
  - Low: Minor inconvenience
  - Medium: Affects work but manageable
  - High: Significant impact on work
  - Urgent: Critical, immediate attention needed

#### Categorization:
- **Category:** Select from predefined categories
  - Facilities (AC, lighting, furniture)
  - IT/Network (WiFi, computers, printers)
  - Housekeeping (cleaning, maintenance)
  - Security (access, safety)
  - Billing (invoices, payments)
  - Other

- **Sub-Category:** More specific classification
  - Example: Facilities → Air Conditioning → Not Cooling

#### Location Details:
- Building
- Cabin/Desk number (if applicable)
- Floor

#### Attachments:
- Upload photos/screenshots (up to 5 files)
- Helps support team understand issue better

---

## Step 2: Ticket Generation

### What Happens Automatically:
- **Ticket ID Created:** Unique reference number (e.g., TKT-2501-0042)
  - Format: TKT-YYMM-XXXX
  - Resets monthly
  - Easy to reference

- **Confirmation Sent:**
  - Email to ticket creator
  - Contains ticket ID and details
  - Expected response time

- **Status Set:** Open
- **Timestamp Recorded:** Date and time of creation

---

## Step 3: Ticket Assignment

### Auto-Assignment (if configured):
- Based on category
- Based on building
- Based on priority
- Round-robin to available staff

### Manual Assignment:
- Admin reviews new tickets
- Assigns to appropriate team member
- Considers:
  - Expertise required
  - Current workload
  - Location/building
  - Priority level

### Assigned Person Receives:
- Email notification
- In-app notification
- Ticket details
- Deadline (based on priority)

---

## Step 4: Ticket Processing

### Status Updates:

#### Open → In Progress
- Support staff acknowledges ticket
- Begins investigation/work
- May request more information
- Updates visible to ticket creator

#### In Progress → Pending
- Waiting for:
  - User response
  - Parts/materials
  - Third-party vendor
  - Management approval
- Reason for pending status noted

#### Pending → In Progress
- Required information/materials received
- Work resumes

### Communication:
- **Latest Update Field:** Staff adds progress notes
- **Internal Notes:** Not visible to user
- **User Updates:** Visible to ticket creator
- **Email Notifications:** Sent on status changes

---

## Step 5: Resolution

### When Issue is Fixed:
1. Staff marks ticket as "Resolved"
2. Adds resolution notes:
   - What was done
   - Root cause (if applicable)
   - Preventive measures
3. User receives notification

### User Verification:
- User reviews resolution
- Options:
  - **Accept:** Ticket closed
  - **Reject:** Reopens ticket with comments
  - **No Response:** Auto-closes after 48 hours

---

## Step 6: Ticket Closure

### Closed Status:
- Issue fully resolved
- User satisfied
- No further action needed

### Closure Information Recorded:
- Resolution date and time
- Total time to resolve
- Who resolved it
- User satisfaction (if feedback provided)

### Post-Closure:
- Ticket archived
- Searchable for future reference
- Used for analytics and reporting
- Cannot be reopened (new ticket required)

---

## Complete Journey Map

```
User Identifies Issue
    ↓
Create Ticket → Fill Details → Upload Photos → Submit
    ↓
System Generates Ticket ID → Confirmation Email
    ↓
Admin/System Assigns to Support Staff
    ↓
Staff Reviews → Status: In Progress
    ↓
[If Needed] Request More Info → Status: Pending
    ↓
Work on Resolution → Add Updates
    ↓
Issue Fixed → Status: Resolved → Notify User
    ↓
User Verifies → Accepts/Rejects
    ↓
Status: Closed → Archived
```

---

## Priority & Response Times

### Priority Levels:

| Priority | Response Time | Resolution Target | Examples |
|----------|--------------|-------------------|----------|
| **Urgent** | 30 minutes | 4 hours | No power, security breach, fire alarm |
| **High** | 2 hours | 24 hours | AC failure, major leak, network down |
| **Medium** | 4 hours | 3 days | Minor repairs, cleaning issues |
| **Low** | 24 hours | 7 days | Suggestions, minor improvements |

### SLA (Service Level Agreement):
- Response: Acknowledgment within specified time
- Resolution: Issue fixed within target time
- Escalation: Auto-escalate if SLA breached

---

## Ticket Categories Explained

### 1. Facilities
**Common Issues:**
- Air conditioning problems
- Lighting issues
- Furniture damage
- Plumbing leaks
- Electrical problems

**Typical Resolution:**
- Maintenance team visit
- Repair or replacement
- May require vendor

### 2. IT/Network
**Common Issues:**
- WiFi connectivity
- Printer not working
- Computer issues
- Access card problems
- Software installation

**Typical Resolution:**
- IT team troubleshooting
- Configuration changes
- Hardware replacement
- Password resets

### 3. Housekeeping
**Common Issues:**
- Cleaning not done
- Washroom maintenance
- Garbage disposal
- Pest control needed
- Pantry supplies

**Typical Resolution:**
- Housekeeping team scheduled
- Deep cleaning arranged
- Supplies restocked
- Vendor called (pest control)

### 4. Security
**Common Issues:**
- Access card not working
- Unauthorized access
- Lost items
- Safety concerns
- CCTV footage request

**Typical Resolution:**
- Security team investigation
- Access rights updated
- Incident report filed
- Police involved (if serious)

### 5. Billing
**Common Issues:**
- Invoice discrepancies
- Payment not reflected
- Credit issues
- Refund requests
- Contract queries

**Typical Resolution:**
- Accounts team review
- Invoice correction
- Payment verification
- Refund processing

---

## User Dashboard Features

### My Tickets View:
- **All Tickets:** Complete history
- **Open Tickets:** Currently active
- **Resolved Tickets:** Awaiting closure
- **Closed Tickets:** Completed issues

### Filters:
- By status
- By priority
- By category
- By date range
- By building/location

### Actions Available:
- View ticket details
- Add comments
- Upload additional files
- Close resolved tickets
- Track progress

---

## Admin Dashboard Features

### Ticket Management:
- View all tickets across all users
- Filter by assignee, building, status
- Bulk assignment
- Priority changes
- Reassignment

### Analytics:
- Tickets by category
- Average resolution time
- SLA compliance rate
- Staff performance
- Recurring issues
- User satisfaction scores

### Reports:
- Daily ticket summary
- Weekly performance report
- Monthly analytics
- Category-wise breakdown
- Building-wise statistics

---

## Status Definitions

| Status | Meaning | Who Can Set |
|--------|---------|-------------|
| **Open** | New ticket, not yet assigned | System (auto) |
| **In Progress** | Being worked on | Support staff |
| **Pending** | Waiting for something | Support staff |
| **Resolved** | Issue fixed, awaiting verification | Support staff |
| **Closed** | Completed and verified | User or Auto |

---

## Best Practices

### For Users:
1. **Be Specific:** Clear subject and description
2. **Add Photos:** Visual proof helps faster resolution
3. **Set Right Priority:** Don't mark everything urgent
4. **Respond Promptly:** When staff asks for info
5. **Verify Resolution:** Check if issue is truly fixed
6. **Provide Feedback:** Helps improve service

### For Support Staff:
1. **Acknowledge Quickly:** Let user know you're on it
2. **Update Regularly:** Keep user informed of progress
3. **Be Thorough:** Fix root cause, not just symptom
4. **Document Well:** Clear resolution notes
5. **Follow Up:** Ensure user is satisfied
6. **Learn from Patterns:** Identify recurring issues

---

## Escalation Process

### When to Escalate:
- SLA breach imminent
- User dissatisfied with resolution
- Issue beyond assigned person's scope
- Recurring problem needs management attention
- Safety/security concern

### Escalation Levels:
1. **Level 1:** Team Lead
2. **Level 2:** Department Manager
3. **Level 3:** Building Manager
4. **Level 4:** Senior Management

### Auto-Escalation:
- Urgent tickets unresolved in 4 hours
- High priority tickets unresolved in 24 hours
- Any ticket pending > 7 days
- User complaints about service

---

## Integration with Other Systems

### Linked to:
- **Client/Member Profile:** View user's ticket history
- **Building Management:** Location-based routing
- **Invoice System:** Billing-related tickets
- **Activity Logs:** Full audit trail
- **Notification System:** Email/SMS alerts

### Automatic Actions:
- Email on ticket creation
- SMS for urgent tickets
- Daily digest to admins
- Weekly summary to management
- Monthly reports to clients

---

## Mobile Access

### Features Available:
- Create tickets on-the-go
- Upload photos from phone
- Receive push notifications
- Track ticket status
- Add comments
- Close resolved tickets

---

## Tips for Faster Resolution

1. **Right Category:** Helps route to correct team
2. **Complete Info:** Avoid back-and-forth
3. **Photos/Videos:** Worth a thousand words
4. **Availability:** Mention when you're available
5. **Contact Info:** Ensure phone/email is correct
6. **Location Details:** Exact cabin/desk number
7. **Urgency:** Honest priority assessment
