import express from 'express';
import eventController from '../controllers/eventController.js';
import authMiddleware from '../middlewares/authVerify.js';
import memberMiddleware from '../middlewares/memberMiddleware.js';

const router = express.Router();

const {
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
} = eventController;

// Admin/Community routes (require admin auth)
// NOTE: Role/permission middleware can be added later. For now, protect with auth only.
router.post('/', authMiddleware, createEvent);
router.patch('/:id/publish', authMiddleware, publishEvent);
router.patch('/:id/complete', authMiddleware, completeEvent);
router.patch('/:id/cancel', authMiddleware, cancelEvent);
router.patch('/:id/attendance', authMiddleware, markAttendance);
router.put('/:id', authMiddleware, updateEvent);
router.delete('/:id', authMiddleware, deleteEvent);

// Public/Member routes
router.get('/', getEvents); // Public - can filter by status=published
router.get('/:id', getEvent); // Public - single event details

// Member-only routes (require member auth)
router.post('/:id/rsvp', memberMiddleware, rsvpEvent);
router.delete('/:id/rsvp', memberMiddleware, cancelRsvp);

export default router;
