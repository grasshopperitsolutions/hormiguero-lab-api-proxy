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
    const { action, urls, formats, onlyMainContent, jobUrl } = req.body;

    // ============ ACTION: START JOB ============
    if (action === "start") {
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({
          error: "Missing or invalid 'urls' array in request body",
        });
      }

      // Create batch job
      const batchResponse = await fetch(
        "https://api.firecrawl.dev/v1/batch/scrape",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            urls: urls,
            formats: formats || ["markdown"],
            onlyMainContent: onlyMainContent !== false,
          }),
        },
      );

      const batchData = await batchResponse.json();

      if (!batchResponse.ok) {
        return res.status(batchResponse.status).json({
          error: "Firecrawl batch API error",
          details: batchData,
        });
      }

      // Return job info immediately
      return res.status(200).json({
        success: true,
        action: "started",
        jobId: batchData.id,
        jobUrl: batchData.url,
        totalUrls: urls.length,
      });
    }

    // ============ ACTION: CHECK STATUS ============
    if (action === "check") {
      if (!jobUrl) {
        return res.status(400).json({
          error: "Missing 'jobUrl' in request body",
        });
      }

      // Poll job status
      const pollResponse = await fetch(jobUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        },
      });

      const pollData = await pollResponse.json();

      if (!pollResponse.ok) {
        return res.status(pollResponse.status).json({
          error: "Polling failed",
          details: pollData,
        });
      }

      // Job completed
      if (pollData.status === "completed") {
        const markdownContent = [];
        if (pollData.data && Array.isArray(pollData.data)) {
          for (const page of pollData.data) {
            if (page.markdown) {
              markdownContent.push(page.markdown);
            }
          }
        }

        const combinedContent = markdownContent.join("\n\n---\n\n");

        return res.status(200).json({
          success: true,
          jobStatus: "completed",
          totalUrls: pollData.data?.length || 0,
          processedUrls: markdownContent.length,
          markdownContent: combinedContent,
        });
      }

      // Job failed
      if (pollData.status === "failed") {
        return res.status(500).json({
          success: false,
          jobStatus: "failed",
          error: pollData.error || "Job failed",
        });
      }

      // Job still processing
      return res.status(200).json({
        success: false,
        jobStatus: pollData.status || "processing",
      });
    }

    // Invalid action
    return res.status(400).json({
      error: "Invalid action. Use 'start' or 'check'",
    });
  } catch (error) {
    console.error("Batch processing error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
