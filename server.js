const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/generative-ai');

// Load environment variables
dotenv.config();

const { db: firestoreDb, isConfigured: isFirebaseConfigured, firebaseConfig } = require('./firebase-config');
const { doc, setDoc, updateDoc } = require('firebase/firestore');

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
  const db = await readDB();
  res.json(db.menu_items || []);
});

// Add menu item
app.post('/api/menu', async (req, res) => {
  const db = await readDB();
  const newItem = {
    id: db.menu_items.length > 0 ? Math.max(...db.menu_items.map(i => i.id)) + 1 : 1,
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
  db.menu_items.push(newItem);
  await writeDB(db);
  res.status(201).json(newItem);
});

// Update menu item (availability, price, category, stock text)
app.put('/api/menu/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const db = await readDB();
  const index = db.menu_items.findIndex(i => i.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  const item = db.menu_items[index];
  const updatedItem = {
    ...item,
    ...req.body
  };
  db.menu_items[index] = updatedItem;
  await writeDB(db);
  res.json(updatedItem);
});

// Delete menu item
app.delete('/api/menu/:id', async (req, res) => {
  const id = parseInt(req.params.id);
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
  const db = await readDB();
  res.json(db.orders || []);
});

// Place new order
app.post('/api/orders', async (req, res) => {
  const db = await readDB();
  const tokenNum = `#SC-${Math.floor(100 + Math.random() * 900)}`;

  const newOrder = {
    id: db.orders.length > 0 ? Math.max(...db.orders.map(o => o.id)) + 1 : 1,
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

  db.orders.push(newOrder);

  // Increment order count for items
  newOrder.items.forEach(orderItem => {
    const menuItem = db.menu_items.find(m => m.id === orderItem.id);
    if (menuItem) {
      menuItem.orders_count = (menuItem.orders_count || 0) + (orderItem.quantity || 1);
    }
  });

  await writeDB(db);

  if (isFirebaseConfigured && firestoreDb) {
    try {
      await setDoc(doc(firestoreDb, 'orders', String(newOrder.id)), newOrder);
    } catch (e) {
      console.error("Failed to save order to Firestore:", e);
    }
  }

  res.status(201).json(newOrder);
});

// Update order status
app.put('/api/orders/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const db = await readDB();
  const index = db.orders.findIndex(o => o.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const order = db.orders[index];
  const updatedOrder = {
    ...order,
    status: req.body.status // Pending, Preparing, Ready, Completed
  };
  db.orders[index] = updatedOrder;
  await writeDB(db);

  if (isFirebaseConfigured && firestoreDb) {
    try {
      await updateDoc(doc(firestoreDb, 'orders', String(id)), { status: req.body.status });
    } catch (e) {
      console.error("Failed to update order status in Firestore:", e);
    }
  }

  res.json(updatedOrder);
});


// ==========================================
// FEEDBACK API ENDPOINTS
// ==========================================

// Get all feedback
app.get('/api/feedback', async (req, res) => {
  const db = await readDB();
  res.json(db.feedback || []);
});

// Submit feedback
app.post('/api/feedback', async (req, res) => {
  const db = await readDB();
  const menu_item_id = parseInt(req.body.menu_item_id);
  const rating = parseInt(req.body.rating);

  const newFeedback = {
    id: db.feedback.length > 0 ? Math.max(...db.feedback.map(f => f.id)) + 1 : 1,
    user_id: req.body.user_id || 1,
    user_name: req.body.user_name || 'Arjun',
    menu_item_id: menu_item_id,
    menu_item_name: req.body.menu_item_name || 'Item',
    rating: rating,
    comments: req.body.comments || '',
    created_at: new Date().toISOString()
  };

  db.feedback.push(newFeedback);

  // Recalculate menu item average rating
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
  const db = await readDB();
  const latestBrief = db.ai_briefing && db.ai_briefing.length > 0
    ? db.ai_briefing[db.ai_briefing.length - 1]
    : null;

  res.json(latestBrief || { date: new Date().toISOString().split('T')[0], content: "No briefing generated yet for today." });
});

// Trigger new AI briefing generation
app.post('/api/insights/generate', async (req, res) => {
  const db = await readDB();
  const feedbacks = db.feedback || [];

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
      // Initialize Gemini SDK
      // Note: Depending on which version of @google/generative-ai is installed,
      // it might use GoogleGenAI or GoogleGenerativeAI. Let's make it robust.
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

  // Replace today's briefing or add a new one
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
    const { getDocs, collection } = require('firebase/firestore');
    const dbData = await readDB();
    const querySnapshot = await getDocs(collection(firestoreDb, 'orders'));
    if (querySnapshot.empty && dbData.orders && dbData.orders.length > 0) {
      console.log(`Syncing ${dbData.orders.length} orders from db.json to Firestore...`);
      for (const order of dbData.orders) {
        await setDoc(doc(firestoreDb, 'orders', String(order.id)), order);
      }
      console.log("Firestore sync complete.");
    } else {
      console.log("Firestore orders collection already has records or db.json has no orders. Skipping sync.");
    }
  } catch (err) {
    console.error("Error syncing db.json to Firestore:", err);
  }
}

// Start Server
app.listen(PORT, async () => {
  console.log(`CafeGo local server running at http://localhost:${PORT}`);
  await syncDatabaseToFirestore();
});
