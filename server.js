const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/generative-ai');

// Load environment variables
dotenv.config();

const { db: firestoreDb, isConfigured: isFirebaseConfigured, firebaseConfig } = require('./firebase-config');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read database
async function readDB() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading db.json, returning empty structure", error);
    return { menu_items: [], orders: [], feedback: [], ai_briefing: [] };
  }
}



// Expose Firebase config
app.get('/api/config', (req, res) => {
  res.json({ firebaseConfig });
});

// ==========================================
// MENU API ENDPOINTS
// ==========================================

// Get all menu items
// Get all menu items
app.get('/api/menu', async (req, res) => {
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('menu_items').get();
      const items = [];
      snapshot.forEach(doc => {
        items.push({ id: Number(doc.id), ...doc.data() });
      });
      items.sort((a, b) => a.id - b.id);
      return res.json(items);
    } catch (error) {
      console.error("Error fetching menu from Firestore:", error);
      return res.status(500).json({ error: "Failed to fetch menu items from Firestore" });
    }
  }
  const db = await readDB();
  res.json(db.menu_items || []);
});

// Add menu item
app.post('/api/menu', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured. Exclusive Firestore mode is enabled." });
  }

  try {
    const snapshot = await firestoreDb.collection('menu_items').get();
    const ids = [];
    snapshot.forEach(doc => ids.push(Number(doc.id)));
    const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

    const stock = req.body.stock !== undefined ? parseInt(req.body.stock) : 25;
    const lowStockThreshold = req.body.lowStockThreshold !== undefined ? parseInt(req.body.lowStockThreshold) : 5;
    let status = 'Available';
    if (stock === 0) {
      status = 'Out Of Stock';
    } else if (stock <= lowStockThreshold) {
      status = 'Low Stock';
    }

    const newItem = {
      id: nextId,
      name: req.body.name,
      category: req.body.category || 'Lunch',
      price: parseFloat(req.body.price),
      is_veg: req.body.is_veg === undefined ? true : req.body.is_veg,
      is_available: stock > 0,
      image_url: req.body.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500',
      prep_time: req.body.prep_time || '10m',
      back_time: req.body.back_time || '',
      rating: 5.0,
      orders_count: 0,
      stock: stock,
      lowStockThreshold: lowStockThreshold,
      soldToday: 0,
      status: status
    };

    const { id, ...bodyWithoutId } = newItem;
    await firestoreDb.collection('menu_items').doc(String(newItem.id)).set(bodyWithoutId);
    res.status(201).json(newItem);
  } catch (e) {
    console.error("Error writing menu item to Firestore:", e);
    res.status(500).json({ error: "Failed to add menu item to Firestore" });
  }
});

// Update menu item (availability, price, category, stock text)
app.put('/api/menu/:id', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured. Exclusive Firestore mode is enabled." });
  }

  const id = parseInt(req.params.id);
  try {
    const docSnap = await firestoreDb.collection('menu_items').doc(String(id)).get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    const item = { id, ...docSnap.data() };
    const updatedItem = {
      ...item,
      ...req.body
    };

    const { id: _, ...bodyWithoutId } = updatedItem;
    await firestoreDb.collection('menu_items').doc(String(id)).set(bodyWithoutId);
    res.json(updatedItem);
  } catch (e) {
    console.error("Error updating menu item in Firestore:", e);
    res.status(500).json({ error: "Failed to update menu item in Firestore" });
  }
});

// Delete menu item
app.delete('/api/menu/:id', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured. Exclusive Firestore mode is enabled." });
  }

  const id = parseInt(req.params.id);
  try {
    await firestoreDb.collection('menu_items').doc(String(id)).delete();
    res.json({ message: 'Menu item deleted successfully' });
  } catch (e) {
    console.error("Error deleting menu item from Firestore:", e);
    res.status(500).json({ error: "Failed to delete menu item from Firestore" });
  }
});


// ==========================================
// ORDERS API ENDPOINTS
// ==========================================

