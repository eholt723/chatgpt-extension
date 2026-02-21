import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors({ origin: true })); // fine for localhost dev
app.use(express.json({ limit: "2mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sniffMimeType(contentType, url) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("image/jpeg")) return "image/jpeg";
  if (ct.includes("image/png")) return "image/png";
  if (ct.includes("image/webp")) return "image/webp";
  if (ct.includes("image/gif")) return "image/gif";

  // fallback by extension
  const lower = (url || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";

  // safest default
  return "image/jpeg";
}

async function fetchImageAsDataUrl(url) {
  // Basic safety: only allow http/https
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Only http/https image URLs are supported.");
  }

  const resp = await fetch(url, {
    method: "GET",
    // Some sites hotlink-protect; this can help a bit.
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "image/*,*/*;q=0.8"
    }
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch image (${resp.status})`);
  }

  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`URL did not return an image. content-type=${contentType || "unknown"}`);
  }

  const arrayBuffer = await resp.arrayBuffer();

  // Guardrail: keep it reasonably small for a local tool
  const maxBytes = 5 * 1024 * 1024; // 5 MB
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error("Image too large (max 5MB).");
  }

  const mime = sniffMimeType(contentType, url);
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${mime};base64,${base64}`;
}

app.post("/ask", async (req, res) => {
  try {
    const text = (req.body?.text ?? "").toString().trim();

    if (!text) return res.status(400).json({ error: "Missing text" });
    if (text.length > 8000) return res.status(400).json({ error: "Text too long" });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "Answer briefly and clearly." },
        { role: "user", content: text }
      ]
    });

    res.json({ answer: response.output_text ?? "No answer" });
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.post("/ask-image", async (req, res) => {
  try {
    const url = (req.body?.url ?? "").toString().trim();
    if (!url) return res.status(400).json({ error: "Missing url" });

    const dataUrl = await fetchImageAsDataUrl(url);

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Describe what you see in the image and answer any implied question. Be concise, but include key details."
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Analyze this image." },
            { type: "input_image", image_url: dataUrl }
          ]
        }
      ]
    });

    res.json({ answer: response.output_text ?? "No answer" });
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.listen(8787, () => {
  console.log("Proxy running: http://localhost:8787");
});