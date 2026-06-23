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

// Helper to write database
async function writeDB(data) {
  try {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error("Error writing db.json", error);
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
      console.error("Error fetching menu from Firestore, using db.json fallback:", error);
    }
  }
  const db = await readDB();
  res.json(db.menu_items || []);
});

// Add menu item
app.post('/api/menu', async (req, res) => {
  let nextId = 1;
  const db = await readDB();
  
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('menu_items').get();
      const ids = [];
      snapshot.forEach(doc => ids.push(Number(doc.id)));
      nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    } catch (e) {
      console.error("Error finding next menu ID in Firestore:", e);
      nextId = db.menu_items.length > 0 ? Math.max(...db.menu_items.map(i => i.id)) + 1 : 1;
    }
  } else {
    nextId = db.menu_items.length > 0 ? Math.max(...db.menu_items.map(i => i.id)) + 1 : 1;
  }

  const newItem = {
    id: nextId,
    name: req.body.name,
    category: req.body.category || 'Lunch',
    price: parseFloat(req.body.price),
    is_veg: req.body.is_veg === undefined ? true : req.body.is_veg,
    is_available: req.body.is_available === undefined ? true : req.body.is_available,
    image_url: req.body.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500',
    prep_time: req.body.prep_time || '10m',
    back_time: req.body.back_time || '',
    rating: 5.0,
    orders_count: 0
  };

  if (isFirebaseConfigured && firestoreDb) {
    try {
      const { id, ...bodyWithoutId } = newItem;
      await firestoreDb.collection('menu_items').doc(String(newItem.id)).set(bodyWithoutId);
    } catch (e) {
      console.error("Error writing menu item to Firestore:", e);
    }
  }

  db.menu_items.push(newItem);
  await writeDB(db);
  res.status(201).json(newItem);
});

// Update menu item (availability, price, category, stock text)
app.put('/api/menu/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const db = await readDB();
  const index = db.menu_items.findIndex(i => i.id === id);
  
  let item = null;
  if (index !== -1) {
    item = db.menu_items[index];
  }

  if (isFirebaseConfigured && firestoreDb) {
    try {
      const docSnap = await firestoreDb.collection('menu_items').doc(String(id)).get();
      if (docSnap.exists) {
        item = { id, ...docSnap.data() };
      }
    } catch (e) {
      console.error("Error fetching menu item from Firestore:", e);
    }
  }

  if (!item) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  const updatedItem = {
    ...item,
    ...req.body
  };

  if (isFirebaseConfigured && firestoreDb) {
    try {
      const { id: _, ...bodyWithoutId } = updatedItem;
      await firestoreDb.collection('menu_items').doc(String(id)).set(bodyWithoutId);
    } catch (e) {
      console.error("Error updating menu item in Firestore:", e);
    }
  }

  if (index !== -1) {
    db.menu_items[index] = updatedItem;
    await writeDB(db);
  }
  res.json(updatedItem);
});

// Delete menu item
app.delete('/api/menu/:id', async (req, res) => {
  const id = parseInt(req.params.id);

  if (isFirebaseConfigured && firestoreDb) {
    try {
      await firestoreDb.collection('menu_items').doc(String(id)).delete();
    } catch (e) {
      console.error("Error deleting menu item from Firestore:", e);
    }
  }

  const db = await readDB();
  db.menu_items = db.menu_items.filter(i => i.id !== id);
  await writeDB(db);
  res.json({ message: 'Menu item deleted successfully' });
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
      console.error("Error fetching orders from Firestore, using db.json fallback:", error);
    }
  }
  const db = await readDB();
  res.json(db.orders || []);
});

// Place new order
app.post('/api/orders', async (req, res) => {
  const db = await readDB();
  let nextId = 1;

  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('orders').get();
      const ids = [];
      snapshot.forEach(doc => ids.push(Number(doc.id)));
      nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    } catch (e) {
      console.error("Error finding next order ID in Firestore:", e);
      nextId = db.orders.length > 0 ? Math.max(...db.orders.map(o => o.id)) + 1 : 1;
    }
  } else {
    nextId = db.orders.length > 0 ? Math.max(...db.orders.map(o => o.id)) + 1 : 1;
  }

  const tokenNum = `#SC-${Math.floor(100 + Math.random() * 900)}`;

  const newOrder = {
    id: nextId,
    user_id: req.body.user_id || 1,
    user_name: req.body.user_name || 'Arjun',
    total_amount: parseFloat(req.body.total_amount),
    pickup_slot: req.body.pickup_slot || '12:30 - 12:45',
    status: 'Pending',
    token_number: tokenNum,
    items: req.body.items || [],
    special_instructions: req.body.special_instructions || '',
    created_at: new Date().toISOString()
  };

  // Increment order count for items
  for (const orderItem of newOrder.items) {
    const menuItemId = orderItem.id;
    const menuItem = db.menu_items.find(m => m.id === menuItemId);
    if (menuItem) {
      menuItem.orders_count = (menuItem.orders_count || 0) + (orderItem.quantity || 1);
    }
    if (isFirebaseConfigured && firestoreDb) {
      try {
        const itemDocRef = firestoreDb.collection('menu_items').doc(String(menuItemId));
        const itemDoc = await itemDocRef.get();
        if (itemDoc.exists) {
          const currentCount = itemDoc.data().orders_count || 0;
          await itemDocRef.update({ orders_count: currentCount + (orderItem.quantity || 1) });
        }
      } catch (e) {
        console.error("Error updating menu item order count in Firestore:", e);
      }
    }
  }

  if (isFirebaseConfigured && firestoreDb) {
    try {
      const { id, ...bodyWithoutId } = newOrder;
      await firestoreDb.collection('orders').doc(String(newOrder.id)).set(bodyWithoutId);
    } catch (e) {
      console.error("Failed to save order to Firestore:", e);
    }
  }

  db.orders.push(newOrder);
  await writeDB(db);
  res.status(201).json(newOrder);
});

