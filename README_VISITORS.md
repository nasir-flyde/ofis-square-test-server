# Visitors/Guests Management System

A comprehensive visitor management system for ofis-square that handles the complete lifecycle from invitation to check-out with QR code support, audit trails, and real-time dashboard.

## 🎯 Features

### Core Functionality
- **Visitor Invitations**: Members can invite external visitors with detailed information
- **QR Code Check-in**: Secure QR token-based check-in system with JWT validation
- **Reception Dashboard**: Real-time dashboard for reception staff to manage visitors
- **Audit Trail**: Complete tracking of visitor status changes with user attribution
- **Automated No-Shows**: Daily cron job to mark expired invitations as no-shows
- **Integration**: Seamless integration with existing day pass system

### Security Features
- **JWT-based QR Tokens**: Secure, time-limited tokens for check-in
- **State Machine Validation**: Prevents invalid status transitions
- **Idempotent Operations**: Safe to retry check-in/check-out operations
- **User Attribution**: Tracks who performed each action

## 📊 Database Schema

### Visitor Model
```javascript
{
  // Basic Information
  name: String (required),
  email: String,
  phone: String,
  companyName: String,
  
  // Host & Purpose
  hostMember: ObjectId (ref: Member, required),
  purpose: String,
  numberOfGuests: Number (default: 1),
  
  // Visit Scheduling
  expectedVisitDate: Date (required),
  expectedArrivalTime: Date,
  expectedDepartureTime: Date,
  
  // Check-in/out Tracking
  checkInTime: Date,
  checkOutTime: Date,
  checkInMethod: String (enum: ["qr", "manual"]),
  
  // Security & Badge
  badgeId: String (unique),
  qrToken: String (unique, auto-generated),
  qrExpiresAt: Date,
  
  // Status Management
  status: String (enum: ["invited", "checked_in", "checked_out", "cancelled", "no_show", "blocked"]),
  
  // Optional Fields
  idDocumentType: String,
  idNumber: String,
  notes: String,
  cancelReason: String,
  
  // Processing Tracking
  processedByCheckin: ObjectId (ref: User),
  processedByCheckout: ObjectId (ref: User),
  
  // Metadata
  createdBy: ObjectId (ref: User),
  building: ObjectId (ref: Building),
  deletedAt: Date,
  deletedBy: ObjectId (ref: User)
}
```

### Status Flow
```
invited → checked_in → checked_out (normal flow)
invited → cancelled (cancellation)
invited → no_show (auto-marked by cron job)
```

## 🛠 API Endpoints

### Visitor Management
```
POST   /api/visitors                    # Create visitor invitation
GET    /api/visitors                    # List visitors with filters
GET    /api/visitors/today              # Get today's visitors for reception
GET    /api/visitors/stats              # Get visitor statistics
GET    /api/visitors/:id                # Get specific visitor
```

### Visitor Actions
```
PATCH  /api/visitors/:id/checkin        # Check in visitor (manual)
PATCH  /api/visitors/:id/checkout       # Check out visitor
PATCH  /api/visitors/:id/cancel         # Cancel visitor invitation
POST   /api/visitors/scan               # QR code scanning (public endpoint)
```

### API Examples

#### Create Visitor Invitation
```bash
curl -X POST http://localhost:5001/api/visitors \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "companyName": "Acme Corp",
    "hostMemberId": "64f0a1b2c3d4e5f6g7h8i9j0",
    "purpose": "Business Meeting",
    "expectedVisitDate": "2025-09-10",
    "expectedArrivalTime": "2025-09-10T10:00:00Z",
    "building": "64f0a1b2c3d4e5f6g7h8i9j1"
  }'
```

#### QR Code Check-in
```bash
curl -X POST http://localhost:5001/api/visitors/scan \
  -H "Content-Type: application/json" \
  -d '{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

#### Manual Check-in
```bash
curl -X PATCH http://localhost:5001/api/visitors/64f0a1b2c3d4e5f6g7h8i9j2/checkin \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "badgeId": "VIS-001",
    "checkInTime": "2025-09-10T10:15:00Z",
    "notes": "Arrived on time"
  }'
