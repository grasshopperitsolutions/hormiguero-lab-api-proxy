// api/store-data.js
import { db } from "./_middleware.js";

export default async function handler(req, res) {
  // CORS setup
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
      // Store scraped data
      const { convocatorias } = req.body;

      if (!Array.isArray(convocatorias)) {
        return res.status(400).json({ error: "Invalid data format" });
      }

      const batch = db.batch();
      const timestamp = admin.firestore.FieldValue.serverTimestamp();

      convocatorias.forEach((item) => {
        const docRef = db.collection("convocatorias").doc();
        batch.set(docRef, {
          ...item,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });

      await batch.commit();

      return res.status(200).json({
        success: true,
        count: convocatorias.length,
      });
    }

    if (req.method === "GET") {
      // Retrieve data for your web app
      const { estado, limit = 100 } = req.query;

      let query = db
        .collection("convocatorias")
        .orderBy("createdAt", "desc")
        .limit(parseInt(limit));

      if (estado) {
        query = query.where("estado", "==", estado);
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
