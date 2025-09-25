import Event from '../models/eventModel.js';
import EventCategory from '../models/eventCategoryModel.js';
import Member from '../models/memberModel.js';
import Building from '../models/buildingModel.js';
import MeetingRoom from '../models/meetingRoomModel.js';
import WalletService from '../services/walletService.js';
import { logCRUDActivity } from '../utils/activityLogger.js';

// Create Event (Admin/Community)
const createEvent = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      startDate,
      endDate,
      location,
      capacity,
      creditsRequired
    } = req.body;

    // Validate required fields
    if (!title || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Title, startDate, and endDate are required'
      });
    }

    // Validate dates
    if (new Date(endDate) <= new Date(startDate)) {
      return res.status(400).json({
        success: false,
        message: 'End date must be after start date'
      });
    }

    // Validate category if provided
    if (category) {
      const categoryExists = await EventCategory.findById(category);
      if (!categoryExists) {
        return res.status(400).json({
          success: false,
          message: 'Invalid event category'
        });
      }
    }

    // Validate building/room if provided
    if (location?.building) {
      const buildingExists = await Building.findById(location.building);
      if (!buildingExists) {
        return res.status(400).json({
          success: false,
          message: 'Invalid building'
        });
      }
    }

    if (location?.room) {
      const roomExists = await MeetingRoom.findById(location.room);
      if (!roomExists) {
        return res.status(400).json({
          success: false,
          message: 'Invalid meeting room'
        });
      }
    }

    // Clean up empty string values for ObjectId fields
    const cleanedData = {
      title,
      description,
      category: category && category.trim() !== '' ? category : undefined,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      location: {
        building: location?.building && location.building.trim() !== '' ? location.building : undefined,
        room: location?.room && location.room.trim() !== '' ? location.room : undefined,
        address: location?.address || undefined
      },
      capacity: capacity || 0,
      creditsRequired: creditsRequired || 0,
      createdBy: req.user.id,
      status: 'draft'
    };

    const event = new Event(cleanedData);

    await event.save();

    // Log activity
    await logCRUDActivity(req.user.id, 'CREATE', 'Event', event._id, null, event.toObject());

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      data: event
    });

  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create event',
      error: error.message
    });
  }
};

// Publish Event
const publishEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (event.status === 'published') {
      return res.status(400).json({
        success: false,
        message: 'Event is already published'
      });
    }

    if (event.status === 'completed' || event.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot publish completed or cancelled event'
      });
    }

    const oldStatus = event.status;
    event.status = 'published';
    await event.save();

    // Log activity
    await logCRUDActivity(req.user.id, 'UPDATE', 'Event', event._id, 
      { status: oldStatus }, { status: 'published' });

    res.json({
      success: true,
      message: 'Event published successfully',
      data: event
    });

  } catch (error) {
    console.error('Publish event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to publish event',
      error: error.message
    });
  }
};

// List Events (with filtering)
const getEvents = async (req, res) => {
  try {
    const {
      status,
      category,
      building,
      upcoming,
      page = 1,
      limit = 20,
      search
    } = req.query;

    const query = {};
    
    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by category
    if (category) {
      query.category = category;
    }

    // Filter by building
    if (building) {
      query['location.building'] = building;
    }

    // Filter upcoming events
    if (upcoming === 'true') {
      query.startDate = { $gte: new Date() };
    }

    // Search in title and description
    if (search) {
      query.$text = { $search: search };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const events = await Event.find(query)
      .populate('category', 'name color icon')
      .populate('location.building', 'name address')
      .populate('location.room', 'name capacity')
      .populate('createdBy', 'name email')
      .sort({ startDate: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Event.countDocuments(query);

    // Add computed fields
    const eventsWithCounts = events.map(event => ({
      ...event.toObject(),
      rsvpCount: event.rsvps.length,
      attendanceCount: event.attendance.length,
      isAvailable: event.capacity === 0 || event.rsvps.length < event.capacity
    }));

    res.json({
      success: true,
      data: eventsWithCounts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalRecords: total,
        hasMore: skip + events.length < total
      }
    });

  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events',
      error: error.message
    });
  }
};

// Get Single Event
const getEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id)
      .populate('category', 'name color icon')
      .populate('location.building', 'name address')
      .populate('location.room', 'name capacity')
      .populate('createdBy', 'name email')
      .populate('rsvps', 'name email phone')
      .populate('attendance', 'name email phone');

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const eventData = {
      ...event.toObject(),
      rsvpCount: event.rsvps.length,
      attendanceCount: event.attendance.length,
      isAvailable: event.capacity === 0 || event.rsvps.length < event.capacity
    };

    res.json({
      success: true,
      data: eventData
    });

  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch event',
      error: error.message
    });
  }
};

