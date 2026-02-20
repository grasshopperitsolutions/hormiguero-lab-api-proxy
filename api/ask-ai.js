// api/ask-ai.js

export default async function handler(req, res) {
  const requestId = `REQ-${Date.now()}`; // Unique request ID for tracking

  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://grasshoppersolutions.online",
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.PERPLEXITY_API_KEY) {
    return res.status(500).json({
      error: "PERPLEXITY_API_KEY not configured in environment variables",
    });
  }

  try {
    const { markdownBatch } = req.body || {};

    if (!Array.isArray(markdownBatch) || markdownBatch.length === 0) {
      console.log(`❌ [${requestId}] Invalid markdownBatch received`);
      return res.status(400).json({
        error:
          "Missing or invalid 'markdownBatch'. Expected non-empty array of { url, markdown }.",
      });
    }

    console.log(`📥 [${requestId}] Processing ${markdownBatch.length} URLs`);
    console.log(
      `📄 [${requestId}] URLs:`,
      markdownBatch.map((m) => m.url),
    );

    const batchContext = markdownBatch
      .map((item, index) => {
        const safeMarkdown = item.markdown || "";
        return `
=== FUENTE ${index + 1}: ${item.url} ===
${safeMarkdown}
=== FIN FUENTE ${index + 1} ===`;
      })
      .join("\n\n");

    const systemPrompt = `Eres un experto en análisis de convocatorias públicas en Colombia. Tu tarea es extraer información estructurada sobre convocatorias (calls for proposals, becas, empleos, financiamiento, etc.) de contenido web en markdown.

IMPORTANTE: Responde ÚNICAMENTE con un array JSON válido. No incluyas texto explicativo antes o después del JSON.

Cada convocatoria debe tener esta estructura exacta:

{
  "titulo": "Título completo de la convocatoria",
  "entidad": "Nombre de la entidad que convoca",
  "descripcion": "Descripción detallada",
  "fechaCierre": "Fecha de termino o cierre. Formato YYYY-MM-DD o null si no hay fecha",
  "fechaPublicacion": "Fecha de publicacion o inicio o apertura. Formato YYYY-MM-DD o null si no hay fecha",
  "enlace": "URL completa de la convocatoria",
  "monto": "Monto total de Recursos disponibles o financiamento, o null si no se especifica",
  "requisitos": "Requisitos principales resumidos",
  "estado": "abierta o cerrada",
  "categoria": "Categoría de la convocatoria",
  "fuente": "Nombre de la entidad fuente"
}`;

    const userPrompt = `Analiza el siguiente contenido de ${markdownBatch.length} sitios web y extrae TODAS las convocatorias que encuentres.

${batchContext}

INSTRUCCIONES:
1. Extrae TODAS las convocatorias encontradas en las ${markdownBatch.length} fuentes
2. Para cada convocatoria, completa todos los campos posibles
3. Si no encuentras un dato, usa null
4. Determina el estado basándote en fechas de cierre o publicacion/apertura (si la fecha ya pasó, estado="cerrada")
5. Responde SOLO con el array JSON, sin texto adicional.`;

    console.log(`🤖 [${requestId}] Calling Perplexity API...`);

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.PERPLEXITY_MODEL || "sonar",
        temperature: 0.2,
        max_tokens: 12000,
        disable_search: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ [${requestId}] Perplexity API error:`, data);
      return res.status(response.status).json(data);
    }

    const rawContent = data.choices?.[0]?.message?.content || "[]";
    let convocatorias = [];

    try {
      const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
      const jsonText = jsonMatch ? jsonMatch[0] : rawContent;
      convocatorias = JSON.parse(jsonText);

      if (!Array.isArray(convocatorias)) {
        console.warn(
          `⚠️ [${requestId}] AI response is not an array, setting to []`,
        );
        convocatorias = [];
      }
    } catch (e) {
      console.error(`❌ [${requestId}] Error parsing AI JSON:`, e.message);
      console.error(
        `📄 [${requestId}] Raw content:`,
        rawContent.substring(0, 500),
      );
      convocatorias = [];
    }

    console.log(
      `✅ [${requestId}] Extracted ${convocatorias.length} convocatorias`,
    );

    // ASYNC STORAGE: Fire-and-forget pattern with improved logging
    if (convocatorias.length > 0) {
      console.log(
        `💾 [${requestId}] Initiating async storage of ${convocatorias.length} items...`,
      );

      // Don't await - let it run in background
      fetch(
        `${process.env.API_BASE_URL || "https://hormiguero-lab-api-proxy.vercel.app"}/api/store-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId, // Pass request ID for tracking
          },
          body: JSON.stringify({ convocatorias }),
        },
      )
        .then(async (storeRes) => {
          const storeData = await storeRes.json();

          if (!storeRes.ok) {
            console.error(
              `❌ [${requestId}] Storage failed with status ${storeRes.status}:`,
              storeData,
            );
            return;
          }

          console.log(
            `✅ [${requestId}] Storage successful: ${storeData.new || 0} new, ${storeData.updated || 0} updated (total sent: ${convocatorias.length})`,
          );
        })
        .catch((err) => {
          console.error(
            `⚠️ [${requestId}] Storage request failed:`,
            err.message,
          );
        });
    } else {
      console.warn(`⚠️ [${requestId}] No convocatorias to store`);
    }

    // Return immediately without waiting for storage
    console.log(
      `📤 [${requestId}] Returning ${convocatorias.length} convocatorias to client`,
    );
    return res.status(200).json({
      convocatorias,
      raw: data,
      meta: {
        requestId,
        sourceUrls: markdownBatch.map((m) => m.url),
        extractedCount: convocatorias.length,
      },
    });
  } catch (error) {
    console.error(`❌ [${requestId}] Proxy error:`, error);
    return res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
}
