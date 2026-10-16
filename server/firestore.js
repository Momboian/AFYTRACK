// Connects to Cloud Firestore through the Firebase Admin SDK (server side, full access).
// Credentials, in order of preference:
//   FIREBASE_SERVICE_ACCOUNT       path to the service account JSON file
//   FIREBASE_SERVICE_ACCOUNT_JSON  the JSON itself (useful on Render / Codemagic style hosts)
//   GOOGLE_APPLICATION_CREDENTIALS standard Google variable (or the host's default credentials)
// FIRESTORE_EMULATOR_HOST=localhost:8080 points the SDK at the local Firestore emulator.
// DB_DRIVER=memory uses an in-memory database (tests and quick demos only; data is lost on restart).
import 'dotenv/config';
import fs from 'node:fs';
import { createMemoryFirestore } from './memory-firestore.js';

let instance;

export async function getFirestore() {
  if (instance) return instance;
  if (process.env.DB_DRIVER === 'memory') {
    instance = createMemoryFirestore();
    return instance;
  }
  const { initializeApp, cert, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore: adminFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = cert(JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT, 'utf8')));
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)); ///////////////// 
    } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
      credential = applicationDefault();
    }
    initializeApp({ ...(credential ? { credential } : {}), projectId: process.env.FIREBASE_PROJECT_ID || undefined });
  }
  const db = adminFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  instance = db;
  return instance;
}
