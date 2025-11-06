# Client Onboarding Requirements - Ofis Square

## Overview
This document outlines all information and credentials required from clients during onboarding for the Ofis Square coworking space management system.

---

## 1. Buildings & Infrastructure Data

### 1.1 Building Information Format

```json
{
  "name": "Building Name",
  "address": {
    "street": "123 Main Street",
    "area": "Business District",
    "city": "Bangalore",
    "state": "Karnataka",
    "pincode": "560001",
    "country": "India"
  },
  "contact": {
    "phone": "+91-9876543210",
    "email": "building@example.com"
  },
  "operatingHours": {
    "weekdays": { "open": "08:00", "close": "22:00" },
    "weekends": { "open": "09:00", "close": "20:00" }
  },
  "capacity": {
    "totalSeats": 200,
    "cabins": 15,
    "meetingRooms": 5,
    "openSeats": 150
  },
  "pricing": {
    "openSpacePricing": 500,
    "currency": "INR",
    "gstApplicable": true
  },
  "amenities": ["WiFi", "Parking", "Cafeteria", "Security"],
  "images": ["url1", "url2"]
}
```

### 1.2 Cabin Details Format

```json
{
  "buildingId": "ref_id",
  "cabinNumber": "C-101",
  "floor": 1,
  "name": "Executive Cabin A",
  "capacity": { "seats": 4, "maxOccupancy": 6 },
  "area": { "squareFeet": 150 },
  "amenities": ["AC", "Whiteboard", "TV", "WiFi"],
  "pricing": {
    "monthlyRate": 25000,
    "dailyRate": 1500,
    "securityDeposit": 50000
  },
  "features": {
    "hasWindow": true,
    "soundproof": true,
    "lockable": true
  }
}
```

### 1.3 Meeting Room Format

```json
{
  "buildingId": "ref_id",
  "roomNumber": "MR-201",
  "name": "Conference Room Alpha",
  "capacity": { "seats": 12, "maxOccupancy": 15 },
  "equipment": ["Projector", "Video Conferencing", "Whiteboard"],
  "pricing": {
    "hourlyRate": 800,
    "halfDayRate": 3000,
    "fullDayRate": 5000
  },
  "availability": {
    "operatingHours": {
      "weekdays": { "open": "08:00", "close": "22:00" }
    },
    "minimumBookingHours": 1,
    "advanceBookingDays": 30
  },
  "features": {
    "soundproof": true,
    "videoConferencing": true,
    "wheelchairAccessible": true
  }
}
```

---

## 2. SMS Provider Configuration

```json
{
  "provider": "SMSWaale / Twilio / MSG91",
  "credentials": {
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret",
    "senderId": "OFISSR"
  },
  "messageTemplates": {
    "otpLogin": {
      "templateId": "TEMPLATE_002",
      "content": "Your OTP is {{otp}}. Valid for 10 minutes."
    },
    "bookingConfirmation": {
      "templateId": "TEMPLATE_003",
      "content": "Booking confirmed! {{roomName}} on {{date}}"
    },
    "invoiceGenerated": {
      "templateId": "TEMPLATE_005",
      "content": "Invoice {{invoiceNo}} for Rs.{{amount}} generated"
    }
  }
}
```

---

## 3. Zoho Books Credentials

### 3.1 OAuth Credentials
```json
{
  "clientId": "1000.XXXXXXXXXXXXXXXXX",
  "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "refreshToken": "1000.xxxxxxxx.xxxxxxxx",
  "organizationId": "123456789",
  "region": "IN"
}
```

### 3.2 GST Configuration
```json
{
  "gstin": "29ABCDE1234F1Z5",
  "gstTreatment": "business_gst",
  "defaultTaxRate": 18,
  "invoicePrefix": "INV-",
  "defaultPaymentTerms": 15
}
```

### 3.3 Webhook Setup
```json
{
  "webhookUrl": "https://yourdomain.com/api/webhooks/zoho-books",
  "webhookSecret": "your_secret",
  "events": ["contact_created", "invoice_created", "payment_created"]
}
```

