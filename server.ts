import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Initialize Gemini SDK with telemetry header
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Security configuration for Google Drive media proxy
const MAX_PROXY_FILE_SIZE = 50 * 1024 * 1024; // 50MB maximum file size limit
const PROXY_TIMEOUT_MS = 25000; // 25s timeout limit

// Strict allowlist of Google Drive export MIME types
const ALLOWED_EXPORT_MIMETYPES = new Set([
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "application/pdf",
  "text/html",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Validates that a redirect hostname belongs strictly to Google Drive infrastructure
function isAllowedDriveHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "www.googleapis.com" || host === "googleapis.com") return true;
  if (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) return true;
  if (host.endsWith(".googleapis.com")) return true;
  return false;
}

// Google Drive media proxy endpoint:
// Solves browser redirect dropping Authorization headers on 302 cross-origin redirects
// Hardened against SSRF, open proxy misuse, DoS, and token leakage.
app.get("/api/drive/media", async (req, res) => {
  // 1. Strict Parameter Validation: Only valid Drive File IDs (alphanumeric, underscores, hyphens)
  const rawFileId = typeof req.query.fileId === "string" ? req.query.fileId.trim() : "";
  const rawExportMime = typeof req.query.exportMimeType === "string" ? req.query.exportMimeType.trim() : "";
  const authHeader = req.headers.authorization;

  // File ID format check: Google Drive IDs are base64url/alphanumeric strings between 5 and 150 chars
  if (!rawFileId || !/^[a-zA-Z0-9_-]{5,150}$/.test(rawFileId)) {
    return res.status(400).json({ error: "Invalid or missing fileId parameter" });
  }

  // Export MIME type check (if present)
  if (rawExportMime && !ALLOWED_EXPORT_MIMETYPES.has(rawExportMime)) {
    return res.status(400).json({ error: "Unsupported or invalid exportMimeType parameter" });
  }

  // Authorization header validation: must be Bearer token
  if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.length < 15) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  // Set response hardening headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), PROXY_TIMEOUT_MS);

  try {
    const initialUrl = rawExportMime
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rawFileId)}/export?mimeType=${encodeURIComponent(rawExportMime)}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rawFileId)}?alt=media`;

    let currentUrl = initialUrl;
    let driveRes: Response | null = null;

    // Follow redirects manually with strict host allowlist validation (prevent open proxy / SSRF)
    for (let hop = 0; hop < 5; hop++) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(currentUrl);
      } catch {
        clearTimeout(timeoutId);
        return res.status(502).json({ error: "Invalid upstream URL generated" });
      }

      // Restrict protocol strictly to HTTPS
      if (parsedUrl.protocol !== "https:") {
        clearTimeout(timeoutId);
        return res.status(502).json({ error: "Non-HTTPS redirect blocked" });
      }

      // Restrict hostname strictly to Google Drive API hosts
      if (!isAllowedDriveHost(parsedUrl.hostname)) {
        clearTimeout(timeoutId);
        return res.status(502).json({ error: "Untrusted upstream redirect host blocked" });
      }

      driveRes = await fetch(currentUrl, {
        headers: { Authorization: authHeader },
        redirect: "manual",
        signal: abortController.signal,
      });

      if (driveRes.status >= 300 && driveRes.status < 400) {
        const location = driveRes.headers.get("location");
        if (!location) break;
        // Resolve relative or absolute redirect URL against current URL
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }

    clearTimeout(timeoutId);

    if (!driveRes) {
      return res.status(502).json({ error: "No response received from Google Drive" });
    }

    // Handle specific upstream HTTP error codes gracefully
    if (!driveRes.ok) {
      const status = driveRes.status;
      if (status === 401) {
        return res.status(401).json({ error: "Google Drive authentication failed or token expired" });
      }
      if (status === 403) {
        return res.status(403).json({ error: "Google Drive access forbidden or insufficient permissions" });
      }
      if (status === 404) {
        return res.status(404).json({ error: "File not found on Google Drive" });
      }
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        error: `Google Drive upstream responded with status ${status}`,
      });
    }

    // Check upstream Content-Length to reject oversized payloads early
    const contentLengthHeader = driveRes.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredSize = parseInt(contentLengthHeader, 10);
      if (!isNaN(declaredSize) && declaredSize > MAX_PROXY_FILE_SIZE) {
        return res.status(413).json({ error: "File size exceeds 50MB maximum proxy limit" });
      }
    }

    const contentType = driveRes.headers.get("content-type") || "application/octet-stream";

    // Reject unexpected HTML/auth responses when non-HTML content was requested
    if (rawExportMime !== "text/html" && contentType.toLowerCase().includes("text/html")) {
      return res.status(502).json({
        error: "Unexpected HTML response received from upstream storage (authentication challenge or captive redirect)",
      });
    }

    res.setHeader("Content-Type", contentType);

    // Stream and buffer the response body with strict byte counter to prevent memory exhaustion
    if (driveRes.body) {
      const reader = driveRes.body.getReader();
      let totalBytes = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_PROXY_FILE_SIZE) {
            reader.cancel();
            return res.status(413).json({ error: "File size exceeds 50MB maximum proxy limit" });
          }
          chunks.push(value);
        }
      }

      const completeBuffer = Buffer.concat(chunks);
      return res.send(completeBuffer);
    } else {
      const arrayBuf = await driveRes.arrayBuffer();
      if (arrayBuf.byteLength > MAX_PROXY_FILE_SIZE) {
        return res.status(413).json({ error: "File size exceeds 50MB maximum proxy limit" });
      }
      return res.send(Buffer.from(arrayBuf));
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: "Google Drive media fetch timed out after 25 seconds" });
    }
    // Safe error logging: NEVER log authorization headers, tokens, or raw request headers
    console.error("Error in /api/drive/media for fileId:", rawFileId, err?.message || err);
    return res.status(500).json({ error: "Internal server error fetching Google Drive media" });
  }
});

// Gemini API: Generate one-sentence Cleanup Insight
app.post("/api/gemini/cleanup-insight", async (req, res) => {
  try {
    const { folderName, matches, totalScanned, totalUniqueKept } = req.body;

    // Fallback heuristic generator if Gemini key is absent or call fails
    const generateFallbackInsight = () => {
      if (!matches || matches.length === 0) {
        return "No duplicate files or draft redundancies were identified in this folder.";
      }

      // Analyze file extensions and names
      const extensions: Record<string, number> = {};
      const nameKeywords: Record<string, number> = {};
      let exactCount = 0;
      let draftCount = 0;

      for (const m of matches) {
        if (m.type === "exact") exactCount++;
        else draftCount++;

        const name = (m.name || m.targetFile?.name || "").toLowerCase();
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "files";
        extensions[ext] = (extensions[ext] || 0) + 1;

        const words = name.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter((w: string) => w.length > 3);
        for (const w of words) {
          nameKeywords[w] = (nameKeywords[w] || 0) + 1;
        }
      }

      const topExt = Object.entries(extensions).sort((a, b) => b[1] - a[1])[0]?.[0] || "files";
      const topKeyword = Object.entries(nameKeywords).sort((a, b) => b[1] - a[1])[0]?.[0];

      if (topKeyword && draftCount > exactCount) {
        return `Most duplicates are revision drafts and working copies related to ${topKeyword} ${topExt} files.`;
      }
      if (exactCount >= draftCount) {
        return `Most duplicates are exact identical copies across your ${topExt} records.`;
      }
      return `Most duplicates are older version drafts and superseded copies of your ${topExt} documents.`;
    };

    const ai = getGeminiClient();
    if (!ai) {
      return res.json({
        insight: generateFallbackInsight(),
        source: "heuristic_fallback",
      });
    }

    if (!matches || matches.length === 0) {
      return res.json({
        insight: "No duplicate files or draft redundancies were detected across your reviewed files.",
        source: "gemini",
      });
    }

    // Prepare concise summary of duplicate files for Gemini (limit to 25 items for fast processing)
    const sampleItems = matches.slice(0, 25).map((m: any) => {
      const targetName = m.name || m.targetFile?.name || "Unknown";
      const originalName = m.originalName || m.keptOriginalFile?.name || "Original";
      const type = m.type === "exact" ? "exact duplicate" : "draft / older version";
      const reason = m.reason || "";
      return `- "${targetName}" (duplicate of "${originalName}", type: ${type}${reason ? `, context: ${reason}` : ""})`;
    });

    const prompt = `You are a file system and storage organization specialist.
