# CafeGo - Mess & Canteen Feedback & Pre-Order System

CafeGo is a modern web application designed to streamline meal pre-ordering, inventory tracking, and student feedback management for university and college mess/canteen halls. The platform includes customized portals for Students, Kitchen/Chef staff, and Administrators, and integrates Google Gemini AI to analyze raw student feedback into operational guidelines for the kitchen.

---

## 🚀 Key Features

### 👨‍🎓 Student Portal
* **Live Menu Browsing:** View dishes dynamically categorised by meals (Breakfast, Lunch, Snacks, Dinner) with real-time stock levels (`Available`, `Low Stock`, `Out Of Stock`), ratings, and Veg/Non-veg tags.
* **Pre-Ordering System:** Order items in advance by choosing specific pickup slots and detailing custom cooking instructions.
* **Live Order Lifecycle Tracking:** Monitor orders through four progressive stages: `Pending` ➔ `Preparing` ➔ `Ready` ➔ `Handed Over`.
* **Instant Validation Tokens:** Auto-generated QR code payloads and tokens for fast, paperless checkouts at the serving counter.
* **Feedback Submission:** Rate dishes out of 5 stars and submit comment feedback directly associated with specific menu items.

### 🍳 Kitchen & Chef Portal
* **Real-time Order Dashboard:** View incoming, preparing, and ready orders grouped logically.
* **Order Status Updates:** Update preparation stages in a single click (triggers timestamps dynamically like `preparingAt`, `readyAt`, `handedOverAt`).
* **AI Daily Kitchen Briefing:** Read daily generated briefings containing sentiment summaries of student feedback, critical kitchen alerts, and cooking adjustments.

### 🔑 Admin Portal
* **Inventory Management:** Full stock level adjustment panel with transactional safety to prevent double-deductions.
* **Auditing Logs:** Track automated stock deductions (from checkouts) and manual additions/reductions with exact actor logs.
* **Menu Control:** Add, edit, or delete items on the menu including prep times, pricing, stock thresholds, and categories.
* **Sync & System Control:** Seed database, synchronize mock schemas, and manage registered credentials.

---

## 🛠 Tech Stack & Architecture

* **Frontend:** Single Page Applications (SPA) built using modern, responsive Vanilla HTML, CSS (featuring high-fidelity design styles, micro-animations, glassmorphism, and responsive states), and vanilla JavaScript.
* **Backend:** Node.js with Express.js REST APIs.
* **Database & Storage:**
  * **Firebase Firestore:** Enterprise-grade Cloud Firestore implementation with robust transactions for inventory safety, order states, and auditing logs.
  * **JSON Fallback:** Operates via a local `db.json` file when Firebase configuration isn't supplied or initialized.
* **AI Integration:** Google Gemini API (`gemini-3-flash-preview`) via the `@google/generative-ai` SDK. Automatically analyses daily student comments to extract positive highlights, kitchen alerts, and suggestions (falls back to a rule-based Local NLP analyzer if no API Key is set).

---

## 📁 Directory Structure

```
├── .env                        # Port and Firebase Web SDK variables
├── db.json                     # Local JSON database fallback
├── firebase-config.js          # Multi-mode Firebase SDK config/initialisation
├── import-to-firestore.js      # Utility script to seed db.json into Firestore
├── package.json                # Project dependencies and startup scripts
├── server.js                   # REST APIs, Express Server, and AI compiler
├── serviceAccountKey.json      # Google Service Account JSON (dev environment)
├── vercel.json                 # Deploy configuration for Vercel builds
└── public/                     # Static Web Files
    ├── index.html              # Main App entry page (student/staff selector)
    ├── css/                    # Theme stylesheets
    ├── student/                # Student Pre-ordering & Feedback Portal
    ├── kitchen/                # Kitchen / Chef live dashboard
    └── admin/                  # Admin inventory, audit, and menu dashboard
```

---

## ⚙ Setup & Installation

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) (v16+) installed.

### 2. Install Dependencies
Clone the repository and run:
```bash
npm install
```

### 3. Environment Variables (`.env`)
Create a `.env` file in the root directory. Copy and complete the following variables:
```env
PORT=3000

# Firebase configuration
FIREBASE_API_KEY=YOUR_API_KEY
FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN
FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
FIREBASE_STORAGE_BUCKET=YOUR_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID
FIREBASE_APP_ID=YOUR_APP_ID
FIREBASE_MEASUREMENT_ID=YOUR_MEASUREMENT_ID

# (Optional) Google Gemini API Key for feedback insight summarization
GEMINI_API_KEY=YOUR_GEMINI_KEY
```

### 4. Database Setup (Choose Option A or B)

#### Option A: Local Mock Database (Default Fallback)
If no Firebase credentials or `.env` details are provided, CafeGo automatically runs on the local `db.json` file. No further steps are needed.

#### Option B: Firebase Cloud Firestore (Recommended)
1. Register a project in the [Firebase Console](https://console.firebase.google.com/).
2. In Project Settings, generate a new **Private Key** under **Service Accounts**.
3. Save this file in the root directory as **`serviceAccountKey.json`**.
4. To seed your Firestore instance with initial menu items, registered student IDs, and credentials, run the import utility:
   ```bash
   node import-to-firestore.js
   ```

---

## 🚀 Running the App

Start the development server:
```bash
npm run dev
```
The server will start, print the synchronization status, and listen at **`http://localhost:3000`**.

---

## 📡 API Reference

### 🍔 Menu Endpoints
* `GET /api/menu` - Fetch all menu items.
* `POST /api/menu` - Add a new menu item.
* `PUT /api/menu/:id` - Edit properties of an item.
* `DELETE /api/menu/:id` - Remove a menu item.
* `POST /api/menu/:id/adjust-stock` - Atomically add or reduce stock and update status.

### 📋 Order Endpoints
* `GET /api/orders` - Fetch all orders (auto-sorted by creation date).
* `POST /api/orders` - Place a new order (runs a Firestore transaction validating and deducting stock, logging logs).
* `PUT /api/orders/:id` - Update status (`Preparing`, `Ready`, `Handed Over`) and register timestamps.

### 🧠 AI insights Endpoints
* `GET /api/insights/summary` - Fetch the latest briefing.
* `POST /api/insights/generate` - Trigger feedback analysis using Gemini or local NLP.

### 🔑 Authentication Endpoints
* `POST /api/auth/validate-id` - Validate student/staff college ID credentials and passwords.
