import DayPass from "../models/dayPassModel.js";
import Visitor from "../models/visitorModel.js";
import User from "../models/userModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";
import crypto from "crypto";

// Central issuance service for day passes
export const issueDayPass = async (dayPassId, session = null) => {
  try {
    const dayPass = await DayPass.findById(dayPassId)
      .populate('building')
      .session(session);
    
    if (!dayPass) {
      throw new Error("Day pass not found");
    }

    if (dayPass.status === "issued") {
      return { success: true, message: "Day pass already issued" };
    }

    // Update status to issued
    dayPass.status = "issued";
    
    // Create visitor record if not already created and booking is for self
    if (!dayPass.visitorCreated && dayPass.bookingFor === "self") {
      await createVisitorForSelfBooking(dayPass, session);
      dayPass.visitorCreated = true;
      dayPass.status = "invited";
    }
    
    // For "other" bookings, create visitor if draft details exist
    if (!dayPass.visitorCreated && dayPass.bookingFor === "other" && dayPass.visitDate && dayPass.visitorDetailsDraft) {
      await createVisitorForOtherBooking(dayPass, session);
      dayPass.visitorCreated = true;
    }

    await dayPass.save({ session });
    
    return { success: true, message: "Day pass issued successfully" };
  } catch (error) {
    console.error("Issuance error:", error);
    throw error;
  }
};

// Create visitor record for self bookings
const createVisitorForSelfBooking = async (dayPass, session) => {
  try {
    // Get user details from customer
    let customerDetails = null;
    let customerType = null; // 'guest' | 'member' | 'client'
    
    // Try to find customer as Guest first
    customerDetails = await Guest.findById(dayPass.customer).session(session);
    
    // If not found as Guest, try as Member
    if (!customerDetails) {
      const memberDoc = await Member.findById(dayPass.customer)
        .populate('user')
        .session(session);
      if (memberDoc) {
        customerType = 'member';
        if (memberDoc.user) {
          customerDetails = {
            name: memberDoc.user.name,
            email: memberDoc.user.email,
            phone: memberDoc.user.phone
          };
        }
      }
    } else {
      customerType = 'guest';
    }

    // If still not found, try as Client
    if (!customerDetails) {
      const clientDoc = await Client.findById(dayPass.customer).session(session);
      if (clientDoc) {
        customerType = 'client';
        customerDetails = {
          name: clientDoc.contactPerson || clientDoc.companyName || 'Client',
          email: clientDoc.email || undefined,
          phone: clientDoc.phone || undefined
        };
      }
    }

    if (!customerDetails) {
      throw new Error("Customer details not found for self booking");
    }

    // Use visitDate if available, otherwise use current date as fallback
    const visitDate = dayPass.visitDate ? new Date(dayPass.visitDate) : new Date();
    const arrivalTime = new Date(visitDate);
    arrivalTime.setHours(0, 0, 0, 0);
    
    const departureTime = new Date(visitDate);
    departureTime.setHours(23, 59, 59, 999);

    // Update day pass with visitor details
    dayPass.visitorName = customerDetails.name;
    dayPass.visitorPhone = customerDetails.phone;
    dayPass.visitorEmail = customerDetails.email;
    dayPass.expectedArrivalTime = arrivalTime;
    dayPass.expectedDepartureTime = departureTime;
    dayPass.date = visitDate; // Set actual visit date
    dayPass.qrCode = crypto.randomBytes(16).toString('hex');
    dayPass.qrExpiresAt = departureTime; 

    // Create visitor record in Visitor collection
    const visitor = new Visitor({
      name: customerDetails.name,
      email: customerDetails.email,
      phone: customerDetails.phone,
      building: dayPass.building,
      expectedVisitDate: visitDate,
      expectedArrivalTime: arrivalTime,
      expectedDepartureTime: departureTime,
      dayPass: dayPass._id,
      status: 'invited',
      createdBy: dayPass.customer,
      // Set host based on customer type
      hostMember: customerType === 'member' ? dayPass.customer : null,
      hostClient: customerType === 'client' ? dayPass.customer : null,
      hostGuest: customerType === 'guest' ? dayPass.customer : null
    });

    await visitor.save({ session });

    console.log(`Created visitor record for self booking: ${customerDetails.name} on ${visitDate.toDateString()}`);
  } catch (error) {
    console.error("Error creating visitor for self booking:", error);
    throw error;
  }
};

// Create visitor record for other bookings using draft details
const createVisitorForOtherBooking = async (dayPass, session) => {
  try {
    const draft = dayPass.visitorDetailsDraft;
    
    if (!draft || !draft.name) {
      throw new Error("Visitor draft details incomplete for other booking");
    }

    // Set full day time window (00:00 to 23:59)
    const visitDate = new Date(dayPass.visitDate);
    const arrivalTime = new Date(visitDate);
    arrivalTime.setHours(0, 0, 0, 0);
    
    const departureTime = new Date(visitDate);
    departureTime.setHours(23, 59, 59, 999);

    // Update day pass with visitor details from draft
    dayPass.visitorName = draft.name;
    dayPass.visitorPhone = draft.phone;
    dayPass.visitorEmail = draft.email;
    dayPass.visitorCompany = draft.company;
    dayPass.purpose = draft.purpose;
    dayPass.expectedArrivalTime = arrivalTime;
    dayPass.expectedDepartureTime = departureTime;
    dayPass.date = visitDate; // Set actual visit date

    console.log(`Created visitor record for other booking: ${draft.name} on ${visitDate.toDateString()}`);
  } catch (error) {
    console.error("Error creating visitor for other booking:", error);
    throw error;
  }
};

// Batch issue multiple day passes
export const issueDayPassBatch = async (dayPassIds, session = null) => {
  const results = [];
  
  for (const passId of dayPassIds) {
    try {
      const result = await issueDayPass(passId, session);
      results.push({ passId, ...result });
    } catch (error) {
      results.push({ passId, success: false, error: error.message });
    }
  }
  
  return results;
};