// Get all orders
app.get('/api/orders', async (req, res) => {
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('orders').get();
      const orders = [];
      snapshot.forEach(doc => {
        orders.push({ id: Number(doc.id), ...doc.data() });
      });
      orders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return res.json(orders);
    } catch (error) {
      console.error("Error fetching orders from Firestore:", error);
      return res.status(500).json({ error: "Failed to fetch orders from Firestore" });
    }
  }
  const db = await readDB();
  res.json(db.orders || []);
});

// Place new order
app.post('/api/orders', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured. Exclusive Firestore mode is enabled." });
  }

  const orderItems = req.body.items || [];
  if (orderItems.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  try {
    const snapshot = await firestoreDb.collection('orders').get();
    const ids = [];
    snapshot.forEach(doc => ids.push(Number(doc.id)));
    const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

    const tokenNum = `#SC-${Math.floor(100 + Math.random() * 900)}`;
    const studentId = req.body.studentId || 'CS-10245-26';

    const timestamp = new Date().toISOString();
    const newOrder = {
      id: nextId,
      user_id: req.body.user_id || 1,
      user_name: req.body.user_name || 'Arjun',
      total_amount: parseFloat(req.body.total_amount),
      pickup_slot: req.body.pickup_slot || '12:30 - 12:45',
      status: 'Pending',
      token_number: tokenNum,
      items: orderItems,
      special_instructions: req.body.special_instructions || '',
      created_at: timestamp,
      
      // Persistent QR Payload Storage
      qrPayload: {
        orderId: String(nextId),
        tokenNumber: tokenNum,
        studentId: studentId
      },
      
      // Enhanced Order Timeline Tracking
      pendingAt: timestamp,
      preparingAt: null,
      readyAt: null,
      handedOverAt: null
    };

    // Use a Firestore Transaction to validate stock and update menu_items & create order
    await firestoreDb.runTransaction(async (transaction) => {
      // 1. Read all required menu items first
      const itemDocs = [];
      for (const orderItem of orderItems) {
        const itemRef = firestoreDb.collection('menu_items').doc(String(orderItem.id));
        const itemDoc = await transaction.get(itemRef);
        if (!itemDoc.exists) {
          throw new Error(`Item "${orderItem.name}" not found in menu`);
        }
        itemDocs.push({ ref: itemRef, doc: itemDoc, orderItem });
      }

      // 2. Validate stock for all items
      for (const { doc, orderItem } of itemDocs) {
        const data = doc.data();
        const currentStock = data.stock !== undefined ? data.stock : 25; // fallback default
        const reqQty = orderItem.quantity || 1;
        
        if (currentStock <= 0) {
          throw new Error(`Item "${orderItem.name}" is out of stock`);
        }
        if (reqQty > currentStock) {
          throw new Error(`Insufficient stock for "${orderItem.name}". Only ${currentStock} remaining`);
        }
      }

      // 3. Deduct stock, increment soldToday, update lastUpdated, log actions
      for (const { ref, doc, orderItem } of itemDocs) {
        const data = doc.data();
        const reqQty = orderItem.quantity || 1;
        const currentStock = data.stock !== undefined ? data.stock : 25;
        const currentSoldToday = data.soldToday !== undefined ? data.soldToday : 0;
        const lowThreshold = data.lowStockThreshold !== undefined ? data.lowStockThreshold : 5;
        
        const newStock = currentStock - reqQty;
        const newSoldToday = currentSoldToday + reqQty;
        
        let newStatus = 'Available';
        if (newStock === 0) {
          newStatus = 'Out Of Stock';
        } else if (newStock <= lowThreshold) {
          newStatus = 'Low Stock';
        }

        const currentOrdersCount = data.orders_count || 0;

        // Update menu item
        transaction.update(ref, {
          stock: newStock,
          soldToday: newSoldToday,
          status: newStatus,
          orders_count: currentOrdersCount + reqQty,
          is_available: newStock > 0,
          lastUpdated: timestamp
        });

        // Write inventory log atomically inside same transaction
        const logRef = firestoreDb.collection('inventory_logs').doc();
        transaction.set(logRef, {
          itemId: Number(orderItem.id),
          itemName: orderItem.name,
          action: 'AUTO_DEDUCTION',
          quantity: reqQty,
          quantityChanged: -reqQty,
          previousStock: currentStock,
          newStock: newStock,
          performedBy: req.body.user_name || 'Student Checkout',
          updatedBy: req.body.user_name || 'Student Checkout',
          timestamp: timestamp
        });
      }

      // 4. Create the order
      const orderRef = firestoreDb.collection('orders').doc(String(newOrder.id));
      const { id, ...bodyWithoutId } = newOrder;
      transaction.set(orderRef, bodyWithoutId);
    });

    res.status(201).json(newOrder);
  } catch (e) {
    console.error("Failed to place order via transaction:", e);
    res.status(400).json({ error: e.message || "Failed to place order in Firestore" });
  }
});

