import multer from "multer";

// Use in-memory storage similar to ezstays-backend
const storage = multer.memoryStorage();

// Base uploader
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
});

export default upload;

// Flexible: accept any fields for KYC uploads
export const kycUploads = upload.any();
