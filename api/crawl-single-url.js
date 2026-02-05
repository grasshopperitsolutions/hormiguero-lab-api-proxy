// api/crawl-single-url.js
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

  if (!process.env.FIRECRAWL_API_KEY) {
    return res.status(500).json({
      error: "FIRECRAWL_API_KEY not configured in environment variables",
    });
  }

  try {
    const { url, urls, crawlerOptions, scrapeOptions } = req.body || {};

    const urlList =
      Array.isArray(urls) && urls.length > 0 ? urls : url ? [url] : [];

    if (urlList.length === 0) {
      return res.status(400).json({
        error: "Provide either 'url' (string) or 'urls' (array of strings)",
      });
    }

    const defaultCrawlOptions = {
      maxDiscoveryDepth: 2,
      limit: 20,
      includePaths: ["convocatorias"],
      excludePaths: ["login", "admin", "usuario", "register"],
      allowExternalLinks: false,
    };

    const defaultScrapeOptions = {
      formats: ["markdown"],
    };

    const finalCrawlOptions = {
      ...defaultCrawlOptions,
      ...(crawlerOptions || {}),
    };

    const finalScrapeOptions = {
      ...defaultScrapeOptions,
      ...(scrapeOptions || {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);

    try {
      const crawlPromises = urlList.map((singleUrl) =>
        crawlOneUrl(
          singleUrl,
          finalCrawlOptions,
          finalScrapeOptions,
          controller,
        ),
      );

      const results = await Promise.all(crawlPromises);
      clearTimeout(timeout);

      // If caller passed a single url, keep backward‑compatible shape
      if (url && !urls) {
        const first = results[0];
        return res.status(200).json(first);
      }

      // If caller passed urls[], return batch
      return res.status(200).json({
        success: true,
        count: results.length,
        results,
      });
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        return res.status(504).json({
          error: "Timeout",
          message: "Firecrawl batch took too long.",
        });
      }
      throw e;
    }
  } catch (error) {
    console.error("Crawl processing error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}

/**
 * Crawl a single URL via Firecrawl and normalize the result
 * @param {string} singleUrl
 * @param {object} crawlOptions
 * @param {object} scrapeOptions
 * @param {AbortController} controller
 * @returns {Promise<{url, success, markdown, pagesScraped, credits?, error?}>}
 */
async function crawlOneUrl(singleUrl, crawlOptions, scrapeOptions, controller) {
  try {
    console.log(`🕷️ Starting crawl for: ${singleUrl}`);
    console.log(`📝 Crawl Options:`, crawlOptions);
    console.log(`📝 Scrape Options:`, scrapeOptions);

    const crawlResponse = await fetch("https://api.firecrawl.dev/v2/crawl", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: singleUrl,
        ...crawlOptions,
        scrapeOptions,
      }),
      signal: controller.signal,
    });

    const crawlData = await crawlResponse.json();

    if (!crawlResponse.ok || crawlData.success === false) {
      console.error(`❌ Firecrawl crawl failed for ${singleUrl}:`, crawlData);
      return {
        url: singleUrl,
        success: false,
        markdown: "",
        pagesScraped: 0,
        error: crawlData,
      };
    }

    if (!crawlData.data || !Array.isArray(crawlData.data)) {
      console.warn(`⚠️ No data returned for ${singleUrl}`);
      return {
        url: singleUrl,
        success: true,
        markdown: "",
        pagesScraped: 0,
      };
    }

    const pagesScraped = crawlData.data;
    const markdownArray = pagesScraped
      .filter((page) => page.markdown)
      .map((page) => `[URL: ${page.url}]\n${page.markdown}`);

    const combinedMarkdown = markdownArray.join("\n\n---PAGE BREAK---\n\n");

    console.log(
      `✅ Crawl completed for ${singleUrl}: ${pagesScraped.length} pages`,
    );

    return {
      url: singleUrl,
      success: true,
      markdown: combinedMarkdown,
      pagesScraped: pagesScraped.length,
      credits: crawlData.creditsUsed || null,
    };
  } catch (err) {
    console.error("Firecrawl fetch error for", singleUrl, err);
    return {
      url: singleUrl,
      success: false,
      markdown: "",
      pagesScraped: 0,
      error: err.message,
    };
  }
}