// Update order status
app.put('/api/orders/:id', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured. Exclusive Firestore mode is enabled." });
  }

  const id = parseInt(req.params.id);
  const newStatus = req.body.status;
  try {
    const orderRef = firestoreDb.collection('orders').doc(String(id));
    let updatedOrder = null;

    await firestoreDb.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(orderRef);
      if (!docSnap.exists) {
        throw new Error('Order not found');
      }

      const currentData = docSnap.data();
      const currentStatus = currentData.status;

      // 1. Scanner QR validation (if payload is provided in request)
      if (req.body.qrPayload) {
        const scanned = req.body.qrPayload;
        const stored = currentData.qrPayload;
        if (!stored ||
            String(stored.orderId) !== String(scanned.orderId) ||
            stored.tokenNumber !== scanned.token ||
            stored.studentId !== scanned.studentId) {
          throw new Error('Invalid QR Code Payload');
        }
      }

      if (newStatus === 'Handed Over' && (currentStatus === 'Handed Over' || currentStatus === 'Completed')) {
        throw new Error('Order Already Handed Over');
      }

      const timestamp = new Date().toISOString();
      updatedOrder = {
        ...currentData,
        id,
        status: newStatus
      };

      // 2. Lifecycle timeline tracking
      if (newStatus === 'Preparing') {
        updatedOrder.preparingAt = timestamp;
      } else if (newStatus === 'Ready') {
        updatedOrder.readyAt = timestamp;
      } else if (newStatus === 'Handed Over' || newStatus === 'Completed') {
        updatedOrder.status = 'Handed Over';
        updatedOrder.handedOverAt = timestamp;
      }

      const { id: _, ...bodyWithoutId } = updatedOrder;
      transaction.set(orderRef, bodyWithoutId);
    });

    res.json(updatedOrder);
  } catch (e) {
    console.error("Failed to update order in Firestore:", e);
    if (e.message === 'Order Already Handed Over' || e.message === 'Invalid QR Code Payload') {
      res.status(400).json({ error: e.message });
    } else {
      res.status(500).json({ error: e.message || "Failed to update order in Firestore" });
    }
  }
});

// ==========================================
// INVENTORY & STOCK MANAGEMENT API ENDPOINTS
// ==========================================

