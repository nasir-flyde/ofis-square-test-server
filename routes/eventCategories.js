import express from 'express';
import authMiddleware from '../middlewares/authVerify.js';
import eventCategoryController from '../controllers/eventCategoryController.js';

const router = express.Router();

const { 
  createEventCategory,
  getEventCategories,
  getEventCategory,
  updateEventCategory,
  deleteEventCategory
} = eventCategoryController;

// Admin routes (use auth; add role/permission middleware later if needed)
router.post('/', authMiddleware, createEventCategory);
router.put('/:id', authMiddleware, updateEventCategory);
router.delete('/:id', authMiddleware, deleteEventCategory);

// Public routes
router.get('/', getEventCategories);
router.get('/:id', getEventCategory);

export default router;
