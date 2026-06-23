const admin = require('firebase-admin');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

// Client configuration mapping for frontend client SDK
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
let isConfigured = false;

try {
  // Option 1: Try local serviceAccountKey.json first (development environment)
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    isConfigured = true;
    console.log("Firebase Admin SDK initialized successfully via serviceAccountKey.json.");
  }
  // Option 2: Try FIREBASE_SERVICE_ACCOUNT environment variable (Vercel / Production environment)
  else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    isConfigured = true;
    console.log("Firebase Admin SDK initialized successfully via FIREBASE_SERVICE_ACCOUNT env var.");
  }
  // Option 3: Try individual env variables (Vercel / Production environment)
  else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
    db = admin.firestore();
    isConfigured = true;
    console.log("Firebase Admin SDK initialized successfully via individual env vars.");
  }
  // Option 4: Try Application Default Credentials / Project ID fallback (if running inside GCP environment)
  else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== "YOUR_PROJECT_ID") {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID
    });
    db = admin.firestore();
    isConfigured = true;
    console.log("Firebase Admin SDK initialized successfully via project ID fallback.");
  }
  else {
    console.warn("Firebase Admin SDK not configured on backend. Falling back to local db.json storage.");
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin SDK on backend:", error);
}

module.exports = {
  db,
  isConfigured,
  firebaseConfig
};
