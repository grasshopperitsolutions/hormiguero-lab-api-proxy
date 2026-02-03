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
    const { url, crawlerOptions } = req.body;

    // Validate input
    if (!url || typeof url !== "string") {
      return res.status(400).json({
        error: "Missing or invalid 'url' in request body",
      });
    }

    // Default crawler options (can be overridden by client)
    const defaultOptions = {
      maxDepth: 2,
      limit: 20,
      includePaths: ["convocatorias"],
      excludePaths: ["login", "admin", "usuario", "register"],
      generateMarkdown: true,
      onlyMainContent: false,
      waitFor: 2000,
      timeout: 30000,
      allowExternalLinks: false,
      screenshot: false,
    };

    // Merge with client-provided options
    const finalOptions = {
      ...defaultOptions,
      ...(crawlerOptions || {}),
    };

    console.log(`🕷️ Starting crawl for: ${url}`);
    console.log(`📝 Options:`, finalOptions);

    // Call Firecrawl crawl endpoint
    const crawlResponse = await fetch(
      "https://api.firecrawl.dev/v1/crawl",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: url,
          ...finalOptions,
        }),
      },
    );

    const crawlData = await crawlResponse.json();

    if (!crawlResponse.ok) {
      console.error(`❌ Firecrawl crawl failed:`, crawlData);
      return res.status(crawlResponse.status).json({
        error: "Firecrawl crawl API error",
        details: crawlData,
      });
    }

    // Check if data is present
    if (!crawlData.data || !Array.isArray(crawlData.data)) {
      console.warn(`⚠️ No data returned for ${url}`);
      return res.status(200).json({
        success: true,
        url: url,
        pagesScraped: 0,
        data: [],
        markdown: "",
      });
    }

    // Extract markdown from all pages
    const pagesScraped = crawlData.data;
    const markdownArray = pagesScraped
      .filter(page => page.markdown)
      .map(page => `[URL: ${page.url}]\n${page.markdown}`);

    const combinedMarkdown = markdownArray.join("\n\n---PAGE BREAK---\n\n");

    console.log(`✅ Crawl completed for ${url}: ${pagesScraped.length} pages`);

    return res.status(200).json({
      success: true,
      url: url,
      pagesScraped: pagesScraped.length,
      data: crawlData.data,
      markdown: combinedMarkdown,
      credits: crawlData.credits || null,
    });

  } catch (error) {
    console.error("Crawl processing error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