// RSVP for Event (Member)
const rsvpEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.memberId;

    if (!memberId) {
      return res.status(400).json({
        success: false,
        message: 'Member ID required'
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if event is published
    if (event.status !== 'published') {
      return res.status(400).json({
        success: false,
        message: 'Event is not available for RSVP'
      });
    }

    // Check if event has already started
    if (new Date() >= event.startDate) {
      return res.status(400).json({
        success: false,
        message: 'Cannot RSVP for events that have already started'
      });
    }

    // Check if already RSVP'd
    if (event.rsvps.includes(memberId)) {
      return res.status(400).json({
        success: false,
        message: 'Already RSVP\'d for this event'
      });
    }

    // Check capacity
    if (event.capacity > 0 && event.rsvps.length >= event.capacity) {
      return res.status(400).json({
        success: false,
        message: 'Event is at full capacity'
      });
    }

    // Check and deduct credits if required
    if (event.creditsRequired > 0) {
      const member = await Member.findById(memberId).populate('clientId');
      if (!member || !member.clientId) {
        return res.status(400).json({
          success: false,
          message: 'Member or client not found'
        });
      }

      try {
        await WalletService.consumeCreditsWithOverdraft(
          member.clientId._id,
          event.creditsRequired,
          `Event RSVP: ${event.title}`,
          'event_rsvp',
          { eventId: event._id, memberId }
        );
      } catch (creditError) {
        return res.status(400).json({
          success: false,
          message: creditError.message
        });
      }
    }

    // Add to RSVP list
    event.rsvps.push(memberId);
    await event.save();

    // Log activity
    await logCRUDActivity(req.userId, 'UPDATE', 'Event', event._id, 
      null, { action: 'RSVP', memberId });

    res.json({
      success: true,
      message: 'RSVP confirmed',
      data: {
        eventId: event._id,
        creditsDeducted: event.creditsRequired
      }
    });

  } catch (error) {
    console.error('RSVP event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to RSVP for event',
      error: error.message
    });
  }
};

// Cancel RSVP
const cancelRsvp = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.memberId;

    if (!memberId) {
      return res.status(400).json({
        success: false,
        message: 'Member ID required'
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if RSVP'd
    if (!event.rsvps.includes(memberId)) {
      return res.status(400).json({
        success: false,
        message: 'No RSVP found for this event'
      });
    }

    // Refund credits if event hasn't started
    if (event.creditsRequired > 0 && new Date() < event.startDate) {
      const member = await Member.findById(memberId).populate('clientId');
      if (member && member.clientId) {
        try {
          await WalletService.addCredits(
            member.clientId._id,
            event.creditsRequired,
            `Event RSVP Refund: ${event.title}`,
            'event_rsvp_refund',
            { eventId: event._id, memberId }
          );
        } catch (refundError) {
          console.error('Credit refund error:', refundError);
          // Continue with RSVP cancellation even if refund fails
        }
      }
    }

    // Remove from RSVP list
    event.rsvps = event.rsvps.filter(rsvp => !rsvp.equals(memberId));
    await event.save();

    // Log activity
    await logCRUDActivity(req.userId, 'UPDATE', 'Event', event._id, 
      null, { action: 'CANCEL_RSVP', memberId });

    res.json({
      success: true,
      message: 'RSVP cancelled successfully',
      data: {
        eventId: event._id,
        creditsRefunded: event.creditsRequired > 0 && new Date() < event.startDate ? event.creditsRequired : 0
      }
    });

  } catch (error) {
    console.error('Cancel RSVP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel RSVP',
      error: error.message
    });
  }
};

// Mark Attendance (Admin/Community)
const markAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberId } = req.body;

    if (!memberId) {
      return res.status(400).json({
        success: false,
        message: 'Member ID is required'
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if member RSVP'd
    if (!event.rsvps.includes(memberId)) {
      return res.status(400).json({
        success: false,
        message: 'Member did not RSVP for this event'
      });
    }

    // Check if already marked attendance
    if (event.attendance.includes(memberId)) {
      return res.status(400).json({
        success: false,
        message: 'Attendance already marked for this member'
      });
    }

    // Add to attendance
    event.attendance.push(memberId);
    await event.save();

    // Log activity
    await logCRUDActivity(req.user.id, 'UPDATE', 'Event', event._id, 
      null, { action: 'MARK_ATTENDANCE', memberId });

    res.json({
      success: true,
      message: 'Attendance marked successfully',
      data: {
        eventId: event._id,
        memberId,
        attendanceCount: event.attendance.length
      }
    });

  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark attendance',
      error: error.message
    });
  }
};

