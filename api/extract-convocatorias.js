export default async function handler(req, res) {
  // CORS headers
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

  if (!process.env.FIRECRAWL_API_KEY) {
    return res.status(500).json({
      error: "FIRECRAWL_API_KEY not configured in environment variables",
    });
  }

  try {
    const { urls } = req.body;

    // Validate input
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: "Missing or invalid 'urls' in request body",
      });
    }

    console.log(`🔥 Starting Firecrawl Extract for: ${urls}`);

    // Define the schema for extraction
    const schema = {
      type: "object",
      properties: {
        convocatorias: {
          type: "array",
          items: {
            type: "object",
            properties: {
              titulo: {
                type: "string",
                description: "Nombre completo de la convocatoria",
              },
              entidad: {
                type: "string",
                description: "Nombre de la entidad oferente",
              },
              descripcion: {
                type: "string",
                description: "Descripción detallada de la convocatoria",
              },
              fechaCierre: {
                type: ["string", "null"],
                description:
                  "Fecha de cierre en formato YYYY-MM-DD, o null si no está disponible",
              },
              enlace: {
                type: ["string", "null"],
                description:
                  "URL directa a la convocatoria, o null si no está disponible",
              },
              monto: {
                type: ["string", "null"],
                description:
                  "Valor económico o número de vacantes, o null si no está disponible",
              },
              requisitos: {
                type: ["string", "null"],
                description:
                  "Requisitos principales, o null si no están disponibles",
              },
              estado: {
                type: "string",
                enum: ["abierta", "cerrada", "vigente"],
                description: "Estado actual de la convocatoria",
              },
            },
            required: [
              "titulo",
              "entidad",
              "descripcion",
              "fechaCierre",
              "enlace",
              "monto",
              "requisitos",
              "estado",
            ],
          },
        },
      },
      required: ["convocatorias"],
    };

    const prompt = `Extrae TODAS las convocatorias encontradas en este sitio web. 
        
Para cada convocatoria, identifica:
- Título completo
- Entidad que la ofrece
- Descripción detallada
- Fecha de cierre (formato YYYY-MM-DD)
- Enlace directo
- Monto o valor económico
- Requisitos principales
- Estado (abierta, cerrada, o vigente)

Si algún campo no está disponible, usa null. NO omitas ninguna convocatoria. Extrae TODAS.`;

    // Call Firecrawl Extract endpoint
    const extractResponse = await fetch(
      "https://api.firecrawl.dev/v2/extract",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          urls: urls,
          prompt: prompt,
          schema: schema,
          enableWebSearch: false,
          ignoreSitemap: false,
          includeSubdomains: true,
          showSources: false,
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
            // includeTags: ['<string>'],
            // excludeTags: ['<string>'],
            maxAge: 172800000,
            headers: {},
            waitFor: 0,
            mobile: false,
            skipTlsVerification: true,
            timeout: 25000,
            actions: [{ type: "wait", milliseconds: 2 }],
            removeBase64Images: true,
            blockAds: true,
            proxy: "auto",
            storeInCache: true,
          },
          ignoreInvalidURLs: true,
        }),
      },
    );

    const extractData = await extractResponse.json();

    if (!extractResponse.ok) {
      console.error(`❌ Firecrawl extract failed:`, extractData);
      return res.status(extractResponse.status).json({
        error: "Firecrawl extract API error",
        details: extractData,
      });
    }

    // Extract convocatorias from response
    const convocatorias = extractData.data?.convocatorias || [];

    console.log(
      `✅ Extracted ${convocatorias.length} convocatorias from ${urls}`,
    );

    return res.status(200).json({
      success: true,
      url: urls,
      convocatoriasCount: convocatorias.length,
      convocatorias: convocatorias,
      credits: extractData.credits || null,
    });
  } catch (error) {
    console.error("Extract processing error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
