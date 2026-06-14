// server/src/services/transcriptService.js
// Primary:  Python youtube-transcript-api v1.x via scripts/fetch_transcript.py (no API key)
// Fallback: Supadata.ai (set SUPADATA_API_KEY in .env to enable as second layer)

import fetch from "node-fetch";
import { runPython } from "../utils/runPython.js";

// ─── Configuration ──────────────────────────────────────────────────────────────
const CACHE_MAX_SIZE = 200;
const SUPADATA_TIMEOUT_MS = 30_000;

// ─── LRU Cache ──────────────────────────────────────────────────────────────────
const CACHE = new Map();

function cacheGet(key) {
  if (!CACHE.has(key)) return null;
  const value = CACHE.get(key);
  CACHE.delete(key);
  CACHE.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (CACHE.size >= CACHE_MAX_SIZE) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, value);
}

// ─── In-flight deduplication ────────────────────────────────────────────────────
const IN_FLIGHT = new Map();

// ─── Text cleaner ───────────────────────────────────────────────────────────────
function cleanText(raw) {
  return (raw || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, "")
    .replace(/\[Music\]/gi, "")
    .replace(/\[Applause\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Layer 1: Python fetch_transcript.py ────────────────────────────────────────
async function fetchViaPython(videoId, lang = "en") {
  const { stdout } = await runPython("fetch_transcript.py", [videoId, lang], 30_000);
  const result = JSON.parse(stdout.trim());
  if (!result.text || result.text.length < 20) {
    throw new Error("Python returned empty transcript");
  }
  return cleanText(result.text);
}

// ─── Layer 2 (optional): Supadata.ai ────────────────────────────────────────────
async function fetchFromSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("SUPADATA_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPADATA_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=en&text=true`,
      {
        headers: { "x-api-key": apiKey, "User-Agent": "EduStream/1.0" },
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404)
    throw Object.assign(new Error("No transcript available for this video"), { code: "NOT_FOUND" });
  if (res.status === 403)
    throw Object.assign(new Error("Video is private or age-restricted"), { code: "FORBIDDEN" });
  if (!res.ok) throw new Error(`Supadata responded ${res.status}`);

  const data = await res.json();
  const text =
    typeof data.content === "string"
      ? data.content
      : Array.isArray(data.segments)
      ? data.segments.map((s) => s.text).join(" ")
      : null;

  if (!text || text.length < 30) throw new Error("Supadata returned empty transcript");
  return cleanText(text);
}

// ─── Public API ─────────────────────────────────────────────────────────────────
export async function fetchTranscriptText(videoId, lang = "en") {
  const key = `${videoId}:${lang}`;

  const cached = cacheGet(key);
  if (cached) return cached;

  if (IN_FLIGHT.has(key)) return IN_FLIGHT.get(key);

  const promise = (async () => {
    // Layer 1: Python (free, no API key, works locally & in Docker)
    try {
      const text = await fetchViaPython(videoId, lang);
      cacheSet(key, text);
      return text;
    } catch (pythonErr) {
      console.warn(`[transcript] Python failed for ${videoId}: ${pythonErr.message}`);
    }

    // Layer 2: Supadata (optional — only if SUPADATA_API_KEY is set)
    if (process.env.SUPADATA_API_KEY) {
      try {
        const text = await fetchFromSupadata(videoId);
        cacheSet(key, text);
        return text;
      } catch (supadataErr) {
        console.warn(`[transcript] Supadata also failed for ${videoId}: ${supadataErr.message}`);
        throw supadataErr;
      }
    }

    throw new Error(
      "Could not fetch transcript. The video may not have captions enabled."
    );
  })().finally(() => IN_FLIGHT.delete(key));

  IN_FLIGHT.set(key, promise);
  return promise;
}

export function getTranscriptStats() {
  return {
    cacheSize: CACHE.size,
    cacheCapacity: CACHE_MAX_SIZE,
    inFlightCount: IN_FLIGHT.size,
    provider: process.env.SUPADATA_API_KEY ? "python+supadata" : "python",
  };
}

