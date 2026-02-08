// api/_middleware.js
import admin from "firebase-admin";

// Initialize Firebase Admin (singleton pattern)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export const db = admin.firestore();

// Optional: Auth verification (for Phase 2)
export async function verifyAuth(req) {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) {
    throw new Error("No authentication token provided");
  }
  return await admin.auth().verifyIdToken(token);
}