// Adjust Stock (Add/Reduce relative)
app.post('/api/menu/:id/adjust-stock', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured." });
  }

  const id = parseInt(req.params.id);
  const amount = parseInt(req.body.amount);
  const performedBy = req.body.performedBy || 'Admin';
  if (isNaN(amount)) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    const docRef = firestoreDb.collection('menu_items').doc(String(id));
    await firestoreDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) {
        throw new Error('Menu item not found');
      }
      const data = doc.data();
      const currentStock = data.stock !== undefined ? data.stock : 25;
      const lowThreshold = data.lowStockThreshold !== undefined ? data.lowStockThreshold : 5;
      
      const newStock = Math.max(0, currentStock + amount);
      let newStatus = 'Available';
      if (newStock === 0) {
        newStatus = 'Out Of Stock';
      } else if (newStock <= lowThreshold) {
        newStatus = 'Low Stock';
      }
      
      const timestamp = new Date().toISOString();
      const updates = {
        stock: newStock,
        status: newStatus,
        is_available: newStock > 0,
        lastUpdated: timestamp
      };

      if (amount > 0) {
        updates.lastRestockedAt = timestamp;
        updates.lastRestockedBy = performedBy;
      }

      transaction.update(docRef, updates);

      // Write inventory log atomically inside same transaction
      const logRef = firestoreDb.collection('inventory_logs').doc();
      transaction.set(logRef, {
        itemId: id,
        itemName: data.name,
        action: amount > 0 ? 'ADD_STOCK' : 'REDUCE_STOCK',
        quantity: Math.abs(amount),
        quantityChanged: amount,
        previousStock: currentStock,
        newStock: newStock,
        performedBy: performedBy,
        updatedBy: performedBy,
        timestamp: timestamp
      });
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to adjust stock:", err);
    res.status(500).json({ error: err.message });
  }
});

// Manual Stock & Threshold Update
app.post('/api/menu/:id/set-stock', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured." });
  }

  const id = parseInt(req.params.id);
  const stock = parseInt(req.body.stock);
  const lowStockThreshold = req.body.lowStockThreshold !== undefined ? parseInt(req.body.lowStockThreshold) : undefined;
  const performedBy = req.body.performedBy || 'Admin';
  if (isNaN(stock) || stock < 0) {
    return res.status(400).json({ error: 'Invalid stock value' });
  }

  try {
    const docRef = firestoreDb.collection('menu_items').doc(String(id));
    await firestoreDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) {
        throw new Error('Menu item not found');
      }
      const data = doc.data();
      const finalLowThreshold = lowStockThreshold !== undefined ? lowStockThreshold : (data.lowStockThreshold !== undefined ? data.lowStockThreshold : 5);
      
      let newStatus = 'Available';
      if (stock === 0) {
        newStatus = 'Out Of Stock';
      } else if (stock <= finalLowThreshold) {
        newStatus = 'Low Stock';
      }
      
      const timestamp = new Date().toISOString();
      const updates = {
        stock: stock,
        status: newStatus,
        is_available: stock > 0,
        lastUpdated: timestamp
      };
      if (lowStockThreshold !== undefined) {
        updates.lowStockThreshold = finalLowThreshold;
      }

      const previousStock = data.stock !== undefined ? data.stock : 25;
      const stockDiff = stock - previousStock;
      
      // Update restock metadata if stock was increased or manual setting restocked it
      if (stockDiff > 0) {
        updates.lastRestockedAt = timestamp;
        updates.lastRestockedBy = performedBy;
      }

      transaction.update(docRef, updates);

      // Write inventory log atomically inside same transaction
      const logRef = firestoreDb.collection('inventory_logs').doc();
      transaction.set(logRef, {
        itemId: id,
        itemName: data.name,
        action: 'SET_STOCK',
        quantity: Math.abs(stockDiff),
        quantityChanged: stockDiff,
        previousStock: previousStock,
        newStock: stock,
        performedBy: performedBy,
        updatedBy: performedBy,
        timestamp: timestamp
      });
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to set stock:", err);
    res.status(500).json({ error: err.message });
  }
});