---

## 4. Matrix API Credentials

```json
{
  "apiKey": "your_matrix_api_key",
  "apiSecret": "your_matrix_api_secret",
  "baseUrl": "https://api.matrix.provider.com/v1",
  "deviceMapping": [
    {
      "deviceId": "DEVICE_001",
      "buildingId": "building_ref",
      "location": "Main Entrance"
    }
  ]
}
```

---

## 5. AWS Service Credentials

### 5.1 S3 (File Storage)
```json
{
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCY",
  "region": "ap-south-1",
  "buckets": {
    "documents": "ofis-square-documents",
    "images": "ofis-square-images",
    "invoices": "ofis-square-invoices"
  }
}
```

### 5.2 SES (Email Service)
```json
{
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCY",
  "region": "ap-south-1",
  "fromEmail": "noreply@yourdomain.com",
  "fromName": "Ofis Square"
}
```

---

## 6. MyHQ API Credentials

```json
{
  "apiKey": "your_myhq_api_key",
  "apiSecret": "your_myhq_api_secret",
  "partnerId": "your_partner_id",
  "buildingMapping": [
    {
      "localBuildingId": "building_ref",
      "myhqLocationId": "myhq_location_id"
    }
  ],
  "webhookUrl": "https://yourdomain.com/api/webhooks/myhq"
}
```

---

## 7. Bhaifi API Credentials

```json
{
  "apiKey": "your_bhaifi_api_key",
  "apiSecret": "your_bhaifi_api_secret",
  "merchantId": "your_merchant_id",
  "buildingNetworks": [
    {
      "buildingId": "building_ref",
      "networkId": "bhaifi_network_id",
      "ssid": "OfisSquare-Building1"
    }
  ]
}
```

---

## 8. E-Invoice GST Setup

### 8.1 GST Portal
```json
{
  "gstin": "29ABCDE1234F1Z5",
  "username": "your_gst_username",
  "einvoiceEnabled": true
}
```

### 8.2 GSP Provider (ClearTax/Iris/etc)
```json
{
  "gspProvider": "ClearTax",
  "clientId": "your_gsp_client_id",
  "clientSecret": "your_gsp_client_secret",
  "gstin": "29ABCDE1234F1Z5",
  "baseUrl": "https://api.gsp-provider.com/v1",
  "autoGenerateIRN": true
}
```

---

## 9. Email Provider Configuration

```json
{
  "provider": "Gmail / AWS SES / SendGrid",
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "user": "your-email@gmail.com",
    "pass": "app-specific-password"
  },
  "fromEmail": "noreply@yourdomain.com",
  "fromName": "Ofis Square"
}
```

---

## 10. Users List

### Admin Users
```json
{
  "role": "admin",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@yourdomain.com",
  "phone": "+91-9876543210",
  "permissions": {
    "accessLevel": "super_admin",
    "modules": ["all"]
  }
}
```

### Building Managers
```json
{
  "role": "building_manager",
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@yourdomain.com",
  "assignedBuildings": ["building_ref_1"],
  "permissions": {
    "modules": ["bookings", "visitors", "maintenance"]
  }
}
```

---

## 11. Additional Services

### Payment Gateway (Razorpay)
```json
{
  "keyId": "rzp_live_XXXXXXXXXX",
  "keySecret": "XXXXXXXXXXXXXXXXXX",
  "webhookSecret": "XXXXXXXXXXXXXXXXXX"
}
```

### Zoho Sign
```json
{
  "accessToken": "1000.xxxxxxxx.xxxxxxxx",
  "clientId": "1000.XXXXXXXXXXXXXXXXX",
  "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

---

## Data Submission Format

**Preferred Methods:**
1. Excel workbook with sheets: Buildings, Cabins, MeetingRooms, Users, Credentials
2. JSON files: `buildings.json`, `cabins.json`, `meeting-rooms.json`, `users.json`
3. Secure credentials via password-protected file or secure portal

**Contact:** support@yourdomain.com for submission
