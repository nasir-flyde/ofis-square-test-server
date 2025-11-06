# Day Pass Booking Flow

## Overview
Day passes allow guests, members, and on-demand users to book workspace access for single days or purchase bundles for multiple visits.

---

## Flow for On-Demand Users (Quick Booking)

### Step 1: Direct Access
**Who:** Walk-in customers or users who want instant booking without registration

**What Happens:**
- User visits day pass booking page
- No account creation required initially
- Can proceed directly to booking

### Step 2: Select Building & Date
**User Chooses:**
- Building/location to visit
- Visit date (today or future date)
- Number of passes needed

**Instant Pricing Display:**
- Day pass rate shown immediately
- GST calculated automatically
- Total amount displayed

### Step 3: Enter Basic Details
**Minimal Information Required:**
- Name
- Email address
- Phone number
- Company name (optional)

**Quick Validation:**
- Email format check
- Phone number verification
- No password required

### Step 4: Instant Payment
**Payment Gateway:** Razorpay

**Process:**
1. User clicks "Book Now"
2. Payment window opens immediately
3. Complete payment (UPI/Card/Net Banking)
4. On success:
   - Guest account auto-created in background
   - Day pass issued instantly
   - QR code generated
   - Confirmation email with QR code sent
   - SMS with booking details

**Status:** Direct to issued

### Step 5: Immediate Access
**After Payment:**
- QR code available instantly
- Can download or screenshot
- Email contains all visit details
- Ready to visit on selected date

### Step 6: Visit Day
**Same as Regular Flow:**
- Show QR code at reception
- Check-in via scan
- Access workspace
- Check-out when leaving

**Key Benefits:**
- No registration hassle
- Instant booking (under 2 minutes)
- Perfect for first-time visitors
- Can create full account later (optional)

---

## Flow for Guest Customers

### Step 1: Guest Registration
**Who:** New customer visiting the website

**What Happens:**
- Customer fills out basic information:
  - Name, email, phone
  - Company name (optional)
- System creates Guest account
- Customer can now purchase day passes

### Step 2: Choose Pass Type
**Options:**
- **Single Day Pass:** One-time access for a specific date
- **Day Pass Bundle:** Multiple passes (e.g., 5-pass, 10-pass package)
  - Valid for a set period (e.g., 30 days, 90 days)
  - Can be used on different dates
  - Better value for frequent visitors

### Step 3: Select Building & Date
**Customer Chooses:**
- Which building/location to visit
- For single pass: Specific visit date
- For bundle: Validity period (passes can be used anytime within this period)

**Pricing:**
- Based on building's day pass rate
- GST added automatically
- Bundle discounts may apply

### Step 4: Payment
**Payment Gateway:** Razorpay

**Process:**
1. System generates payment order
2. Razorpay payment window opens
3. Customer completes payment (UPI/Card/Net Banking)
4. On success:
   - Day pass status changes to "issued"
   - Payment receipt generated
   - Confirmation email sent

**Status:** payment_pending → issued

### Step 5: Invite Visitor (Optional)
**For Booking on Behalf of Someone Else:**
- Customer can invite another person to use the pass
- Enter visitor details:
  - Name, phone, email
  - Company name
  - Purpose of visit
- System generates QR code for visitor
- Visitor receives invitation email with QR code

**Status:** issued → invited

### Step 6: Check-In
**On Visit Day:**
- Visitor arrives at building
- Reception scans QR code OR manually checks in
- System records check-in time
- Visitor receives access

**Status:** invited → checked_in

### Step 7: Check-Out
**When Leaving:**
- Reception scans QR code or manually checks out
- System records check-out time
- Visit completed

**Status:** checked_in → checked_out

---

## Flow for Members (Credit-Based)

### Step 1: Member Purchases Pass
**Who:** Existing member with active contract

**Options:**
- Use credits from wallet
- Pay with card/UPI if insufficient credits

### Step 2: Credit Deduction
**If Paying with Credits:**
- System calculates credits needed (Amount ÷ ₹500)
- Deducts from member's credit wallet
- Creates credit transaction record
- No payment gateway needed

