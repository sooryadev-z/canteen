/**
 * Firestore Data Importer Utility
 * 
 * This script imports data from a JSON file (e.g., db.json) into Firestore.
 * 
 * Rules:
 * 1. Convert top-level JSON keys into Firestore collections.
 * 2. If an object has an "id" field, use it as the Document ID and remove "id" from the document body.
 *    If no "id" is present, let Firestore auto-generate a random ID.
 * 3. Use Firestore batch writes (chunked into sets of 500 max).
 * 4. Error handling and progress updates printed to console.
 */

const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');

// Determine paths
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
const defaultJsonPath = path.join(__dirname, 'db.json');

// Allow custom JSON file path as command line argument
const inputJsonPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultJsonPath;

async function runImporter() {
  console.log('=== Firestore Importer Started ===');
  
  // 1. Verify and read Firebase service account credentials
  let serviceAccount;
  try {
    const credData = await fs.readFile(serviceAccountPath, 'utf8');
    serviceAccount = JSON.parse(credData);
  } catch (error) {
    console.error(`\nCRITICAL ERROR: Could not read Firebase credentials file.`);
    console.error(`Please place your Firebase service account key file at:\n  ${serviceAccountPath}`);
    console.error(`\nDetails: ${error.message}\n`);
    process.exit(1);
  }

  // 2. Initialize Firebase Admin SDK
  try {
    const cert = admin.credential.cert;
    admin.initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('✔ Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('CRITICAL ERROR: Failed to initialize Firebase Admin SDK.', error);
    process.exit(1);
  }

  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore();

  // 3. Read input JSON file
  let dbData;
  try {
    const fileContent = await fs.readFile(inputJsonPath, 'utf8');
    dbData = JSON.parse(fileContent);
    console.log(`✔ Successfully read input JSON file from: ${inputJsonPath}`);
  } catch (error) {
    console.error(`\nCRITICAL ERROR: Could not read input JSON file.`);
    console.error(`Please make sure your database file exists at:\n  ${inputJsonPath}`);
    console.error(`\nDetails: ${error.message}\n`);
    process.exit(1);
  }

  // 4. Process each top-level key as a Firestore collection
  const collections = Object.keys(dbData);
  console.log(`\nFound ${collections.length} collections to upload: ${collections.join(', ')}`);

  for (const collectionName of collections) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Starting processing for collection: "${collectionName}"`);
    
    const collectionData = dbData[collectionName];
    let documents = [];

    // Parse data into document structure
    try {
      if (Array.isArray(collectionData)) {
        for (let idx = 0; idx < collectionData.length; idx++) {
          const item = collectionData[idx];
          let docId = null;
          let docBody = {};

          if (item !== null && typeof item === 'object') {
            docBody = { ...item };
            if (collectionName === 'college_ids') {
              docBody.valid = true;
            }
            if ('id' in docBody) {
              docId = String(docBody.id);
              delete docBody.id; // Remove "id" from body to avoid redundancy
            }
          } else {
            // Primitive values (like strings, numbers)
            docId = String(item);
            if (collectionName === 'college_ids') {
              // Special mapping for college_ids to match server expectation
              docBody = { valid: true };
            } else {
              docBody = { value: item };
            }
          }
          documents.push({ id: docId, body: docBody });
        }
      } else if (collectionData !== null && typeof collectionData === 'object') {
        // Top-level key is an object, not an array
        for (const [key, val] of Object.entries(collectionData)) {
          let docId = key;
          let docBody = (val !== null && typeof val === 'object') ? { ...val } : { value: val };
          if ('id' in docBody) {
            delete docBody.id;
          }
          documents.push({ id: docId, body: docBody });
        }
      } else {
        console.warn(`⚠ Collection "${collectionName}" contains a primitive top-level value. Skipping.`);
        continue;
      }
    } catch (parseError) {
      console.error(`❌ Error parsing collection "${collectionName}" contents:`, parseError);
      continue;
    }

    const totalDocs = documents.length;
    console.log(`Prepared ${totalDocs} documents to upload for "${collectionName}".`);

    if (totalDocs === 0) {
      console.log(`No documents found. Skipping upload.`);
      continue;
    }

    // 5. Upload documents in batches of 500
    const BATCH_LIMIT = 500;
    let batch = db.batch();
    let operationCount = 0;
    let batchNumber = 1;
    let successCount = 0;

    for (let i = 0; i < totalDocs; i++) {
      const { id, body } = documents[i];
      const colRef = db.collection(collectionName);
      const docRef = id ? colRef.doc(id) : colRef.doc();

      try {
        batch.set(docRef, body);
        operationCount++;
      } catch (err) {
        console.error(`❌ Error preparing document at index ${i} in "${collectionName}":`, err.message);
      }

      // Check if we hit the batch limit or the end of the documents array
      if (operationCount === BATCH_LIMIT || i === totalDocs - 1) {
        const currentBatchSize = operationCount;
        console.log(`Uploading batch ${batchNumber} of collection "${collectionName}" (${currentBatchSize} documents)...`);
        
        try {
          await batch.commit();
          successCount += currentBatchSize;
          console.log(`✔ Completed batch ${batchNumber} of collection "${collectionName}".`);
        } catch (commitError) {
          console.error(`❌ FAILED to write batch ${batchNumber} of collection "${collectionName}":`, commitError.message);
        }

        // Reset batch
        batchNumber++;
        batch = db.batch();
        operationCount = 0;
      }
    }

    console.log(`Finished collection "${collectionName}". Successfully uploaded ${successCount}/${totalDocs} documents.`);
  }

  console.log('\n==================================================');
  console.log('✔ Firestore Importer process completed.');
  console.log('==================================================');
}

runImporter();