// Fetch recent inventory audit trail logs
app.get('/api/inventory/logs', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured." });
  }
  try {
    const snapshot = await firestoreDb.collection('inventory_logs')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    const logs = [];
    snapshot.forEach(doc => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    res.json(logs);
  } catch (err) {
    console.error("Failed to fetch inventory logs:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// Reset Daily Sales Count
app.post('/api/menu/reset-sales', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured." });
  }

  try {
    const snapshot = await firestoreDb.collection('menu_items').get();
    const batch = firestoreDb.batch();
    snapshot.forEach(doc => {
      batch.update(doc.ref, { soldToday: 0 });
    });
    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to reset sales:", err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// FEEDBACK API ENDPOINTS
// ==========================================

// Get all feedback
app.get('/api/feedback', async (req, res) => {
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('feedback').get();
      const feedbacks = [];
      snapshot.forEach(doc => {
        feedbacks.push({ id: Number(doc.id) || doc.id, ...doc.data() });
      });
      return res.json(feedbacks);
    } catch (error) {
      console.error("Error fetching feedback from Firestore:", error);
      return res.status(500).json({ error: "Failed to fetch feedback from Firestore" });
    }
  }
  const db = await readDB();
  res.json(db.feedback || []);
});

// Submit feedback
app.post('/api/feedback', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured. Exclusive Firestore mode is enabled." });
  }

  const menu_item_id = parseInt(req.body.menu_item_id);
  const rating = parseInt(req.body.rating);

  try {
    const snapshot = await firestoreDb.collection('feedback').get();
    const ids = [];
    snapshot.forEach(doc => ids.push(Number(doc.id)));
    const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

    const newFeedback = {
      id: nextId,
      user_id: req.body.user_id || 1,
      user_name: req.body.user_name || 'Arjun',
      menu_item_id: menu_item_id,
      menu_item_name: req.body.menu_item_name || 'Item',
      rating: rating,
      comments: req.body.comments || '',
      created_at: new Date().toISOString()
    };

    // 1. Write feedback to Firestore
    const { id, ...bodyWithoutId } = newFeedback;
    await firestoreDb.collection('feedback').doc(String(newFeedback.id)).set(bodyWithoutId);

    // 2. Recalculate menu item rating in Firestore
    const itemDocRef = firestoreDb.collection('menu_items').doc(String(menu_item_id));
    const itemDoc = await itemDocRef.get();
    if (itemDoc.exists) {
      const feedbackSnapshot = await firestoreDb.collection('feedback').where('menu_item_id', '==', menu_item_id).get();
      const ratings = [];
      feedbackSnapshot.forEach(doc => ratings.push(doc.data().rating));
      if (!ratings.includes(rating)) {
        ratings.push(rating);
      }
      const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
      await itemDocRef.update({ rating: parseFloat(avgRating.toFixed(1)) });
    }

    res.status(201).json(newFeedback);
  } catch (e) {
    console.error("Error writing feedback to Firestore:", e);
    res.status(500).json({ error: "Failed to submit feedback to Firestore" });
  }
});


// ==========================================
// AI DAILY BRIEFING ENDPOINTS
// ==========================================

// Fetch latest briefing
app.get('/api/insights/summary', async (req, res) => {
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('ai_briefing').orderBy('date', 'desc').limit(1).get();
      if (!snapshot.empty) {
        return res.json(snapshot.docs[0].data());
      }
    } catch (error) {
      console.error("Error fetching AI briefing from Firestore:", error);
      return res.status(500).json({ error: "Failed to fetch AI briefing from Firestore" });
    }
  }
  const db = await readDB();
  const latestBrief = db.ai_briefing && db.ai_briefing.length > 0
    ? db.ai_briefing[db.ai_briefing.length - 1]
    : null;

  res.json(latestBrief || { date: new Date().toISOString().split('T')[0], content: "No briefing generated yet for today." });
});

