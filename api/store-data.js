// api/store-data.js
import { db } from "./_middleware.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    process.env.ALLOWED_ORIGIN || "https://grasshoppersolutions.online",
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "POST") {
      const { convocatorias } = req.body;

      if (!Array.isArray(convocatorias) || convocatorias.length === 0) {
        return res.status(400).json({ error: "Invalid data format" });
      }

      const batch = db.batch();
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      let newCount = 0;
      let updateCount = 0;

      for (const item of convocatorias) {
        if (!item.enlace) continue; // Skip if no URL

        // Create a hash or sanitized version of URL as document ID
        const docId = Buffer.from(item.enlace)
          .toString("base64")
          .replace(/[/+=]/g, "_")
          .substring(0, 100); // Firestore doc ID limit

        const docRef = db.collection("convocatorias").doc(docId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
          // Update existing document
          batch.update(docRef, {
            ...item,
            updatedAt: timestamp,
          });
          updateCount++;
        } else {
          // Create new document
          batch.set(docRef, {
            ...item,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          newCount++;
        }
      }

      await batch.commit();

      return res.status(200).json({
        success: true,
        total: convocatorias.length,
        new: newCount,
        updated: updateCount,
      });
    }

    if (req.method === "GET") {
      const { estado = "abierta", limit } = req.query;

      // Start with base query
      let query = db.collection("convocatorias").orderBy("createdAt", "desc");

      // Filter by estado if provided
      if (estado) {
        query = query.where("estado", "==", estado);
      }

      // Apply limit if provided, otherwise get all
      if (limit) {
        query = query.limit(parseInt(limit));
      }

      const snapshot = await query.get();
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return res.status(200).json({
        success: true,
        count: data.length,
        data,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Storage error:", error);
    return res.status(500).json({
      error: "Database operation failed",
    });
  }
}
