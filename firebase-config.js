const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const dotenv = require('dotenv');

dotenv.config();

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

if (firebaseConfig.projectId && firebaseConfig.projectId !== "YOUR_PROJECT_ID") {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isConfigured = true;
    console.log("Firebase App and Firestore initialized successfully on backend.");
  } catch (error) {
    console.error("Failed to initialize Firebase App on backend:", error);
  }
} else {
  console.warn("Firebase not configured on backend. Placeholder values detected.");
}

module.exports = {
  db,
  isConfigured,
  firebaseConfig
};
