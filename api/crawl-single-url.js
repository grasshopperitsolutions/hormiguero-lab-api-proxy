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
    const { url, crawlerOptions, scrapeOptions } = req.body;

    // Validate input
    if (!url || typeof url !== "string") {
      return res.status(400).json({
        error: "Missing or invalid 'url' in request body",
      });
    }

    // Default crawler options (v2 format)
    const defaultCrawlOptions = {
      maxDiscoveryDepth: 2, // Changed from maxDepth
      limit: 20,
      includePaths: ["convocatorias"], // v2 uses camelCase
      excludePaths: ["login", "admin", "usuario", "register"],
      allowExternalLinks: false,
    };

    // Default scrape options (v2 format)
    const defaultScrapeOptions = {
      formats: ["markdown"], // v2 requires formats array
    };

    // Merge with client-provided options
    const finalCrawlOptions = {
      ...defaultCrawlOptions,
      ...(crawlerOptions || {}),
    };

    const finalScrapeOptions = {
      ...defaultScrapeOptions,
      ...(scrapeOptions || {}),
    };

    console.log(`🕷️ Starting crawl for: ${url}`);
    console.log(`📝 Crawl Options:`, finalCrawlOptions);
    console.log(`📝 Scrape Options:`, finalScrapeOptions);

    // Call Firecrawl v2 crawl endpoint
    const crawlResponse = await fetch("https://api.firecrawl.dev/v2/crawl", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: url,
        ...finalCrawlOptions,
        scrapeOptions: finalScrapeOptions, // Separate scrape options in v2
      }),
    });

    const crawlData = await crawlResponse.json();

    if (!crawlResponse.ok) {
      console.error(`❌ Firecrawl crawl failed:`, crawlData);
      return res.status(crawlResponse.status).json({
        error: "Firecrawl crawl API error",
        details: crawlData,
      });
    }

    // v2 returns job data differently - check for success field
    if (crawlData.success === false) {
      console.error(`❌ Firecrawl crawl failed:`, crawlData);
      return res.status(400).json({
        error: "Firecrawl crawl failed",
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
      .filter((page) => page.markdown)
      .map((page) => `[URL: ${page.url}]\n${page.markdown}`);

    const combinedMarkdown = markdownArray.join("\n\n---PAGE BREAK---\n\n");

    console.log(`✅ Crawl completed for ${url}: ${pagesScraped.length} pages`);

    return res.status(200).json({
      success: true,
      url: url,
      pagesScraped: pagesScraped.length,
      data: crawlData.data,
      markdown: combinedMarkdown,
      credits: crawlData.creditsUsed || null, // v2 uses creditsUsed
    });
  } catch (error) {
    console.error("Crawl processing error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
