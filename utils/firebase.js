import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

// We check if the app is already initialized to avoid errors on hot reload
if (!admin.apps.length) {
    try {
        // If you have a service account file, use it. 
        // Otherwise, we can use environment variables.
        // Assuming the user will provide credentials in .env if needed.

        // For now, we initialize with default credentials or dummy if not provided
        // to prevent the app from crashing.
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('✅ Firebase Admin initialized with service account.');
        } else {
            console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not found in .env. Push notifications might not work.');
            // Initialize with project ID if available
            if (process.env.FIREBASE_PROJECT_ID) {
                admin.initializeApp({
                    projectId: process.env.FIREBASE_PROJECT_ID
                });
                console.log('✅ Firebase Admin initialized with project ID.');
            }
        }
    } catch (err) {
        console.error('❌ Firebase Admin initialization error:', err.message);
    }
}

export default admin;