Analyze the following list of duplicate/draft files and their kept originals discovered in Google Drive folder "${folderName || "My Drive"}":

${sampleItems.join("\n")}

Total files scanned: ${totalScanned || matches.length}
Total duplicates identified: ${matches.length}

TASK:
Provide exactly ONE concise, user-friendly sentence summarizing the common types, topics, or patterns of duplicates found (e.g., "Most duplicates are copies of your monthly budget reports" or "Duplicates primarily consist of iterative draft versions of project proposals and markdown meeting notes").

STRICT RULES:
1. Provide EXACTLY one clear, insightful sentence.
2. Do NOT use bullet points, greetings, quotes, or markdown bolding.
3. Keep it natural, conversational, and direct.`;

    // Fast call helper with timeout
    const callGeminiWithTimeout = async (modelName: string, timeoutMs = 5000): Promise<string | null> => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        );
        const apiPromise = ai.models.generateContent({
          model: modelName,
          contents: prompt,
        });

        const res = await Promise.race([apiPromise, timeoutPromise]);
        const text = res.text?.trim().replace(/^["']|["']$/g, "");
        return text || null;
      } catch (e: any) {
        console.warn(`Gemini (${modelName}) unavailable or timed out:`, e?.message || e);
        return null;
      }
    };

    // Try gemini-3.8-flash first; if unavailable (503) or timed out, try gemini-3.1-flash-lite
    let insightText = await callGeminiWithTimeout("gemini-3.8-flash", 5000);
    if (!insightText) {
      insightText = await callGeminiWithTimeout("gemini-3.1-flash-lite", 4000);
    }

    // If Gemini succeeded, return AI insight; otherwise seamlessly use tailored heuristic
    if (insightText) {
      return res.json({
        insight: insightText,
        source: "gemini",
      });
    }

    return res.json({
      insight: generateFallbackInsight(),
      source: "heuristic_fallback",
    });
  } catch (err: any) {
    console.warn("Generating fallback cleanup insight due to API unavailability:", err?.message || err);
    // Graceful fallback so UI never breaks
    return res.json({
      insight: "Most duplicates identified are older revision drafts and redundant copies of your working documents.",
      source: "error_fallback",
    });
  }
});

// Vite middleware for dev or static serving for prod
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Drive Cleanup Agent server listening on port ${PORT}`);
  });
}

startServer();