```

## 🎨 Frontend Components

### Reception Dashboard (`ReceptionDashboard.jsx`)
- Real-time visitor list with filtering and search
- QR scanner integration
- Quick check-in/check-out actions
- Statistics overview
- Status-based color coding

### Visitor Table (`VisitorTable.jsx`)
- Comprehensive visitor information display
- Action buttons for check-in/check-out
- Visit duration calculation
- Badge and QR method indicators

### QR Scanner (`QRScanner.jsx`)
- Manual token input
- File upload for QR images (placeholder)
- Real-time scanning feedback
- Success/error handling

### Check-in/Check-out Modals
- Form validation
- Time selection
- Badge assignment
- Notes capture

### Invite Visitor (`InviteVisitor.jsx`)
- Complete visitor invitation form
- Host member selection
- Building assignment
- QR code generation and display

## 🔧 Setup Instructions

### Backend Setup
1. Install dependencies:
```bash
cd ofis-square
npm install node-cron
```

2. Environment variables:
```env
JWT_SECRET=your-jwt-secret-key
MONGODB_URI=your-mongodb-connection-string
```

3. The system automatically:
   - Creates database indexes for performance
   - Schedules daily cron job for no-shows (1 AM)
   - Generates QR tokens for new visitors

### Frontend Setup
1. Install dependencies (if needed):
```bash
cd ofis-square-frontend
npm install lucide-react
```

2. Environment variables:
```env
VITE_API_BASE_URL=http://localhost:5001/api
```

3. Import components in your routing:
```javascript
import ReceptionDashboard from './components/pages/ReceptionDashboard';
import InviteVisitor from './components/pages/InviteVisitor';
```

## 📱 Usage Workflows

### 1. Member Invites Visitor
1. Member uses `InviteVisitor` component
2. Fills visitor details and visit information
3. System generates QR token and creates invitation
4. QR code can be shared with visitor

### 2. Visitor Arrives at Reception
**Option A: QR Scan**
1. Reception staff clicks "Scan QR" button
2. Visitor shows QR code (physical or digital)
3. System validates token and checks in visitor
4. Badge can be assigned during process

**Option B: Manual Check-in**
1. Reception staff searches for visitor in today's list
2. Clicks "Check In" button
3. Fills check-in form with time and badge details
4. System updates visitor status

### 3. Visitor Leaves
1. Reception staff finds visitor in checked-in list
2. Clicks "Check Out" button
3. System calculates visit duration
4. Optional notes can be added

### 4. Analytics and Reporting
- Real-time statistics on dashboard
- Filter by date, status, host member
- Export capabilities (can be extended)
- Audit trail for compliance

## 🔒 Security Considerations

### QR Token Security
- JWT tokens with expiration (24 hours)
- Visitor ID and visit date embedded in token
- Server-side validation of all token claims
- Tokens are single-use (can be extended)

### Access Control
- All endpoints except QR scan require authentication
- User attribution for all actions
- Soft delete for data retention
- Input validation and sanitization

### Data Protection
- No PII in QR codes
- Secure token generation using crypto.randomBytes
- Audit logging for compliance
- Optional ID document capture

## 🚀 Advanced Features

### Integration with Day Pass System
- Visitors can be linked to day passes
- Automatic guest record creation
- Billing integration maintained

### Cron Jobs
- Daily no-show marking at 1 AM
- Configurable timezone (Asia/Kolkata)
- Error handling and logging

### Extensibility
- Webhook support (can be added)
- Push notifications (can be integrated)
- Multiple building support
- Custom fields via notes

## 🐛 Troubleshooting

### Common Issues

**QR Token Invalid**
- Check JWT_SECRET environment variable
- Verify token hasn't expired
- Ensure visitor exists and status is 'invited'

**Check-in Fails**
- Verify visitor status allows check-in
- Check for duplicate badge IDs
- Ensure user has proper authentication

**Cron Job Not Running**
- Check server logs for cron initialization
- Verify timezone configuration
- Ensure MongoDB connection is stable

### Debugging
- Enable audit logging in production
- Check browser network tab for API errors
- Monitor server logs for backend issues
- Use visitor stats endpoint for data validation

## 📈 Performance Optimization

### Database Indexes
```javascript
// Automatically created by the model
{ status: 1, expectedVisitDate: 1 }
{ hostMember: 1, createdAt: -1 }
{ phone: 1 } // sparse
{ email: 1 } // sparse
{ qrToken: 1 } // unique, sparse
{ badgeId: 1 } // unique, sparse
```

### Frontend Optimization
- Lazy loading of components
- Efficient re-renders with proper state management
- Pagination for large visitor lists
- Real-time updates via WebSocket (can be added)

## 🔄 Migration from Existing System

If you have existing guest data:
1. The old `guestModel.js` is preserved for compatibility
2. Day pass system updated to work with both old and new systems
3. New visitors automatically create guest records when needed
4. Gradual migration possible without data loss

---

This system provides a complete, production-ready visitor management solution with modern security practices, comprehensive audit trails, and an intuitive user interface for both reception staff and members.