// Trigger new AI briefing generation
app.post('/api/insights/generate', async (req, res) => {
  if (!isFirebaseConfigured || !firestoreDb) {
    return res.status(500).json({ error: "Firebase not configured. Exclusive Firestore mode is enabled." });
  }

  let feedbacks = [];
  try {
    const snapshot = await firestoreDb.collection('feedback').get();
    snapshot.forEach(doc => {
      feedbacks.push({ id: Number(doc.id) || doc.id, ...doc.data() });
    });
  } catch (e) {
    console.error("Error fetching feedback from Firestore for AI generation:", e);
    return res.status(500).json({ error: "Failed to read feedbacks from Firestore for AI summary" });
  }

  if (feedbacks.length === 0) {
    return res.json({
      date: new Date().toISOString().split('T')[0],
      content: "### Daily Kitchen Briefing\n\nNo student feedback has been submitted today yet."
    });
  }

  const feedbackText = feedbacks.map(f => `- [Rating: ${f.rating}★] [Item: ${f.menu_item_name}]: "${f.comments}"`).join('\n');

  let briefingContent = '';
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      let model;
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      } catch (err) {
        const genAI = new GoogleGenAI({ apiKey });
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      }

      const prompt = `
You are an expert culinary auditor and canteen kitchen advisor.
Below is raw daily feedback submitted by college students regarding the canteen food quality, taste, service, and availability.

Student Feedback Data:
${feedbackText}

Generate a concise, structured Daily Kitchen Briefing for the kitchen staff. Break it down into:
1. **Positive Highlights**: Summarize what went well (what students loved).
2. **Critical Alerts**: Group specific alerts (e.g. food too salty, cold food, running out of stock early). Be specific about which items had complaints.
3. **Actionable Suggestions**: 2-3 quick operational bullet points for tomorrow's prep (e.g., reduce salt in burger seasoning by 15%, increase prep volumes of brownies).

Make it encouraging but direct. Use Markdown format. Keep it concise so kitchen staff can read it in 1 minute.
`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      briefingContent = response.text();
    } catch (error) {
      console.error("Gemini API generation failed, falling back to mock compiler", error);
      briefingContent = generateLocalSummary(feedbacks);
    }
  } else {
    console.log("No GEMINI_API_KEY found, compiling mock summary based on feedback text");
    briefingContent = generateLocalSummary(feedbacks);
  }

  const newBrief = {
    date: new Date().toISOString().split('T')[0],
    content: briefingContent
  };

  try {
    await firestoreDb.collection('ai_briefing').doc(newBrief.date).set(newBrief);
    res.json(newBrief);
  } catch (e) {
    console.error("Error writing AI briefing to Firestore:", e);
    res.status(500).json({ error: "Failed to save briefing to Firestore" });
  }
});

// Helper for simulated summary generation
function generateLocalSummary(feedbacks) {
  const positives = [];
  const alerts = [];
  const suggestions = [];

  // Simple heuristic categories based on feedback content
  feedbacks.forEach(f => {
    const comment = f.comments.toLowerCase();
    const item = f.menu_item_name;
    const rating = f.rating;

    if (rating >= 4) {
      positives.push(`Students loved the **${item}** ("${f.comments}")`);
    } else {
      if (comment.includes('salt')) {
        alerts.push(`Seasoning alert: **${item}** was reported as too salty ("${f.comments}")`);
        suggestions.push(`Review the salt ratio in the spice mix for **${item}**.`);
      } else if (comment.includes('cold') || comment.includes('heat') || comment.includes('warm')) {
        alerts.push(`Temperature alert: **${item}** was cold at pickup ("${f.comments}")`);
        suggestions.push(`Ensure **${item}** is stored in warming trays until student pickup time slots.`);
      } else if (comment.includes('wait') || comment.includes('slow') || comment.includes('line')) {
        alerts.push(`Service delay: Long wait times at counters reported ("${f.comments}")`);
        suggestions.push(`Pre-stage ready orders 5 minutes before peak slots.`);
      } else if (comment.includes('run out') || comment.includes('out of stock') || comment.includes('sold out')) {
        alerts.push(`Availability alert: **${item}** ran out early.`);
        suggestions.push(`Increase production batch size of **${item}** by 20%.`);
      } else {
        alerts.push(`Quality complaint on **${item}**: "${f.comments}"`);
      }
    }
  });

  if (positives.length === 0) positives.push("No specific positive highlights recorded today.");
  if (alerts.length === 0) alerts.push("No critical alerts or quality complaints reported today.");
  if (suggestions.length === 0) {
    suggestions.push("Maintain standard cooking specs.");
    suggestions.push("Monitor pickup slot compliance.");
  }

  return `### Daily Kitchen Briefing (June 22, 2026)
*Generated via CafeGo Local NLP Analyzer*

**👍 Positive Highlights:**
${positives.map(p => `- ${p}`).join('\n')}

**⚠️ Critical Alerts:**
${alerts.map(a => `- ${a}`).join('\n')}

**🍳 Actionable Cooking Suggestions:**
${suggestions.slice(0, 3).map(s => `- ${s}`).join('\n')}`;
}