**Example:**
- Day pass cost: ₹1,000 + GST = ₹1,180
- Credits needed: 3 credits (₹1,500 worth)
- Remaining credit value: ₹320 (stays in wallet)

### Step 3: Same as Guest Flow
- Can invite visitors
- QR code generation
- Check-in/check-out process

---

## Bundle Management

### Using Bundle Passes
**Customer Has Bundle (e.g., 5 passes):**

1. **Plan Visit:**
   - Select date for visit
   - Choose "self" or "invite someone else"
   - One pass deducted from bundle

2. **Track Remaining:**
   - Dashboard shows remaining passes
   - Expiry date visible
   - Can use until bundle expires or passes run out

3. **Multiple Bookings:**
   - Can book multiple future dates
   - Each booking uses one pass
   - Cannot exceed remaining passes

**Example:**
- Purchased: 10-pass bundle (valid 90 days)
- Used: 3 passes
- Remaining: 7 passes
- Can book 7 more visits within validity period

---

## Complete Journey Map

```
ON-DEMAND PATH (Quickest):
Visit Booking Page → Select Building/Date → Enter Details → Pay
    ↓
Instant QR Code → Email/SMS Confirmation
    ↓
Visit Day → Check-In (QR Scan) → Access Granted → Check-Out

GUEST PATH:
Register → Choose Pass Type → Select Building/Date → Pay → Receive Confirmation
    ↓
[Optional] Invite Visitor → QR Code Sent
    ↓
Visit Day → Check-In (QR Scan) → Access Granted → Check-Out

MEMBER PATH (Credits):
View Credit Balance → Choose Pass → Credit Deduction → Confirmation
    ↓
[Optional] Invite Visitor → QR Code Sent
    ↓
Visit Day → Check-In (QR Scan) → Access Granted → Check-Out

BUNDLE PATH:
Purchase Bundle → Receive Bundle Confirmation
    ↓
[For Each Visit] Select Date → Deduct 1 Pass → QR Code
    ↓
Visit Day → Check-In → Access → Check-Out
    ↓
Repeat until bundle expires or passes exhausted
```

---

## Key Features

### QR Code System
- Unique code for each visit
- Sent via email/SMS
- Expires after visit date
- Cannot be reused

### Visitor Management
- Host can book for others
- Visitor details captured
- Separate visitor record created
- Visitor receives own QR code

### Payment Options
- **Guests:** Card, UPI, Net Banking (Razorpay)
- **Members:** Credits or standard payment methods
- Automatic receipt generation
- Invoice created for all purchases

### Expiry & Validity
- **Single Pass:** Valid only for selected date
- **Bundle:** Valid for specified period (e.g., 30/60/90 days)
- Expired passes cannot be used
- No refunds for expired bundles

---

## Admin Functions

### Reception Duties
- Scan QR codes for check-in/check-out
- Manual check-in if QR fails
- Verify visitor identity
- Mark no-shows

### Admin Dashboard
- View all day pass bookings
- Filter by date, building, status
- Check-in/out visitors manually
- Generate reports
- Handle refunds/cancellations

### Reporting
- Daily visitor count
- Revenue from day passes
- Building utilization
- Popular time slots
- Member vs guest usage

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| **pending** | Pass created, awaiting payment |
| **payment_pending** | Payment initiated, not confirmed |
| **issued** | Paid and ready to use |
| **invited** | Visitor invited, QR sent |
| **active** | Currently valid for use |
| **checked_in** | Visitor present in building |
| **checked_out** | Visit completed |
| **expired** | Past validity date |
| **cancelled** | Cancelled by user/admin |

---

## Business Rules

1. **One Pass = One Person = One Day**
2. **No Sharing:** QR codes are non-transferable
3. **Advance Booking:** Can book up to 30 days in advance
4. **Same-Day Booking:** Allowed until 6 PM
5. **Cancellation:** Allowed up to 24 hours before visit
6. **Refunds:** As per cancellation policy
7. **Bundle Validity:** Non-extendable once purchased
8. **Credit Usage:** Members only, subject to wallet balance
