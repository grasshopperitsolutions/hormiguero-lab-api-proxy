// api/crawl-batch-urls.js
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
    const { urls, scrapeOptions } = req.body || {};

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: "Provide 'urls' as a non-empty array of strings",
      });
    }

    const defaultScrapeOptions = {
      formats: ["markdown"],
    };

    const finalScrapeOptions = {
      ...defaultScrapeOptions,
      ...(scrapeOptions || {}),
    };

    console.log(`🕷️ Starting batch scrape for ${urls.length} URLs`);
    console.log(`📝 Scrape Options:`, finalScrapeOptions);

    // Start batch scrape job
    const batchResponse = await fetch(
      "https://api.firecrawl.dev/v2/batch/scrape",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          urls,
          ...finalScrapeOptions,
        }),
      },
    );

    const batchData = await batchResponse.json();

    if (!batchResponse.ok || !batchData.success) {
      console.error("❌ Firecrawl batch scrape failed:", batchData);
      return res.status(batchResponse.status).json({
        error: "Firecrawl batch scrape failed",
        details: batchData,
      });
    }

    const jobId = batchData.id;
    const statusUrl = batchData.url;

    console.log(`✅ Batch job started: ${jobId}`);
    console.log(`📊 Status URL: ${statusUrl}`);

    // Poll for completion (Vercel has 30s timeout, so poll aggressively)
    const startTime = Date.now();
    const maxWaitTime = 25000; // 25 seconds to leave buffer
    const pollInterval = 2000; // Poll every 2 seconds

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const statusResponse = await fetch(statusUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        },
      });

      const statusData = await statusResponse.json();

      if (!statusResponse.ok) {
        console.error("❌ Failed to check batch status:", statusData);
        return res.status(statusResponse.status).json({
          error: "Failed to check batch status",
          details: statusData,
        });
      }

      console.log(
        `📊 Batch status: ${statusData.status} - ${statusData.completed}/${statusData.total} completed`,
      );

      if (statusData.status === "completed") {
        // Process results into normalized format
        const results = (statusData.data || []).map((item) => ({
          url: item.url || item.metadata?.sourceURL,
          success: true,
          markdown: item.markdown || "",
          metadata: item.metadata || {},
        }));

        console.log(`✅ Batch completed: ${results.length} URLs processed`);

        return res.status(200).json({
          success: true,
          count: results.length,
          results,
          jobId,
          creditsUsed: statusData.creditsUsed || null,
        });
      }

      if (statusData.status === "failed") {
        console.error("❌ Batch job failed:", statusData);
        return res.status(500).json({
          error: "Batch job failed",
          details: statusData,
        });
      }

      // Still processing, continue polling
    }

    // Timeout reached - return partial results if available
    console.warn("⚠️ Batch job timeout - returning job ID for client polling");
    return res.status(202).json({
      success: false,
      timeout: true,
      message:
        "Batch job is still processing. Use jobId to check status later.",
      jobId,
      statusUrl,
    });
  } catch (error) {
    console.error("Batch scrape processing error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
