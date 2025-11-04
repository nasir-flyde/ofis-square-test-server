# Visitor Management Flow

## Overview
Comprehensive system for managing visitors to the workspace, from invitation to check-out, ensuring security and smooth guest experience.

---

## Types of Visitors

### 1. Day Pass Visitors
- Purchased day pass for workspace access
- Pre-registered with QR code
- Full-day access to open spaces

### 2. Meeting Room Visitors
- Attending scheduled meetings
- Invited by meeting host
- Access limited to meeting room and duration

### 3. General Visitors
- Meeting members/clients
- Business meetings
- Deliveries or services
- Short-term access

---

## Visitor Invitation Flow

### Step 1: Host Initiates Invitation

**Who Can Invite:**
- Members (for their visitors)
- Clients (for company visitors)
- Day pass holders (for their guests)

**How to Invite:**
1. Go to "Invite Visitor" section
2. Choose invitation type:
   - Day Pass Visitor
   - Meeting Visitor
   - General Visitor

### Step 2: Enter Visitor Details

**Required Information:**
- **Full Name**
- **Email Address**
- **Phone Number**
- **Company Name** (optional)
- **Purpose of Visit**
  - Meeting
  - Interview
  - Delivery
  - Service/Maintenance
  - Other (specify)

**Visit Details:**
- **Expected Visit Date**
- **Expected Arrival Time**
- **Expected Departure Time**
- **Number of Guests** (if group)