// ==========================================
// COLLEGE ID VALIDATION ENDPOINT
// ==========================================
app.post('/api/auth/validate-id', async (req, res) => {
  const { collegeId, role } = req.body;
  
  if (!collegeId || !role) {
    return res.status(400).json({ valid: false, error: 'College ID and role are required.' });
  }

  // 1. Format validation using Regular Expression
  // Format XX-YYYYY-ZZ (e.g. CS-10245-26)
  const studentRegex = /^[A-Z]{2}-\d{5}-\d{2}$/;
  // Format chef-XXX-YY or admin-XXX-YY (e.g. chef-marcus-26 or admin-alex-26)
  const staffRegex = /^(chef|admin)-[a-zA-Z]+-\d{2}$/;

  let isValidFormat = false;
  if (role === 'student') {
    isValidFormat = studentRegex.test(collegeId);
  } else if (role === 'chef' || role === 'admin') {
    isValidFormat = staffRegex.test(collegeId);
  }

  if (!isValidFormat) {
    let formatMsg = role === 'student' 
      ? 'Format must be XX-YYYYY-ZZ (e.g., CS-10245-26).' 
      : 'Format must be role-name-YY (e.g., chef-marcus-26 or admin-alex-26).';
    return res.status(400).json({ valid: false, error: `Invalid College ID format. ${formatMsg}` });
  }

  // 2. Database Check
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const docSnap = await firestoreDb.collection('college_ids').doc(collegeId).get();
      if (!docSnap.exists) {
        return res.status(404).json({ valid: false, error: 'College ID not registered in database.' });
      }
    } catch (e) {
      console.error("Error validating college ID in Firestore:", e);
      return res.status(500).json({ valid: false, error: 'Database check failed' });
    }
  } else {
    const db = await readDB();
    const registeredIds = db.college_ids || [];
    if (!registeredIds.includes(collegeId)) {
      return res.status(404).json({ valid: false, error: 'College ID not registered in database.' });
    }
  }

  // 3. Match ID prefixes for Role check
  if (role === 'chef' && !collegeId.startsWith('chef-')) {
    return res.status(400).json({ valid: false, error: 'College ID role mismatch. Chef ID required.' });
  }
  if (role === 'admin' && !collegeId.startsWith('admin-')) {
    return res.status(400).json({ valid: false, error: 'College ID role mismatch. Admin ID required.' });
  }
  if (role === 'student' && (collegeId.startsWith('chef-') || collegeId.startsWith('admin-'))) {
    return res.status(400).json({ valid: false, error: 'College ID role mismatch. Student ID required.' });
  }

  // Return success
  res.json({ valid: true, message: 'Authentication successful' });
});

