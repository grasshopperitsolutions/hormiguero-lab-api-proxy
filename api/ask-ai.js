// api/ask-ai.js

export default async function handler(req, res) {
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
      return res.status(400).json({
        error:
          "Missing or invalid 'markdownBatch'. Expected non-empty array of { url, markdown }.",
      });
    }

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
  "fechaCierre": "YYYY-MM-DD o null si no hay fecha",
  "fechaPublicacion": "YYYY-MM-DD o null si no hay fecha",
  "enlace": "URL completa de la convocatoria",
  "monto": "Monto total o Recursos disponibles, o null si no se especifica",
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
4. Determina el estado basándote en fechas de cierre (si la fecha ya pasó, estado="cerrada")
5. Responde SOLO con el array JSON, sin texto adicional.`;

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
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
      return res.status(response.status).json(data);
    }

    const rawContent = data.choices?.[0]?.message?.content || "[]";
    let convocatorias = [];

    try {
      const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
      const jsonText = jsonMatch ? jsonMatch[0] : rawContent;
      convocatorias = JSON.parse(jsonText);

      if (!Array.isArray(convocatorias)) {
        convocatorias = [];
      }
    } catch (e) {
      console.error("Error parsing AI JSON:", e);
      convocatorias = [];
    }

    // ✅ ASYNC STORAGE: Fire-and-forget pattern
    if (convocatorias.length > 0) {
      // Don't await - let it run in background
      fetch(
        `${process.env.API_BASE_URL || "https://hormiguero-lab-api-proxy.vercel.app"}/api/store-data`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ convocatorias }),
        },
      )
        .then((storeRes) => storeRes.json())
        .then((storeData) => {
          console.log(`✅ Stored ${storeData.count} convocatorias in Firebase`);
        })
        .catch((err) => {
          console.error("⚠️ Storage failed (non-blocking):", err.message);
        });
    }

    // Return immediately without waiting for storage
    return res.status(200).json({ convocatorias, raw: data });
  } catch (error) {
    console.error("Proxy error:", error);
    return res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
}
