import express from 'express';
import {
  createAnnouncement,
  getAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  toggleLike,
  getActiveAnnouncements,
  getAnnouncementStats
} from '../controllers/announcementController.js';
import authMiddleware from '../middlewares/authVerify.js';
import universalMiddleware from '../middlewares/universalAuthVerify.js';
import multer from 'multer';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// Upload middleware for announcement images
const uploadAnnouncementImages = upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'mainImage', maxCount: 1 },
  { name: 'gallery', maxCount: 10 }
]);

// Error handling middleware for file uploads
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: err.message
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
};

// Admin routes (require authentication)
router.post('/', authMiddleware, uploadAnnouncementImages, handleUploadError, createAnnouncement);
router.put('/:id', authMiddleware, uploadAnnouncementImages, handleUploadError, updateAnnouncement);
router.delete('/:id', authMiddleware, deleteAnnouncement);

// Public/Member routes
router.get('/', getAnnouncements); // Get all announcements with filters
router.get('/active', getActiveAnnouncements); // Get active announcements for display
router.get('/stats', authMiddleware, getAnnouncementStats); // Get statistics (admin only)
router.get('/:id', getAnnouncementById); // Get single announcement

// Engagement routes (require authentication)
router.post('/:id/like', universalMiddleware, toggleLike); // Toggle like

export default router;
