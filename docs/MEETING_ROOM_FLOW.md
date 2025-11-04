# Meeting Room Booking Flow

## Overview
Members and clients can book meeting rooms for specific time slots with visitor management and flexible payment options.

---

## Step 1: Browse Available Rooms

### What You See:
- List of all meeting rooms in your building
- Room details:
  - Capacity (number of people)
  - Amenities (projector, whiteboard, video conferencing, etc.)
  - Photos of the room
  - Pricing (daily rate)
  - Availability calendar

### Filter Options:
- By capacity needed
- By amenities required
- By date and time
- By building/location

---

## Step 2: Check Availability

### Select Your Requirements:
- **Date:** When you need the room
- **Time Slot:** Choose from available slots
  - Standard slots: 9 AM - 10 AM, 10 AM - 11 AM, etc.
  - Can book multiple consecutive slots
  - No buffer time between bookings

### Availability Display:
- **Green:** Available
- **Red:** Already booked
- **Grey:** Outside operating hours

### Operating Hours:
- Default: 9 AM - 7 PM, Monday to Friday
- Custom hours per room
- Blackout dates (holidays, maintenance) shown

---

## Step 3: Add Visitor Details

### Who's Attending:
- Add multiple visitors to the booking
- For each visitor, enter:
  - Full name
  - Email address
  - Phone number
  - Company name
  - Purpose of visit

### Visitor Features:
- All visitors receive meeting confirmation
- QR codes generated for check-in
- Visitor list visible to reception
- Can add/remove visitors before meeting

---

## Step 4: Select Amenities

### Choose What You Need:
- Projector
- Whiteboard
- Video conferencing setup
- Flip charts
- Markers and stationery
- Coffee/tea service
- Any special requirements

**Note:** Some amenities may have additional charges

---

## Step 5: Review & Confirm

### Booking Summary Shows:
- Meeting room name
- Date and time slots
- Duration (hours)
- Number of visitors
- Selected amenities
- **Total Cost:**
  - Base rate (daily rate ÷ time slots)
  - Amenity charges
  - GST (18%)
  - **Final amount**

---

## Step 6: Payment

### Payment Options:

#### Option A: Pay with Credits (Members Only)
**If you have sufficient credits:**
- Credits calculated: Amount ÷ ₹500 per credit
- Deducted from your credit wallet
- Instant confirmation
- No payment gateway needed

**Example:**
- Meeting cost: ₹2,360 (including GST)
- Credits needed: 5 credits
- Deducted from wallet immediately

#### Option B: Pay with Card/UPI
- Razorpay payment gateway
- Card, UPI, Net Banking accepted
- Instant confirmation on success
- Payment receipt emailed

### After Payment:
- Booking status: **Booked**
- Confirmation email sent to you
- Visitor invitations sent to all attendees
- QR codes generated
- Calendar invite created

---

## Step 7: Before the Meeting

### You Receive:
- Booking confirmation email
- Meeting room details and directions
- QR code for access
- Visitor list
- Amenity confirmation

### Visitors Receive:
- Meeting invitation
- Building address and directions
- QR code for check-in
- Host contact details
- Parking information (if applicable)

### You Can:
- Add more visitors
- Modify amenity requests
- Cancel booking (as per policy)
- Contact support for changes

---

## Step 8: Meeting Day - Check-In

### Arrival Process:
1. **Host arrives** at reception
2. Shows QR code or booking reference
3. Reception verifies booking
4. **Visitors arrive** and check in with their QR codes
5. Reception confirms all attendees
6. Access granted to meeting room

### Reception Checks:
- Booking validity
- Time slot confirmation
- Visitor count matches booking
- ID verification (if required)
- Amenity setup confirmation

---

## Step 9: During the Meeting

### Room Access:
- Room unlocked at start time
- All requested amenities ready
- Support available if needed
- Can request additional items

### Time Management:
- Meeting must end by booked end time
- 5-minute grace period for cleanup
- Extension requests handled by reception
- Additional charges for overtime