**Additional Information:**
- ID Document Type (Passport, Driver's License, etc.)
- ID Number (for security)
- Special Requirements (wheelchair access, etc.)
- Notes for reception

### Step 3: System Processing

**What Happens Automatically:**
1. **Visitor Record Created**
   - Unique visitor ID assigned
   - Linked to host (member/client/guest)
   - Building information added

2. **QR Code Generated**
   - Unique token created
   - Embedded with visit details
   - Expires after visit date

3. **Invitation Sent**
   - Email to visitor with:
     - Visit details
     - Building address and directions
     - QR code (attached and embedded)
     - Host contact information
     - Parking instructions
     - Check-in instructions

4. **Host Confirmation**
   - Email confirmation sent
   - Visitor details summary
   - QR code copy for reference

**Visitor Status:** Invited

---

## Pre-Visit Phase

### Visitor Receives:
- **Email Invitation** with all details
- **QR Code** for contactless check-in
- **Building Information:**
  - Address with Google Maps link
  - Parking availability
  - Public transport options
  - Entry gate details
- **Host Details:**
  - Name and phone number
  - Cabin/desk location
  - Contact in case of issues

### Host Can:
- View visitor status
- Modify visit details
- Cancel invitation
- Add more visitors
- Download visitor QR code
- Set up reception alerts

---

## Visit Day - Check-In Process

### Option 1: QR Code Check-In (Recommended)

**Visitor Arrives:**
1. Shows QR code at reception (phone or printout)
2. Reception scans QR code
3. System validates:
   - QR code authenticity
   - Visit date matches
   - Not expired
   - Not already used
4. Visitor details displayed on screen
5. Reception verifies identity (ID check)
6. System records check-in time
7. Visitor badge issued (if applicable)
8. Access granted

**Check-In Time:** Recorded automatically

### Option 2: Manual Check-In

**If QR Code Not Available:**
1. Visitor provides name and host details
2. Reception searches in system
3. Finds visitor record
4. Verifies identity
5. Manually marks check-in
6. Issues visitor badge
7. Access granted

### Security Checks:
- Photo ID verification
- Bag screening (if required)
- Temperature check (if policy)
- Health declaration (if required)
- Visitor log signature

### Visitor Receives:
- Visitor badge (wear visibly)
- Building map (if needed)
- WiFi credentials (if applicable)
- Emergency contact number
- Host notification (SMS/call)

**Visitor Status:** Checked In

---

## During the Visit

### Visitor Access:
- Designated areas only
- Meeting rooms (if booked)
- Common areas (lobby, pantry, washrooms)
- Host's workspace (with host)

### Restrictions:
- Cannot access other cabins/offices
- Cannot use facilities without permission
- Must be accompanied in restricted areas
- Badge must be visible at all times

### Host Responsibilities:
- Receive visitor promptly
- Escort to meeting area
- Ensure visitor follows rules
- Responsible for visitor conduct
- Notify reception of any issues

### Reception Monitoring:
- Track visitor location (if system enabled)
- Monitor visit duration
- Alert if overstaying
- Handle visitor requests
- Ensure security compliance

---

## Check-Out Process

### Option 1: QR Code Check-Out

**When Leaving:**
1. Visitor returns to reception
2. Shows QR code or badge
3. Reception scans QR code
4. System records check-out time
5. Visitor returns badge
6. Exit clearance given

### Option 2: Manual Check-Out

**Process:**
1. Visitor informs reception
2. Reception finds visitor record
3. Manually marks check-out
4. Collects badge
5. Updates system
6. Visitor exits

### Auto Check-Out:
- If visitor doesn't check out manually
- System auto-checks out at expected departure time + 2 hours
- Status marked as "Auto Check-Out"
- Alert sent to host

**Visitor Status:** Checked Out

---

## Complete Visitor Journey

```
Host Needs to Invite Visitor
    ↓
Create Invitation → Enter Details → Submit
    ↓
System Generates QR Code → Sends Email to Visitor
    ↓
Visitor Receives Invitation → Confirms Attendance
    ↓
Visit Day → Visitor Arrives at Building
    ↓
Reception Scans QR Code → Verifies Identity
    ↓
Check-In Recorded → Badge Issued → Host Notified
    ↓
Visitor Meets Host → Conducts Business
    ↓
Visit Complete → Returns to Reception
    ↓
Scans QR Code → Returns Badge → Check-Out Recorded
    ↓
Exit → Visit Completed
```

---

## Special Scenarios

### Recurring Visitors

**For Regular Visitors:**
- Create visitor profile
- Pre-approve for multiple visits
- Simplified check-in process
- Long-term visitor badge
- Reduced security checks

**How to Set Up:**
1. Host requests recurring visitor access
2. Admin approves
3. Visitor profile created
4. Access schedule defined
5. Automatic invitations sent

### Group Visitors

**For Multiple Visitors:**
- Host specifies number of guests
- Can enter individual details or group details
- Single QR code or individual codes
- Group check-in process
- All visitors linked to host

### VIP Visitors

**Special Handling:**
- Priority check-in
- Dedicated reception
- Escort service
- Premium visitor lounge
- Special parking
- Refreshments arranged

### Delivery Personnel

**Quick Process:**
- Purpose: Delivery
- Limited access (reception only)
- Quick check-in/out
- Delivery log maintained
- No badge required for short stays

---

## Visitor Status Definitions

| Status | Meaning |
|--------|---------|
| **Invited** | Invitation sent, awaiting visit |
| **Pending Check-In** | Visitor requested entry, awaiting approval |
| **Approved** | Pre-approved for check-in |
| **Checked In** | Currently in the building |
| **Checked Out** | Visit completed |
| **Cancelled** | Invitation cancelled |
| **No Show** | Didn't arrive on scheduled date |

---

## Visitor Dashboard (For Hosts)

### My Visitors Section:

**Today's Visitors:**
- List of expected visitors
- Check-in status
- Arrival time
- Current location (if tracked)

**Upcoming Visitors:**
- Future scheduled visits
- Pending confirmations
- Awaiting details

**Past Visitors:**
- Historical visitor log
- Visit duration
- Frequency of visits

### Actions Available:
- Invite new visitor
- View visitor details
- Cancel invitation
- Modify visit details
- Download QR code
- Resend invitation email
- Check-in status tracking

---

## Reception Dashboard

### Today's Expected Visitors:

**View Options:**
- Timeline view (by arrival time)
- List view (all visitors)
- Building-wise view
- Host-wise view

**Information Displayed:**
- Visitor name and photo (if uploaded)
- Host details
- Expected time
- Purpose of visit
- Check-in status
- Special requirements

### Quick Actions:
- Search visitor by name/phone
- Scan QR code
- Manual check-in/out
- Issue visitor badge
- Print visitor list
- Send alerts to hosts
- Mark no-shows

---

## Security & Compliance

### ID Verification:
- Mandatory for all visitors
- Photo ID required
- ID details recorded
- Photo capture (optional)

### Visitor Log:
- Complete audit trail
- Entry and exit times
- ID verification records
- Purpose of visit
- Host information
- Compliance with regulations

### Privacy:
- Visitor data encrypted
- Access restricted to authorized personnel
- Data retention as per policy
- GDPR/privacy law compliant

### Emergency Procedures:
- Visitor count always updated
- Emergency evacuation list
- Visitor location tracking
- Emergency contact information
- Quick headcount capability

---

## Reporting & Analytics

### Available Reports:

**Daily Reports:**
- Total visitors
- Check-in/out times
- No-shows
- Overstays
- Peak hours

**Host Reports:**
- Visitors per host
- Frequent visitors
- Average visit duration
- Purpose breakdown

**Security Reports:**
- Unauthorized access attempts
- Expired QR codes used
- ID verification failures
- Incident reports

**Trend Analysis:**
- Visitor patterns
- Busy days/times
- Popular hosts
- Building utilization

---

## Mobile App Features

### For Visitors:
- Receive invitation on phone
- QR code in app
- Building navigation
- Check-in notification
- Contact host easily
- Feedback submission

### For Hosts:
- Invite visitors on-the-go
- Track visitor arrival
- Receive check-in alerts
- View visitor location
- Communicate with reception
- Quick check-out

---

## Best Practices

### For Hosts:
1. **Invite in Advance:** At least 24 hours before visit
2. **Complete Details:** Provide all required information
3. **Confirm with Visitor:** Ensure they received invitation
4. **Be Available:** Ready to receive when visitor arrives
5. **Escort Visitor:** Don't leave them unattended
6. **Ensure Check-Out:** Confirm visitor checked out

### For Visitors:
1. **Bring ID:** Government-issued photo ID
2. **Arrive on Time:** As per scheduled time
3. **Save QR Code:** Download or screenshot
4. **Wear Badge:** Keep visible throughout visit
5. **Follow Rules:** Respect building policies
6. **Check Out:** Don't forget to check out when leaving

### For Reception:
1. **Verify Identity:** Always check ID
2. **Scan QR Code:** Use scanner, don't manually enter
3. **Issue Badge:** Ensure visitor wears it
4. **Alert Host:** Notify when visitor arrives
5. **Monitor Duration:** Track overstays
6. **Collect Badge:** Before allowing exit

---

## Integration with Other Systems

### Linked to:
- **Day Pass System:** Auto-create visitor for day pass
- **Meeting Rooms:** Auto-invite meeting attendees
- **Access Control:** Grant/revoke building access
- **Parking System:** Reserve visitor parking
- **Notification System:** Alerts and reminders

### Automated Workflows:
- Day pass purchase → Visitor invitation
- Meeting booking → Visitor QR codes
- Check-in → Host notification
- Overstay → Alert to reception and host
- Check-out → Visit summary email