// Sync local db.json orders to Firestore if Firestore is active and empty
async function syncDatabaseToFirestore() {
  if (!isFirebaseConfigured || !firestoreDb) return;
  try {
    const dbData = await readDB();

    // 1. Sync orders
    const ordersSnapshot = await firestoreDb.collection('orders').get();
    if (ordersSnapshot.empty && dbData.orders && dbData.orders.length > 0) {
      console.log(`Syncing ${dbData.orders.length} orders from db.json to Firestore...`);
      for (const order of dbData.orders) {
        const { id, ...bodyWithoutId } = order;
        await firestoreDb.collection('orders').doc(String(order.id)).set(bodyWithoutId);
      }
    }

    // 2. Sync menu_items
    const menuSnapshot = await firestoreDb.collection('menu_items').get();
    if (menuSnapshot.empty && dbData.menu_items && dbData.menu_items.length > 0) {
      console.log(`Syncing ${dbData.menu_items.length} menu items from db.json to Firestore...`);
      for (const item of dbData.menu_items) {
        const { id, ...bodyWithoutId } = item;
        await firestoreDb.collection('menu_items').doc(String(item.id)).set(bodyWithoutId);
      }
    }

    // 3. Sync feedback
    const feedbackSnapshot = await firestoreDb.collection('feedback').get();
    if (feedbackSnapshot.empty && dbData.feedback && dbData.feedback.length > 0) {
      console.log(`Syncing ${dbData.feedback.length} feedback items from db.json to Firestore...`);
      for (const f of dbData.feedback) {
        const { id, ...bodyWithoutId } = f;
        await firestoreDb.collection('feedback').doc(String(f.id)).set(bodyWithoutId);
      }
    }

    // 4. Sync college_ids
    const collegeIdsSnapshot = await firestoreDb.collection('college_ids').get();
    if (collegeIdsSnapshot.empty && dbData.college_ids && dbData.college_ids.length > 0) {
      console.log(`Syncing ${dbData.college_ids.length} college IDs from db.json to Firestore...`);
      for (const id of dbData.college_ids) {
        await firestoreDb.collection('college_ids').doc(id).set({ valid: true });
      }
    }

    // 5. Sync ai_briefing
    const aiBriefingSnapshot = await firestoreDb.collection('ai_briefing').get();
    if (aiBriefingSnapshot.empty && dbData.ai_briefing && dbData.ai_briefing.length > 0) {
      console.log(`Syncing ${dbData.ai_briefing.length} AI briefings from db.json to Firestore...`);
      for (const brief of dbData.ai_briefing) {
        await firestoreDb.collection('ai_briefing').doc(brief.date).set(brief);
      }
    }

    // 6. Schema Migration: Ensure all menu items have inventory fields
    const currentMenuSnapshot = await firestoreDb.collection('menu_items').get();
    const migrationBatch = firestoreDb.batch();
    let migrationCount = 0;
    currentMenuSnapshot.forEach(doc => {
      const data = doc.data();
      const updates = {};
      let needsUpdate = false;
      
      if (data.stock === undefined) {
        updates.stock = 25; // default starting stock
        needsUpdate = true;
      }
      if (data.lowStockThreshold === undefined) {
        updates.lowStockThreshold = 5; // default low threshold
        needsUpdate = true;
      }
      if (data.soldToday === undefined) {
        updates.soldToday = 0;
        needsUpdate = true;
      }
      if (data.status === undefined) {
        const currentStock = updates.stock !== undefined ? updates.stock : data.stock;
        const currentThreshold = updates.lowStockThreshold !== undefined ? updates.lowStockThreshold : data.lowStockThreshold;
        
        let newStatus = 'Available';
        if (currentStock === 0) {
          newStatus = 'Out Of Stock';
        } else if (currentStock <= currentThreshold) {
          newStatus = 'Low Stock';
        }
        updates.status = newStatus;
        needsUpdate = true;
      }
      if (data.lastUpdated === undefined) {
        updates.lastUpdated = new Date().toISOString();
        needsUpdate = true;
      }
      if (data.lastRestockedAt === undefined) {
        updates.lastRestockedAt = new Date().toISOString();
        needsUpdate = true;
      }
      if (data.lastRestockedBy === undefined) {
        updates.lastRestockedBy = 'System Migration';
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        migrationBatch.update(doc.ref, updates);
        migrationCount++;
      }
    });
    
    if (migrationCount > 0) {
      await migrationBatch.commit();
      console.log(`Successfully migrated ${migrationCount} menu items in Firestore with new stock fields.`);
    }

    console.log("Firestore initialization/sync checks complete.");
  } catch (err) {
    console.error("Error syncing db.json to Firestore:", err);
  }
}

// Start Server
app.listen(PORT, async () => {
  console.log(`CafeGo local server running at http://localhost:${PORT}`);
  await syncDatabaseToFirestore();
});