---

## Step 10: After the Meeting

### Check-Out:
- Inform reception when leaving
- Return any borrowed items
- Report any issues
- Room inspection by staff

### You Receive:
- Booking completion confirmation
- Invoice (if not already sent)
- Feedback request
- Credit transaction summary (if paid with credits)

---

## Complete Journey Map

```
Browse Rooms → Check Availability → Select Date/Time
    ↓
Add Visitors → Select Amenities → Review Summary
    ↓
Choose Payment Method
    ├─→ Credits: Deduct → Instant Confirm
    └─→ Card/UPI: Pay via Razorpay → Confirm
    ↓
Receive Confirmations → QR Codes Sent
    ↓
Meeting Day → Check-In (Host + Visitors) → Access Room
    ↓
Conduct Meeting → Check-Out → Feedback
```

---

## Cancellation & Modifications

### Cancellation Policy:
- **24+ hours before:** Full refund
- **12-24 hours before:** 50% refund
- **Less than 12 hours:** No refund
- **No-show:** No refund

### How to Cancel:
1. Go to "My Bookings"
2. Select the booking
3. Click "Cancel Booking"
4. Confirm cancellation
5. Refund processed (if applicable)

### Modifications:
- **Add visitors:** Anytime before meeting
- **Change time:** Subject to availability
- **Add amenities:** Up to 2 hours before
- **Extend duration:** Contact admin

---

## Credit System (Members)

### How Credits Work:
- 1 Credit = ₹500
- Credits deducted based on total amount
- Rounded up to nearest credit
- Transaction recorded in credit history

### Credit Calculation:
```
Meeting Cost: ₹3,540 (with GST)
Credits Needed: ₹3,540 ÷ ₹500 = 7.08 → 8 credits
Amount Deducted: 8 credits (₹4,000 worth)
Excess: ₹460 (remains as credit balance)
```

### Insufficient Credits:
- System shows credit shortage
- Option to pay difference via card/UPI
- Or pay full amount via payment gateway

---

## Admin Functions

### Room Management:
- Add/edit meeting rooms
- Set pricing and availability
- Define amenities
- Upload room photos
- Set operating hours
- Mark blackout dates

### Booking Management:
- View all bookings (calendar view)
- Approve/reject bookings
- Handle cancellations
- Process refunds
- Manage no-shows
- Generate reports

### Visitor Management:
- Check-in visitors
- Verify identities
- Issue visitor badges
- Track visitor logs
- Security compliance

---

## Reporting & Analytics

### Available Reports:
- Room utilization rates
- Revenue by room
- Peak booking times
- Popular amenities
- Member vs guest bookings
- Cancellation rates
- Average meeting duration
- Visitor statistics

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| **payment_pending** | Booking created, awaiting payment |
| **booked** | Confirmed and paid |
| **cancelled** | Cancelled by user/admin |
| **completed** | Meeting finished, checked out |

---

## Business Rules

1. **Minimum Booking:** 1 hour
2. **Maximum Advance Booking:** 30 days
3. **Same-Day Booking:** Until 2 hours before start time
4. **Consecutive Slots:** Can book multiple hours
5. **No Overlap:** One booking per room per time slot
6. **Visitor Limit:** Cannot exceed room capacity
7. **Payment Required:** Before confirmation
8. **Check-In Required:** Within 15 minutes of start time
9. **No-Show Policy:** Booking cancelled, no refund
10. **Overtime Charges:** ₹500 per 30 minutes

---

## Tips for Best Experience

### Before Booking:
- Check room capacity matches your needs
- Verify amenities are available
- Book early for popular time slots
- Add all visitors upfront

### During Meeting:
- Arrive 5 minutes early
- Test equipment before meeting starts
- Keep room clean
- End on time

### For Recurring Meetings:
- Contact admin for bulk booking
- Possible discounts for regular bookings
- Priority access for long-term clients
