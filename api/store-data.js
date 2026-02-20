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
      let noTitleCount = 0;

      const batch = db.batch();

      for (let i = 0; i < convocatorias.length; i++) {
        const item = convocatorias[i];

        const hasTitulo = item.titulo && item.titulo.trim() !== "";

        // No titulo = Create new entry (no deduplication possible)
        if (!hasTitulo) {
          console.warn(
            `⚠️ [${requestId}] Item ${i + 1} has no titulo - creating without deduplication check`,
          );

          const newDocRef = db.collection("convocatorias").doc();

          batch.set(newDocRef, {
            titulo: null,
            entidad: item.entidad || null,
            descripcion: item.descripcion || null,
            fechaCierre: item.fechaCierre || null,
            fechaPublicacion: item.fechaPublicacion || null,
            enlace: item.enlace || null,
            monto: item.monto || null,
            requisitos: item.requisitos || null,
            estado: item.estado || "abierta",
            categoria: item.categoria || null,
            fuente: item.fuente || null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          newCount++;
          noTitleCount++;
          console.log(
            `   ➕ [${requestId}] Creating without titulo [${newDocRef.id}]`,
          );
          continue;
        }

        console.log(
          `🔍 [${requestId}] Item ${i + 1}/${convocatorias.length}: ${item.titulo.substring(0, 50)}...`,
        );

        try {
          // ONLY CHECK BY TITULO
          console.log(
            `   📝 [${requestId}] Checking duplicate by titulo: "${item.titulo.trim().substring(0, 60)}..."`,
          );

          const existingQuery = await db
            .collection("convocatorias")
            .where("titulo", "==", item.titulo.trim())
            .limit(1)
            .get();

          // Normalize all fields (keep URL even if duplicate)
          const normalizedItem = {
            titulo: item.titulo.trim(),
            entidad: item.entidad || null,
            descripcion: item.descripcion || null,
            fechaCierre: item.fechaCierre || null,
            fechaPublicacion: item.fechaPublicacion || null,
            enlace: item.enlace || null, // Keep URL as-is
            monto: item.monto || null,
            requisitos: item.requisitos || null,
            estado: item.estado || "abierta",
            categoria: item.categoria || null,
            fuente: item.fuente || null,
          };

          if (!existingQuery.empty) {
            // UPDATE: Duplicate titulo found
            const existingDoc = existingQuery.docs[0];

            batch.update(existingDoc.ref, {
              ...normalizedItem,
              updatedAt: timestamp,
            });

            updateCount++;
            console.log(
              `   🔄 [${requestId}] Updating [${existingDoc.id}]: "${item.titulo.substring(0, 40)}..."`,
            );
          } else {
            // CREATE: New titulo
            const newDocRef = db.collection("convocatorias").doc();

            batch.set(newDocRef, {
              ...normalizedItem,
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            newCount++;
            console.log(
              `   ➕ [${requestId}] Creating [${newDocRef.id}]: "${item.titulo.substring(0, 40)}..."`,
            );
          }
        } catch (queryError) {
          console.error(
            `❌ [${requestId}] Error processing item ${i + 1}:`,
            queryError.message,
          );
          // Continue processing other items
        }
      }

      console.log(
        `💾 [${requestId}] Committing batch write (${newCount + updateCount} operations)...`,
      );

      try {
        await batch.commit();
        console.log(`✅ [${requestId}] Batch commit successful!`);
      } catch (commitError) {
        console.error(`❌ [${requestId}] Batch commit failed:`, commitError);
        throw commitError;
      }

      const summary = {
        success: true,
        total: convocatorias.length,
        new: newCount,
        updated: updateCount,
        withoutTitle: noTitleCount,
        stored: newCount + updateCount,
        requestId,
      };

      console.log(`✅ [${requestId}] Storage complete:`, summary);

      return res.status(200).json(summary);
    }

    if (req.method === "GET") {
      const { estado, limit, includeIncomplete } = req.query;

      console.log(
        `📖 [${requestId}] GET request - estado: ${estado || "all"}, limit: ${limit || "none"}`,
      );

      let query = db.collection("convocatorias").orderBy("createdAt", "desc");

      if (estado) {
        query = query.where("estado", "==", estado);
      }

      if (limit) {
        query = query.limit(parseInt(limit));
      }

      const snapshot = await query.get();
      let data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      if (includeIncomplete !== "true") {
        const originalCount = data.length;
        data = data.filter((item) => item.titulo && item.descripcion);
        const filteredCount = originalCount - data.length;
        if (filteredCount > 0) {
          console.log(
            `🔍 [${requestId}] Filtered out ${filteredCount} incomplete items`,
          );
        }
      }

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
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      requestId,
    });
  }
}
