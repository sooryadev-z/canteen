const fs = require('fs').promises;
const path = require('path');

// 1. Mock Firebase Admin and Firestore
const mockFirestore = {
  collectionLogs: {},
  batchCalls: [],
  batch() {
    const currentBatch = [];
    const batchId = this.batchCalls.length + 1;
    return {
      set(docRef, body) {
        currentBatch.push({ ref: docRef, body });
      },
      commit: async () => {
        mockFirestore.batchCalls.push({
          batchId,
          size: currentBatch.length,
          operations: [...currentBatch]
        });
        
        for (const op of currentBatch) {
          const { ref, body } = op;
          const colName = ref.col;
          const docId = ref.id || 'auto-generated-' + Math.random().toString(36).substring(2, 9);
          
          if (!mockFirestore.collectionLogs[colName]) {
            mockFirestore.collectionLogs[colName] = {};
          }
          mockFirestore.collectionLogs[colName][docId] = body;
        }
        currentBatch.length = 0; // Clear
      }
    };
  },
  collection(name) {
    return {
      doc(id) {
        return { col: name, id: id || null };
      }
    };
  }
};

const adminMock = {
  initializeApp() {
    console.log('[Mock Firebase Admin] initialized successfully.');
  },
  credential: {
    cert() { return 'mock-cert'; }
  },
  firestore() {
    return mockFirestore;
  }
};

// 2. Prepare mock database JSON containing:
// - Primitives (college_ids)
// - Objects with id (menu_items)
// - Objects without id (orders/briefings)
// - Large collection to test the 500 batch limit chunking (505 items)
const testDb = {
  college_ids: [
    "CS-10245-26",
    "EC-20412-25"
  ],
  menu_items: [
    { id: 1, name: "Paneer Butter Masala", price: 120 },
    { id: 2, name: "Grilled Chicken Steak", price: 240 }
  ],
  ai_briefing: [
    { date: "2026-06-22", content: "Briefing content A" },
    { date: "2026-06-23", content: "Briefing content B" }
  ],
  large_collection: Array.from({ length: 505 }, (_, index) => ({
    id: index + 1,
    value: `Item ${index + 1}`
  }))
};

// 3. Importer Logic Runner (mirroring import-to-firestore.js)
async function runVerification() {
  console.log('=== Running Verification on Mock Firestore ===');
  
  const db = adminMock.firestore();
  const dbData = testDb;

  const collections = Object.keys(dbData);
  
  for (const collectionName of collections) {
    console.log(`\nProcessing collection: "${collectionName}"`);
    
    const collectionData = dbData[collectionName];
    let documents = [];

    // Parse data
    if (Array.isArray(collectionData)) {
      for (const item of collectionData) {
        let docId = null;
        let docBody = {};

        if (item !== null && typeof item === 'object') {
          docBody = { ...item };
          if ('id' in docBody) {
            docId = String(docBody.id);
            delete docBody.id;
          }
        } else {
          docId = String(item);
          if (collectionName === 'college_ids') {
            docBody = { valid: true };
          } else {
            docBody = { value: item };
          }
        }
        documents.push({ id: docId, body: docBody });
      }
    } else if (collectionData !== null && typeof collectionData === 'object') {
      for (const [key, val] of Object.entries(collectionData)) {
        let docId = key;
        let docBody = (val !== null && typeof val === 'object') ? { ...val } : { value: val };
        if ('id' in docBody) {
          delete docBody.id;
        }
        documents.push({ id: docId, body: docBody });
      }
    }

    const totalDocs = documents.length;
    
    // Batch writes of 500
    const BATCH_LIMIT = 500;
    let batch = db.batch();
    let operationCount = 0;
    let batchNumber = 1;
    let successCount = 0;

    for (let i = 0; i < totalDocs; i++) {
      const { id, body } = documents[i];
      const colRef = db.collection(collectionName);
      const docRef = id ? colRef.doc(id) : colRef.doc();

      batch.set(docRef, body);
      operationCount++;

      if (operationCount === BATCH_LIMIT || i === totalDocs - 1) {
        const currentBatchSize = operationCount;
        console.log(`  Uploading batch ${batchNumber} of "${collectionName}" (${currentBatchSize} documents)...`);
        await batch.commit();
        successCount += currentBatchSize;
        batchNumber++;
        batch = db.batch();
        operationCount = 0;
      }
    }
  }

  console.log('\n=== Verification Assertions ===');
  
  // Test 1: college_ids primitive handling
  const collegeIdsDocs = mockFirestore.collectionLogs['college_ids'];
  const hasID1 = collegeIdsDocs['CS-10245-26'] && collegeIdsDocs['CS-10245-26'].valid === true;
  const hasID2 = collegeIdsDocs['EC-20412-25'] && collegeIdsDocs['EC-20412-25'].valid === true;
  console.log(`Test 1 (college_ids doc ID & body): ${hasID1 && hasID2 ? 'PASS' : 'FAIL'}`);
  console.log('  Data:', collegeIdsDocs);

  // Test 2: Objects with "id" key
  const menuItemsDocs = mockFirestore.collectionLogs['menu_items'];
  const hasMenu1 = menuItemsDocs['1'] && menuItemsDocs['1'].id === undefined && menuItemsDocs['1'].name === "Paneer Butter Masala";
  const hasMenu2 = menuItemsDocs['2'] && menuItemsDocs['2'].id === undefined && menuItemsDocs['2'].price === 240;
  console.log(`Test 2 (menu_items extraction & deletion of "id"): ${hasMenu1 && hasMenu2 ? 'PASS' : 'FAIL'}`);
  console.log('  Data:', menuItemsDocs);

  // Test 3: Objects without "id" key (auto-generated ID)
  const briefingDocs = mockFirestore.collectionLogs['ai_briefing'];
  const briefingKeys = Object.keys(briefingDocs);
  const isAutoGenerated = briefingKeys.length === 2 && briefingKeys.every(k => k.startsWith('auto-generated-'));
  console.log(`Test 3 (ai_briefing auto-generated doc ID): ${isAutoGenerated ? 'PASS' : 'FAIL'}`);
  console.log('  Keys:', briefingKeys);
  console.log('  Data:', briefingDocs);

  // Test 4: Batch Writes Chunking
  const batchCallsLarge = mockFirestore.batchCalls.filter(b => {
    const firstOp = b.operations[0];
    return firstOp && firstOp.ref.col === 'large_collection';
  });
  const correctBatchSplit = batchCallsLarge.length === 2 && 
                            batchCallsLarge[0].size === 500 && 
                            batchCallsLarge[1].size === 5;
  console.log(`Test 4 (Batch chunking at 500 limit for 505 docs): ${correctBatchSplit ? 'PASS' : 'FAIL'}`);
  console.log(`  Batch 1 size: ${batchCallsLarge[0]?.size}, Batch 2 size: ${batchCallsLarge[1]?.size}`);
}

runVerification();