// Update order status
app.put('/api/orders/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const db = await readDB();
  const index = db.orders.findIndex(o => o.id === id);
  
  let order = null;
  if (index !== -1) {
    order = db.orders[index];
  }

  if (isFirebaseConfigured && firestoreDb) {
    try {
      const docSnap = await firestoreDb.collection('orders').doc(String(id)).get();
      if (docSnap.exists) {
        order = { id, ...docSnap.data() };
      }
    } catch (e) {
      console.error("Error fetching order from Firestore:", e);
    }
  }

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const updatedOrder = {
    ...order,
    status: req.body.status // Pending, Preparing, Ready, Completed
  };

  if (isFirebaseConfigured && firestoreDb) {
    try {
      const { id: _, ...bodyWithoutId } = updatedOrder;
      await firestoreDb.collection('orders').doc(String(id)).set(bodyWithoutId);
    } catch (e) {
      console.error("Failed to update order in Firestore:", e);
    }
  }

  if (index !== -1) {
    db.orders[index] = updatedOrder;
    await writeDB(db);
  }

  res.json(updatedOrder);
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
      console.error("Error fetching feedback from Firestore, using db.json fallback:", error);
    }
  }
  const db = await readDB();
  res.json(db.feedback || []);
});

// Submit feedback
app.post('/api/feedback', async (req, res) => {
  const db = await readDB();
  const menu_item_id = parseInt(req.body.menu_item_id);
  const rating = parseInt(req.body.rating);

  let nextId = 1;
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('feedback').get();
      const ids = [];
      snapshot.forEach(doc => ids.push(Number(doc.id)));
      nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    } catch (e) {
      console.error("Error finding next feedback ID in Firestore:", e);
      nextId = db.feedback.length > 0 ? Math.max(...db.feedback.map(f => f.id)) + 1 : 1;
    }
  } else {
    nextId = db.feedback.length > 0 ? Math.max(...db.feedback.map(f => f.id)) + 1 : 1;
  }

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

  if (isFirebaseConfigured && firestoreDb) {
    try {
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
    } catch (e) {
      console.error("Error writing feedback to Firestore:", e);
    }
  }

  db.feedback.push(newFeedback);

  // Recalculate menu item average rating locally
  const menuItem = db.menu_items.find(m => m.id === menu_item_id);
  if (menuItem) {
    const itemFeedback = db.feedback.filter(f => f.menu_item_id === menu_item_id);
    const avgRating = itemFeedback.reduce((sum, f) => sum + f.rating, 0) / itemFeedback.length;
    menuItem.rating = parseFloat(avgRating.toFixed(1));
  }

  await writeDB(db);
  res.status(201).json(newFeedback);
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
      console.error("Error fetching AI briefing from Firestore, using db.json fallback:", error);
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
  let feedbacks = [];
  if (isFirebaseConfigured && firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('feedback').get();
      snapshot.forEach(doc => {
        feedbacks.push({ id: Number(doc.id) || doc.id, ...doc.data() });
      });
    } catch (e) {
      console.error("Error fetching feedback from Firestore for AI generation:", e);
    }
  }

  if (feedbacks.length === 0) {
    const db = await readDB();
    feedbacks = db.feedback || [];
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

  if (isFirebaseConfigured && firestoreDb) {
    try {
      await firestoreDb.collection('ai_briefing').doc(newBrief.date).set(newBrief);
    } catch (e) {
      console.error("Error writing AI briefing to Firestore:", e);
    }
  }

  const db = await readDB();
  if (!db.ai_briefing) db.ai_briefing = [];
  const todayStr = newBrief.date;
  const existingIndex = db.ai_briefing.findIndex(b => b.date === todayStr);
  if (existingIndex !== -1) {
    db.ai_briefing[existingIndex] = newBrief;
  } else {
    db.ai_briefing.push(newBrief);
  }

  await writeDB(db);
  res.json(newBrief);
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

  // 2. Mock Database Check
  const db = await readDB();
  const registeredIds = db.college_ids || [];
  
  if (!registeredIds.includes(collegeId)) {
    return res.status(404).json({ valid: false, error: 'College ID not registered in database.' });
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