// Complete Event
const completeEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (event.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Event is already completed'
      });
    }

    const oldStatus = event.status;
    event.status = 'completed';
    await event.save();

    // Log activity
    await logCRUDActivity(req.user.id, 'UPDATE', 'Event', event._id, 
      { status: oldStatus }, { status: 'completed' });

    res.json({
      success: true,
      message: 'Event completed successfully',
      data: {
        eventId: event._id,
        rsvpCount: event.rsvps.length,
        attendanceCount: event.attendance.length,
        attendanceRate: event.rsvps.length > 0 ? (event.attendance.length / event.rsvps.length * 100).toFixed(2) : 0
      }
    });

  } catch (error) {
    console.error('Complete event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete event',
      error: error.message
    });
  }
};

// Cancel Event
const cancelEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const event = await Event.findById(id).populate({
      path: 'rsvps',
      populate: { path: 'clientId' }
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (event.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Event is already cancelled'
      });
    }

    if (event.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed event'
      });
    }

    // Refund credits to all RSVP'd members if event required credits
    if (event.creditsRequired > 0 && event.rsvps.length > 0) {
      for (const member of event.rsvps) {
        if (member.clientId) {
          try {
            await WalletService.addCredits(
              member.clientId._id,
              event.creditsRequired,
              `Event Cancelled Refund: ${event.title}`,
              'event_cancelled_refund',
              { eventId: event._id, memberId: member._id, reason }
            );
          } catch (refundError) {
            console.error(`Credit refund error for member ${member._id}:`, refundError);
          }
        }
      }
    }

    const oldStatus = event.status;
    event.status = 'cancelled';
    await event.save();

    // Log activity
    await logCRUDActivity(req.user.id, 'UPDATE', 'Event', event._id, 
      { status: oldStatus }, { status: 'cancelled', reason });

    res.json({
      success: true,
      message: 'Event cancelled successfully',
      data: {
        eventId: event._id,
        refundedMembers: event.rsvps.length,
        totalCreditsRefunded: event.creditsRequired * event.rsvps.length
      }
    });

  } catch (error) {
    console.error('Cancel event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel event',
      error: error.message
    });
  }
};

// Update Event
const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Don't allow updates to completed or cancelled events
    if (event.status === 'completed' || event.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update completed or cancelled events'
      });
    }

    const oldData = event.toObject();
    
    // Clean up empty string values for ObjectId fields in updates
    const cleanedUpdates = { ...updates };
    
    if (cleanedUpdates.category !== undefined) {
      cleanedUpdates.category = cleanedUpdates.category && cleanedUpdates.category.trim() !== '' ? cleanedUpdates.category : undefined;
    }
    
    if (cleanedUpdates.location) {
      cleanedUpdates.location = {
        building: cleanedUpdates.location.building && cleanedUpdates.location.building.trim() !== '' ? cleanedUpdates.location.building : undefined,
        room: cleanedUpdates.location.room && cleanedUpdates.location.room.trim() !== '' ? cleanedUpdates.location.room : undefined,
        address: cleanedUpdates.location.address || undefined
      };
    }

    const allowedUpdates = ['title', 'description', 'category', 'startDate', 'endDate', 'location', 'capacity', 'creditsRequired'];
    allowedUpdates.forEach(field => {
      if (cleanedUpdates[field] !== undefined) {
        event[field] = cleanedUpdates[field];
      }
    });

    await event.save();

    // Log activity with proper before/after comparison
    await logCRUDActivity(req, 'UPDATE', 'Event', event._id, {
      before: {
        title: oldData.title,
        description: oldData.description,
        startDate: oldData.startDate,
        endDate: oldData.endDate,
        capacity: oldData.capacity,
        creditsRequired: oldData.creditsRequired,
        category: oldData.category,
        location: oldData.location,
        status: oldData.status
      },
      after: {
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        capacity: event.capacity,
        creditsRequired: event.creditsRequired,
        category: event.category,
        location: event.location,
        status: event.status
      }
    }, {
      eventTitle: event.title,
      updatedFields: allowedUpdates.filter(field => cleanedUpdates[field] !== undefined)
    });

    res.json({
      success: true,
      message: 'Event updated successfully',
      data: event
    });

  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update event',
      error: error.message
    });
  }
};

// Delete Event
const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Only allow deletion of draft events
    if (event.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft events can be deleted'
      });
    }

    await Event.findByIdAndDelete(id);

    // Log activity
    await logCRUDActivity(req.user.id, 'DELETE', 'Event', event._id, event.toObject(), null);

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete event',
      error: error.message
    });
  }
};

export default {
  createEvent,
  publishEvent,
  getEvents,
  getEvent,
  rsvpEvent,
  cancelRsvp,
  markAttendance,
  completeEvent,
  cancelEvent,
  updateEvent,
  deleteEvent
};
