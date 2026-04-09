// /api/market.js — Secure Twelve Data proxy (Vercel serverless function)
// Your API key lives ONLY here, server-side. Users can never see it.

const TD_BASE = "https://api.twelvedata.com";

// Simple in-memory cache to avoid hammering the API (resets on cold start)
const cache = {};
const CACHE_TTL = 60 * 1000; // 60 seconds

function cached(key, data) {
  cache[key] = { data, ts: Date.now() };
}
function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured on server" });
  }

  const { type, symbol, symbols } = req.query;

  try {
    if (type === "price" && symbol) {
      const cacheKey = `price:${symbol}`;
      const hit = getCached(cacheKey);
      if (hit) return res.status(200).json(hit);
      const r = await fetch(`${TD_BASE}/price?symbol=${symbol}:NSE&apikey=${apiKey}`);
      const data = await r.json();
      if (data.status === "error") return res.status(400).json({ error: data.message });
      cached(cacheKey, data);
      return res.status(200).json(data);
    }

    if (type === "prices" && symbols) {
      const cacheKey = `prices:${symbols}`;
      const hit = getCached(cacheKey);
      if (hit) return res.status(200).json(hit);
      const nseSymbols = symbols.split(",").map(s => `${s.trim()}:NSE`).join(",");
      const r = await fetch(`${TD_BASE}/price?symbol=${nseSymbols}&apikey=${apiKey}`);
      const data = await r.json();
      if (data.status === "error") return res.status(400).json({ error: data.message });
      cached(cacheKey, data);
      return res.status(200).json(data);
    }

    if (type === "quote" && symbol) {
      const cacheKey = `quote:${symbol}`;
      const hit = getCached(cacheKey);
      if (hit) return res.status(200).json(hit);
      const r = await fetch(`${TD_BASE}/quote?symbol=${symbol}:NSE&apikey=${apiKey}`);
      const data = await r.json();
      if (data.status === "error") return res.status(400).json({ error: data.message });
      cached(cacheKey, data);
      return res.status(200).json(data);
    }

    if (type === "history" && symbol) {
      const cacheKey = `history:${symbol}`;
      const histEntry = cache[cacheKey];
      if (histEntry && Date.now() - histEntry.ts < 5 * 60 * 1000) {
        return res.status(200).json(histEntry.data);
      }
      const r = await fetch(`${TD_BASE}/time_series?symbol=${symbol}:NSE&interval=1day&outputsize=365&apikey=${apiKey}`);
      const data = await r.json();
      if (data.status === "error") return res.status(400).json({ error: data.message });
      cache[cacheKey] = { data, ts: Date.now() };
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Invalid type. Use: price | prices | quote | history" });

  } catch (err) {
    return res.status(500).json({ error: "Market API error: " + err.message });
  }
}
