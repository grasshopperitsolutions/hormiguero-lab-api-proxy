// api/store-data.js
import { db } from "./_middleware.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  const requestId = req.headers["x-request-id"] || `STORE-${Date.now()}`;

  res.setHeader(
    "Access-Control-Allow-Origin",
    process.env.ALLOWED_ORIGIN || "https://grasshoppersolutions.online",
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Request-ID");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "POST") {
      const { convocatorias } = req.body;

      if (!Array.isArray(convocatorias) || convocatorias.length === 0) {
        console.error(`❌ [${requestId}] Invalid data format received`);
        return res.status(400).json({ error: "Invalid data format" });
      }

      console.log(
        `💾 [${requestId}] Starting storage of ${convocatorias.length} convocatorias...`,
      );

      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      let newCount = 0;
      let updateCount = 0;
      let skippedCount = 0;

      // ✅ OPTIMIZED: Batch all reads first, then write
      const docRefs = [];
      const docIds = [];

      for (const item of convocatorias) {
        if (!item.enlace) {
          console.warn(
            `⚠️ [${requestId}] Skipping item without enlace:`,
            item.titulo,
          );
          skippedCount++;
          continue;
        }

        // Create a hash or sanitized version of URL as document ID
        const docId = Buffer.from(item.enlace)
          .toString("base64")
          .replace(/[/+=]/g, "_")
          .substring(0, 100);

        docIds.push(docId);
        docRefs.push(db.collection("convocatorias").doc(docId));
      }

      console.log(
        `📖 [${requestId}] Reading ${docRefs.length} documents to check existence...`,
      );

      // Batch read all documents at once (much faster!)
      const docSnaps = await db.getAll(...docRefs);

      console.log(`✍️ [${requestId}] Preparing write batch...`);

      // Now create the batch write operations
      const batch = db.batch();

      convocatorias.forEach((item, index) => {
        if (!item.enlace) return; // Already skipped

        const docRef = docRefs[index - skippedCount];
        const docSnap = docSnaps[index - skippedCount];

        if (docSnap && docSnap.exists) {
          // Update existing document
          batch.update(docRef, {
            ...item,
            updatedAt: timestamp,
          });
          updateCount++;
          console.log(
            `🔄 [${requestId}] Updating: ${item.titulo?.substring(0, 50)}...`,
          );
        } else {
          // Create new document
          batch.set(docRef, {
            ...item,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          newCount++;
          console.log(
            `➕ [${requestId}] Creating: ${item.titulo?.substring(0, 50)}...`,
          );
        }
      });

      console.log(`💾 [${requestId}] Committing batch write...`);
      await batch.commit();

      console.log(
        `✅ [${requestId}] Storage complete: ${newCount} new, ${updateCount} updated, ${skippedCount} skipped`,
      );

      return res.status(200).json({
        success: true,
        total: convocatorias.length,
        new: newCount,
        updated: updateCount,
        skipped: skippedCount,
        requestId,
      });
    }

    if (req.method === "GET") {
      const { estado, limit } = req.query;

      console.log(
        `📖 [${requestId}] GET request - estado: ${estado || "all"}, limit: ${limit || "none"}`,
      );

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

      console.log(
        `✅ [${requestId}] Retrieved ${data.length} convocatorias from Firestore`,
      );

      return res.status(200).json({
        success: true,
        count: data.length,
        data,
        requestId,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(`❌ [${requestId}] Storage error:`, error);
    return res.status(500).json({
      error: "Database operation failed",
      message: error.message,
      requestId,
    });
  }
}
