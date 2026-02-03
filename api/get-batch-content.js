export default async function handler(req, res) {
  // CORS headers - allow your domain
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
    const { urls, formats, onlyMainContent } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: "Missing or invalid 'urls' array in request body",
        received: req.body,
      });
    }

    // Step 1: Create batch job
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
          onlyMainContent: onlyMainContent !== false, // Default true
        }),
      },
    );

    const batchData = await batchResponse.json();

    if (!batchResponse.ok) {
      return res.status(batchResponse.status).json({
        error: "Firecrawl batch API error",
        details: batchData,
        statusCode: batchResponse.status,
      });
    }

    // Step 2: Poll for results
    const jobId = batchData.id;
    const jobUrl = batchData.url;

    if (!jobId || !jobUrl) {
      return res.status(500).json({
        error: "Invalid batch response - missing job ID or URL",
        response: batchData,
      });
    }

    // Poll for results with timeout
    const maxAttempts = 30; // 1 minute (30 * 2 seconds)
    const delay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const pollResponse = await fetch(jobUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          },
        });

        const pollData = await pollResponse.json();

        if (!pollResponse.ok) {
          throw new Error(
            `Polling failed: ${pollResponse.status} ${pollResponse.statusText}`,
          );
        }

        // Check job status
        if (pollData.status === "completed") {
          // Extract markdown content from all pages
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
            totalUrls: urls.length,
            processedUrls: markdownContent.length,
            markdownContent: combinedContent,
            rawData: pollData.data,
          });
        } else if (pollData.status === "failed") {
          return res.status(500).json({
            success: false,
            jobStatus: "failed",
            error: pollData.error || "Job failed",
            attempt: attempt,
          });
        } else {
          // Job still processing, wait and try again
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      } catch (pollError) {
        console.error(`Polling attempt ${attempt} failed:`, pollError.message);

        if (attempt === maxAttempts) {
          return res.status(500).json({
            success: false,
            jobStatus: "timeout",
            error: "Max polling attempts reached",
            attempt: attempt,
            lastError: pollError.message,
          });
        }
      }
    }

    // If we reach here, all attempts were exhausted
    return res.status(500).json({
      success: false,
      jobStatus: "timeout",
      error: "Job did not complete within timeout period",
      maxAttempts: maxAttempts,
    });
  } catch (error) {
    console.error("Batch processing error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
      stack: error.stack,
    });
  }
}
