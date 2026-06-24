const { initializeApp: initializeAdminApp, cert } = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const firebaseCompat = require('firebase/compat/app');
require('firebase/compat/firestore');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

// Client configuration mapping for frontend client SDK / web compat fallback
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: process.env.FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: process.env.FIREBASE_APP_ID || "YOUR_APP_ID",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "YOUR_MEASUREMENT_ID"
};

let db = null;
let adminAuth = null;
let isConfigured = false;

try {
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

  // Option 1: Try local serviceAccountKey.json first (development environment)
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    const adminApp = initializeAdminApp({
      credential: cert(serviceAccount)
    });
    db = getFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    isConfigured = true;
    console.log("Firebase Admin SDK initialized successfully via serviceAccountKey.json.");
  }
  // Option 2: Try FIREBASE_SERVICE_ACCOUNT environment variable (Vercel / Production environment)
  else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const adminApp = initializeAdminApp({
      credential: cert(serviceAccount)
    });
    db = getFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    isConfigured = true;
    console.log("Firebase Admin SDK initialized successfully via FIREBASE_SERVICE_ACCOUNT env var.");
  }
  // Option 3: Try individual env variables (Vercel / Production environment)
  else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    const adminApp = initializeAdminApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
    db = getFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    isConfigured = true;
    console.log("Firebase Admin SDK initialized successfully via individual env vars.");
  }
  // Option 4: Web Compat SDK Mode via client credentials (fallback for Local or Vercel with Client Config only)
  else if (
    firebaseConfig.projectId && firebaseConfig.projectId !== "YOUR_PROJECT_ID" &&
    firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY"
  ) {
    const app = firebaseCompat.initializeApp(firebaseConfig);
    db = app.firestore();
    db.settings({ experimentalAutoDetectLongPolling: true }); // Prevent connection leaks/timeouts on Vercel
    isConfigured = true;
    console.log("Firebase Web Compat SDK initialized successfully on backend (Long Polling active).");
  }
  else {
    console.warn("Firebase not configured on backend. Falling back to local db.json storage.");
  }
} catch (error) {
  console.error("Failed to initialize Firebase on backend:", error);
}

module.exports = {
  db,
  adminAuth,
  isConfigured,
  firebaseConfig
};
