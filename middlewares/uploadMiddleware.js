import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadsDir = 'uploads/screenshots';
const buildingPhotosDir = 'uploads/buildings';
const meetingRoomImagesDir = 'uploads/meeting-rooms';
const eventImagesDir = 'uploads/events';

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(buildingPhotosDir)) {
  fs.mkdirSync(buildingPhotosDir, { recursive: true });
}

if (!fs.existsSync(meetingRoomImagesDir)) {
  fs.mkdirSync(meetingRoomImagesDir, { recursive: true });
}

if (!fs.existsSync(eventImagesDir)) {
  fs.mkdirSync(eventImagesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};


const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5
  },
  fileFilter: fileFilter
});

// Building photos storage configuration
const buildingPhotosStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, buildingPhotosDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'building-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const buildingPhotosUpload = multer({
  storage: buildingPhotosStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file for building photos
    files: 10 // Allow up to 10 photos per building
  },
  fileFilter: fileFilter
});

// Meeting room images storage configuration (using memory storage for ImageKit)
const meetingRoomImagesUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file for meeting room images
    files: 10 // Allow up to 10 images per meeting room
  },
  fileFilter: fileFilter
});

// Event images storage configuration (using memory storage for ImageKit)
const eventImagesUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file for event images
    files: 2 // Allow thumbnail and main image
  },
  fileFilter: fileFilter
});

export const uploadScreenshots = upload.array('screenshots', 5);
export const uploadBuildingPhotos = buildingPhotosUpload.array('photos', 10);
export const uploadMeetingRoomImages = meetingRoomImagesUpload.array('images', 10);
export const uploadEventImages = eventImagesUpload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'mainImage', maxCount: 1 }
]);

export const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        message: 'File too large. Maximum size is 5MB per file.' 
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        success: false, 
        message: 'Too many files. Maximum 5 files allowed.' 
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ 
        success: false, 
        message: 'Unexpected field name for file upload.' 
      });
    }
  }
  
  if (error.message === 'Only image files are allowed!') {
    return res.status(400).json({ 
      success: false, 
      message: 'Only image files are allowed.' 
    });
  }
  
  next(error);
};
