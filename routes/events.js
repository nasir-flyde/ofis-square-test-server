import express from 'express';
import eventController from '../controllers/eventController.js';
import authMiddleware from '../middlewares/authVerify.js';
import memberMiddleware from '../middlewares/memberMiddleware.js';
import universalMiddleware from '../middlewares/universalAuthVerify.js';
import { uploadEventImages, handleUploadError } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

const {
  createEvent,
  publishEvent,
  getEvents,
  getEvent,
  getEventRsvps,
  rsvpEvent,
  cancelRsvp,
  markAttendance,
  completeEvent,
  cancelEvent,
  updateEvent,
  deleteEvent
} = eventController;

// Admin/Community routes (require admin auth)
// NOTE: Role/permission middleware can be added later. For now, protect with auth only.
router.post('/', authMiddleware, uploadEventImages, handleUploadError, createEvent);
router.patch('/:id/publish', authMiddleware, publishEvent);
router.patch('/:id/complete', authMiddleware, completeEvent);
router.patch('/:id/cancel', authMiddleware, cancelEvent);
router.patch('/:id/attendance', authMiddleware, markAttendance);
router.put('/:id', authMiddleware, uploadEventImages, handleUploadError, updateEvent);
router.delete('/:id', authMiddleware, deleteEvent);

// Public/Member routes
router.get('/', getEvents); // Public - can filter by status=published
router.get('/:id', getEvent); // Public - single event details
router.get('/:id/rsvps', authMiddleware, getEventRsvps); // Admin - enriched RSVPs

// RSVP routes (allow member tokens and client tokens with memberId in body)
router.post('/:id/rsvp', universalMiddleware, rsvpEvent);
router.delete('/:id/rsvp', universalMiddleware, cancelRsvp);

export default router;
