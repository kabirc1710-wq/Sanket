import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const POPULAR = [
  "RELIANCE","TCS","HDFCBANK","INFY","HINDUNILVR","BIOCON","ITC","BAJFINANCE",
  "WIPRO","NESTLEIND","MARUTI","TATAMOTORS","SUNPHARMA","ADANIENT","ICICIBANK",
  "ZOMATO","NYKAA","PAYTM","DMART","HCLTECH","ASIANPAINT","TITAN","ULTRACEMCO",
  "BAJAJFINSV","KOTAKBANK","AXISBANK","SBILIFE","LT","POWERGRID","NTPC","ONGC",
  "COALINDIA","TATAPOWER","TATASTEEL","JSWSTEEL","HINDALCO","VEDL","CIPLA",
  "DRREDDY","DIVISLAB","APOLLOHOSP","MUTHOOTFIN","PIDILITIND","HAVELLS","VOLTAS"
];

const SECTOR_MAP = {
  RELIANCE:"Energy", TCS:"IT", HDFCBANK:"Banking", INFY:"IT", HINDUNILVR:"FMCG",
  BIOCON:"Pharma", ITC:"FMCG", BAJFINANCE:"Finance", WIPRO:"IT", NESTLEIND:"FMCG",
  MARUTI:"Auto", TATAMOTORS:"Auto", SUNPHARMA:"Pharma", ADANIENT:"Conglomerate",
  ICICIBANK:"Banking", ZOMATO:"Consumer Tech", NYKAA:"Consumer Tech", PAYTM:"Fintech",
  DMART:"Retail", HCLTECH:"IT", ASIANPAINT:"Consumer", TITAN:"Consumer",
  ULTRACEMCO:"Cement", BAJAJFINSV:"Finance", KOTAKBANK:"Banking", AXISBANK:"Banking",
  SBILIFE:"Insurance", LT:"Infrastructure", POWERGRID:"Utilities", NTPC:"Utilities",
  ONGC:"Energy", COALINDIA:"Mining", TATAPOWER:"Utilities", TATASTEEL:"Steel",
  JSWSTEEL:"Steel", HINDALCO:"Metals", VEDL:"Metals", CIPLA:"Pharma",
  DRREDDY:"Pharma", DIVISLAB:"Pharma", APOLLOHOSP:"Healthcare",
  MUTHOOTFIN:"Finance", PIDILITIND:"Consumer", HAVELLS:"Consumer", VOLTAS:"Consumer"
};

const SECTOR_COLORS = {
  "IT":"#6366f1","Banking":"#2563eb","FMCG":"#16a34a","Pharma":"#0891b2",
  "Finance":"#7c3aed","Auto":"#d97706","Energy":"#dc2626","Consumer Tech":"#ec4899",
  "Fintech":"#f59e0b","Retail":"#84cc16","Consumer":"#14b8a6","Cement":"#78716c",
  "Insurance":"#0284c7","Infrastructure":"#64748b","Utilities":"#0369a1",
  "Mining":"#92400e","Steel":"#6b7280","Metals":"#94a3b8","Healthcare":"#10b981",
  "Conglomerate":"#8b5cf6"
};

// ─── Twelve Data API — All calls go through /api/market (key is server-side) ──
// ⚠️  The API key is NEVER in this file. It lives in your Vercel env variables
//     as TWELVE_DATA_API_KEY (no REACT_APP_ prefix = not exposed to browser).
const dataCache = {};

// Check if Indian market is currently open (IST 9:15am–3:30pm, Mon–Fri)
function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const h = ist.getHours(), m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

// Fetch current price for one symbol (via secure backend proxy)
async function fetchTDPrice(symbol) {
  try {
    const res = await fetch(`/api/market?type=price&symbol=${symbol}`);
    const data = await res.json();
    if (data.error || !data.price) throw new Error(data.error || "No price");
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

// Fetch full quote — price, 52w high/low, change%, etc (via secure backend proxy)
async function fetchTDQuote(symbol) {
  if (dataCache[symbol]?.quote && Date.now() - dataCache[symbol].quoteFetched < 60000) {
    return dataCache[symbol].quote;
  }
  try {
    const res = await fetch(`/api/market?type=quote&symbol=${symbol}`);
    const data = await res.json();
    if (data.error || !data.close) throw new Error(data.error || "No quote");
    const quote = {
      price: parseFloat(data.close),
      open: parseFloat(data.open),
      high: parseFloat(data.high),
      low: parseFloat(data.low),
      prevClose: parseFloat(data.previous_close),
      volume: parseInt(data.volume),
      fiftyTwoWeekHigh: parseFloat(data["52_week"]["high"]),
      fiftyTwoWeekLow: parseFloat(data["52_week"]["low"]),
      change: parseFloat(data.change),
      changePct: parseFloat(data.percent_change),
    };
    if (!dataCache[symbol]) dataCache[symbol] = {};
    dataCache[symbol].quote = quote;
    dataCache[symbol].quoteFetched = Date.now();
    return quote;
  } catch {
    return null;
  }
}

// Fetch historical daily candles up to 1 year (via secure backend proxy)
async function fetchTDHistory(symbol) {
  if (dataCache[symbol]?.history) return dataCache[symbol].history;
  try {
    const res = await fetch(`/api/market?type=history&symbol=${symbol}`);
    const data = await res.json();
    if (data.error || !data.values) throw new Error(data.error || "No history");
    // Twelve Data returns newest first — reverse it
    const history = data.values.reverse().map(d => ({
      ts: new Date(d.datetime).getTime(),
      date: new Date(d.datetime),
      close: parseFloat(d.close),
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      open: parseFloat(d.open),
      volume: parseInt(d.volume) || 0,
    })).filter(d => d.close > 0);
    if (!dataCache[symbol]) dataCache[symbol] = {};
    dataCache[symbol].history = history;
    return history;
  } catch {
    return null;
  }
}

// Refresh live prices for all portfolio stocks — batched (via secure backend proxy)
async function refreshLivePrices(portfolio) {
  const results = {};
  const symbolList = portfolio.map(s => s.symbol).join(",");
  try {
    const res = await fetch(`/api/market?type=prices&symbols=${symbolList}`);
    const data = await res.json();
    if (portfolio.length === 1) {
      if (data.price) results[portfolio[0].symbol] = parseFloat(data.price);
    } else {
      for (const stock of portfolio) {
        const key = `${stock.symbol}:NSE`;
        if (data[key]?.price) results[stock.symbol] = parseFloat(data[key].price);
      }
    }
  } catch {}
  return results;
}

// Fallback: generate realistic simulated history if API fails
function generateHistory(basePrice, days = 252) {
  const h = [];
  let p = basePrice * 0.75;
  let vol = basePrice * 80000;
  for (let i = days; i >= 0; i--) {
    const noise = (Math.random() - 0.478) * 0.022;
    p = Math.max(p * (1 + 0.0003 + noise), basePrice * 0.3);
    const high = p * (1 + Math.random() * 0.012);
    const low = p * (1 - Math.random() * 0.012);
    const volume = vol * (0.6 + Math.random() * 1.1);
    const date = new Date(); date.setDate(date.getDate() - i);
    h.push({ ts: date.getTime(), date, close: parseFloat(p.toFixed(2)), high: parseFloat(high.toFixed(2)), low: parseFloat(low.toFixed(2)), open: parseFloat(p.toFixed(2)), volume: Math.round(volume) });
  }
  h[h.length - 1].close = basePrice;
  return h;
}

function sliceByRange(history, range) {
  const ms = { "1W":604800000,"1M":2592000000,"3M":7776000000,"6M":15552000000,"1Y":31536000000 };
  if (range === "ALL") return history;
  const cutoff = Date.now() - (ms[range] || ms["3M"]);
  const sl = history.filter(d => d.ts >= cutoff);
  return sl.length > 5 ? sl : history.slice(-60);
}

// ─── Technical Indicators ─────────────────────────────────────────────────────
function emaCalc(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return parseFloat(e.toFixed(2));
}
function calcRSI(data, period = 14) {
  const c = data.map(d => d.close);
  if (c.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = c.length - period; i < c.length; i++) { const d = c[i] - c[i-1]; d > 0 ? g += d : l += Math.abs(d); }
  const rs = (g / period) / (l / period || 0.001);
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}
function calcMACD(data) {
  const c = data.map(d => d.close);
  if (c.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const e12 = emaCalc(c, 12), e26 = emaCalc(c, 26);
  const macd = parseFloat((e12 - e26).toFixed(2));
  const signal = parseFloat((macd * 0.85).toFixed(2));
  return { macd, signal, hist: parseFloat((macd - signal).toFixed(2)) };
}
function calcBB(data, period = 20) {
  const c = data.map(d => d.close);
  const sl = c.slice(-period);
  const ma = sl.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - ma) ** 2, 0) / period);
  const upper = parseFloat((ma + 2 * std).toFixed(2));
  const lower = parseFloat((ma - 2 * std).toFixed(2));
  return { upper, lower, ma: parseFloat(ma.toFixed(2)), pct: parseFloat(((c[c.length-1] - lower) / (upper - lower) * 100).toFixed(1)) };
}
function calcSupertrend(data, period = 7, mult = 3) {
  if (data.length < period + 1) return { signal: "HOLD", atr: 0 };
  const atr = data.slice(-period).reduce((acc, d, i, arr) => i === 0 ? acc : acc + Math.max(d.high - d.low, Math.abs(d.high - arr[i-1].close), Math.abs(d.low - arr[i-1].close)), 0) / (period - 1);
  const last = data[data.length - 1];
  const hl2 = (last.high + last.low) / 2;
  return { signal: last.close > hl2 - mult * atr ? "BUY" : "SELL", atr: parseFloat(atr.toFixed(2)) };
}
function calcStoch(data, period = 14) {
  const sl = data.slice(-period);
  const hh = Math.max(...sl.map(d => d.high)), ll = Math.min(...sl.map(d => d.low));
  const k = parseFloat(((data[data.length-1].close - ll) / (hh - ll) * 100).toFixed(1));
  return { k, d: parseFloat((k * 0.9).toFixed(1)) };
}
function calcADX(data, period = 14) {
  if (data.length < period + 1) return { adx: 25, pdi: 20, ndi: 20 };
  const sl = data.slice(-period - 1);
  let tr = 0, pDM = 0, nDM = 0;
  for (let i = 1; i < sl.length; i++) {
    tr += Math.max(sl[i].high - sl[i].low, Math.abs(sl[i].high - sl[i-1].close), Math.abs(sl[i].low - sl[i-1].close));
    const up = sl[i].high - sl[i-1].high, dn = sl[i-1].low - sl[i].low;
    if (up > dn && up > 0) pDM += up;
    if (dn > up && dn > 0) nDM += dn;
  }
  const pdi = parseFloat((100 * pDM / (tr || 1)).toFixed(1));
  const ndi = parseFloat((100 * nDM / (tr || 1)).toFixed(1));
  return { adx: parseFloat((Math.abs(pdi - ndi) / (pdi + ndi || 1) * 100).toFixed(1)), pdi, ndi };
}
function calcParabolicSAR(data) {
  if (data.length < 5) return { signal: "HOLD", value: data[data.length-1]?.close };
  let af = 0.02, maxAF = 0.2, sar, ep, bull;
  bull = data[1].close > data[0].close;
  sar = bull ? data[0].low : data[0].high;
  ep = bull ? data[0].high : data[0].low;
  for (let i = 1; i < data.length; i++) {
    sar = sar + af * (ep - sar);
    if (bull) {
      if (data[i].low < sar) { bull = false; sar = ep; ep = data[i].low; af = 0.02; }
      else { if (data[i].high > ep) { ep = data[i].high; af = Math.min(af + 0.02, maxAF); } sar = Math.min(sar, data[i-1]?.low || sar); }
    } else {
      if (data[i].high > sar) { bull = true; sar = ep; ep = data[i].high; af = 0.02; }
      else { if (data[i].low < ep) { ep = data[i].low; af = Math.min(af + 0.02, maxAF); } sar = Math.max(sar, data[i-1]?.high || sar); }
    }
  }
  return { signal: bull ? "BUY" : "SELL", value: parseFloat(sar.toFixed(2)) };
}
function calcWilliamsR(data, period = 14) {
  const sl = data.slice(-period);
  const hh = Math.max(...sl.map(d => d.high)), ll = Math.min(...sl.map(d => d.low));
  const r = parseFloat(((hh - data[data.length-1].close) / (hh - ll) * -100).toFixed(1));
  return { r, signal: r < -80 ? "BUY" : r > -20 ? "SELL" : "HOLD" };
}
function calcCCI(data, period = 20) {
  const sl = data.slice(-period);
  const tps = sl.map(d => (d.high + d.low + d.close) / 3);
  const ma = tps.reduce((a, b) => a + b, 0) / period;
  const md = tps.reduce((a, b) => a + Math.abs(b - ma), 0) / period;
  const cci = parseFloat(((tps[tps.length-1] - ma) / (0.015 * md || 1)).toFixed(1));
  return { cci, signal: cci < -100 ? "BUY" : cci > 100 ? "SELL" : "HOLD" };
}
function calcATR(data, period = 14) {
  if (data.length < period + 1) return 0;
  return parseFloat((data.slice(-period).reduce((acc, d, i, arr) => i === 0 ? acc : acc + Math.max(d.high - d.low, Math.abs(d.high - arr[i-1].close), Math.abs(d.low - arr[i-1].close)), 0) / (period - 1)).toFixed(2));
}
function calcOBV(data) {
  let obv = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i-1].close) obv += data[i].volume;
    else if (data[i].close < data[i-1].close) obv -= data[i].volume;
  }
  return { obv, trend: obv > 0 ? "Rising" : "Falling" };
}
function calcVWAP(data) {
  const sl = data.slice(-20);
  let pv = 0, v = 0;
  for (const d of sl) { const tp = (d.high + d.low + d.close) / 3; pv += tp * d.volume; v += d.volume; }
  return v > 0 ? parseFloat((pv / v).toFixed(2)) : data[data.length-1].close;
}

function calcSanketScore(data) {
  const rsi = calcRSI(data);
  const macd = calcMACD(data);
  const ema20 = emaCalc(data.map(d => d.close), 20);
  const ema50 = emaCalc(data.map(d => d.close), Math.min(50, data.length - 1));
  const bb = calcBB(data);
  const st = calcSupertrend(data);
  const stoch = calcStoch(data);
  const adx = calcADX(data);
  const sar = calcParabolicSAR(data);
  const wr = calcWilliamsR(data);
  const cci = calcCCI(data);
  const obv = calcOBV(data);
  const vwap = calcVWAP(data);
  const cur = data[data.length - 1].close;
  const trendScore = ([
    st.signal === "BUY" ? 10 : st.signal === "SELL" ? 0 : 5,
    macd.hist > 0 ? (macd.macd > 0 ? 10 : 7) : (macd.macd < 0 ? 0 : 3),
    ema20 > ema50 ? 10 : 0,
    bb.pct > 80 ? 2 : bb.pct < 20 ? 9 : 5,
    sar.signal === "BUY" ? 9 : 1,
  ].reduce((a, b) => a + b, 0) / 5);
  const momentumScore = ([
    rsi < 30 ? 9 : rsi > 70 ? 2 : 5 + (50 - rsi) / 10,
    stoch.k < 20 ? 9 : stoch.k > 80 ? 2 : 5,
    adx.adx > 25 ? (adx.pdi > adx.ndi ? 8 : 2) : 5,
    wr.signal === "BUY" ? 9 : wr.signal === "SELL" ? 1 : 5,
    cci.signal === "BUY" ? 9 : cci.signal === "SELL" ? 1 : 5,
  ].reduce((a, b) => a + b, 0) / 5);
  const volumeScore = ([
    obv.trend === "Rising" ? 8 : 3,
    cur > vwap ? 8 : 3,
  ].reduce((a, b) => a + b, 0) / 2);
  const score = parseFloat((trendScore * 0.4 + momentumScore * 0.35 + volumeScore * 0.25).toFixed(1));
  return { score, trendScore: parseFloat(trendScore.toFixed(1)), momentumScore: parseFloat(momentumScore.toFixed(1)), volumeScore: parseFloat(volumeScore.toFixed(1)), rsi, macd, ema20, ema50, bb, st, stoch, adx, sar, wr, cci, obv, vwap, atr: calcATR(data) };
}

function getBuySellReasons(ind, stock) {
  const cur = stock.currentPrice;
  const buyReasons = [], avoidReasons = [];
  if (ind.rsi < 35) buyReasons.push({ icon: "📊", text: `RSI at ${ind.rsi} — stock is oversold, potential bounce ahead` });
  else if (ind.rsi > 65) avoidReasons.push({ icon: "📊", text: `RSI at ${ind.rsi} — stock is overbought, high risk of pullback` });
  if (ind.macd.hist > 0 && ind.macd.macd > 0) buyReasons.push({ icon: "📈", text: "MACD shows strong bullish momentum building up" });
  else if (ind.macd.hist < 0 && ind.macd.macd < 0) avoidReasons.push({ icon: "📈", text: "MACD is negative — bearish momentum is dominating" });
  if (ind.ema20 > ind.ema50) buyReasons.push({ icon: "〰️", text: `Short-term trend is above long-term — EMA cross bullish` });
  else avoidReasons.push({ icon: "〰️", text: `Short-term trend is below long-term — EMA cross bearish` });
  if (ind.st.signal === "BUY") buyReasons.push({ icon: "🔋", text: "Supertrend confirms uptrend — price is above support band" });
  else avoidReasons.push({ icon: "🔋", text: "Supertrend is bearish — price is below resistance band" });
  if (ind.sar.signal === "BUY") buyReasons.push({ icon: "🎯", text: `Parabolic SAR flipped bullish at ₹${ind.sar.value}` });
  else avoidReasons.push({ icon: "🎯", text: `Parabolic SAR still bearish — SAR ₹${ind.sar.value} above current price` });
  if (ind.obv.trend === "Rising") buyReasons.push({ icon: "💰", text: "Volume trend is rising — smart money may be accumulating" });
  else avoidReasons.push({ icon: "💰", text: "OBV is falling — institutional selling pressure detected" });
  if (cur > ind.vwap) buyReasons.push({ icon: "⚖️", text: `Price ₹${cur} is above VWAP ₹${ind.vwap} — buyers in control` });
  else avoidReasons.push({ icon: "⚖️", text: `Price ₹${cur} is below VWAP ₹${ind.vwap} — sellers are dominant` });
  if (ind.adx.adx > 25 && ind.adx.pdi > ind.adx.ndi) buyReasons.push({ icon: "💪", text: `ADX at ${ind.adx.adx} — strong uptrend with conviction` });
  else if (ind.adx.adx < 20) avoidReasons.push({ icon: "💪", text: `ADX at ${ind.adx.adx} — weak trend, stock is ranging sideways` });
  if (ind.bb.pct < 20) buyReasons.push({ icon: "🎸", text: `Price near Bollinger lower band — historically oversold zone` });
  else if (ind.bb.pct > 80) avoidReasons.push({ icon: "🎸", text: `Price near Bollinger upper band — stretched, risk of mean reversion` });
  return { buyReasons: buyReasons.slice(0, 4), avoidReasons: avoidReasons.slice(0, 4) };
}

// ─── Signal Helpers ───────────────────────────────────────────────────────────
function sig(score) { return score >= 7 ? "BUY" : score <= 3.5 ? "SELL" : "HOLD"; }
function sigColor(s) { return s === "BUY" ? "#16a34a" : s === "SELL" ? "#dc2626" : "#d97706"; }
function sigBg(s) { return s === "BUY" ? "#f0fdf4" : s === "SELL" ? "#fef2f2" : "#fffbeb"; }
function sigBorder(s) { return s === "BUY" ? "#bbf7d0" : s === "SELL" ? "#fecaca" : "#fde68a"; }

// ─── Beginner-Friendly Plain English Descriptions ─────────────────────────────
const PLAIN_ENGLISH = {
  "Supertrend": "🌊 Like a wave detector — it tells you if the stock is riding an upwave (BUY) or a downwave (SELL). Super simple and reliable.",
  "MACD": "🏃 Two runners racing. MACD shows if the fast runner is pulling ahead (bullish) or falling behind (bearish) the slow runner.",
  "EMA Cross": "📅 Compares 20-day average vs 50-day average price. If recent average is higher, the trend is up — like a stock climbing stairs.",
  "Bollinger %B": "🎯 Tracks where price is inside a channel. Near the bottom = cheap zone (buy?). Near the top = expensive zone (careful!).",
  "Parabolic SAR": "🔴 Little dots that follow price. Dots below price = going up. Dots above = going down. Great for spotting reversals.",
  "RSI": "🌡️ A fever thermometer for stocks. Below 30 = too cold (oversold, potential buy). Above 70 = too hot (overbought, risky).",
  "Stochastic": "📍 Shows where today's price sits in its recent range. Low = near the bottom of recent prices (opportunity?). High = near the top.",
  "ADX": "💨 Measures how strong the wind is blowing. Above 25 = strong trend. Below 20 = calm, no clear direction. Doesn't tell you which way!",
  "Williams %R": "🎰 Similar to RSI but inverted. Near -100 = oversold (potential bounce). Near 0 = overbought (be cautious).",
  "CCI": "🧲 Tells you if price is far from its 'normal' range. Very high or very low = extreme. Often snaps back to normal.",
  "ATR": "🌪️ Average daily price movement. High ATR = bumpy ride. Low ATR = smooth sailing. Helps you know how risky the stock is day-to-day.",
  "OBV": "🐋 Tracks if big players (whales) are quietly buying or selling. Rising = accumulation. Falling = distribution. Follow the smart money.",
  "VWAP": "⚖️ The fair price where most trading happened. Price above VWAP = bullish. Below = bearish. Used by big institutions.",
};

const EXPLANATIONS = {
  "Supertrend": { what: "Draws a dynamic line above or below price based on volatility. When price is above the line, trend is up.", howToRead: "BUY: Price is above the Supertrend line. SELL: Price is below the line.", emoji: "🌊" },
  "MACD": { what: "Measures difference between 12-day and 26-day EMA. Shows whether short-term momentum is gaining or losing strength.", howToRead: "Positive histogram = bullish momentum. Negative = bearish. Crossing zero is a strong signal.", emoji: "🏃" },
  "EMA Cross": { what: "When 20-day EMA crosses above 50-day EMA, it signals an emerging uptrend (and vice versa).", howToRead: "20 EMA > 50 EMA = Bullish trend. 20 EMA < 50 EMA = Bearish trend.", emoji: "📅" },
  "Bollinger %B": { what: "Creates a price channel. %B tells you if price is near the top (overbought) or bottom (oversold) of recent moves.", howToRead: "Below 20% = near lower band = buy zone. Above 80% = near upper band = risky.", emoji: "🎯" },
  "Parabolic SAR": { what: "Plots trailing dots above or below price that accelerate as the trend strengthens.", howToRead: "Dots below price = uptrend (BUY). Dots above price = downtrend (SELL).", emoji: "🔴" },
  "RSI": { what: "Relative Strength Index. Measures speed and magnitude of recent price changes on a 0–100 scale.", howToRead: "Below 30 = oversold, potential reversal up. Above 70 = overbought, potential pullback.", emoji: "🌡️" },
  "Stochastic": { what: "Compares current price to its high-low range over 14 days. Shows momentum in a 0–100 scale.", howToRead: "%K below 20 = oversold (BUY). Above 80 = overbought (SELL).", emoji: "📍" },
  "ADX": { what: "Average Directional Index measures trend strength, not direction. +DI shows bullish strength, -DI shows bearish.", howToRead: "ADX above 25 = strong trend. +DI > -DI = bullish strength dominant.", emoji: "💨" },
  "Williams %R": { what: "Like RSI but on a -100 to 0 scale. Measures where current price is relative to recent range.", howToRead: "Below -80 = oversold (BUY). Above -20 = overbought (SELL).", emoji: "🎰" },
  "CCI": { what: "Commodity Channel Index. Measures how far price deviates from its statistical mean, adjusted for volatility.", howToRead: "Above +100 = overbought. Below -100 = oversold (BUY signal).", emoji: "🧲" },
  "ATR": { what: "Average True Range. Measures the average price movement (volatility) over 14 days. Higher = more volatile.", howToRead: "Not a buy/sell signal. Higher ATR = more risk and potential reward.", emoji: "🌪️" },
  "OBV": { what: "On-Balance Volume. Adds volume on up days, subtracts on down days. Tracks institutional accumulation/distribution.", howToRead: "Rising OBV = bullish (buying pressure). Falling OBV = bearish (selling pressure).", emoji: "🐋" },
  "VWAP": { what: "Volume Weighted Average Price. The average price weighted by trading volume — used by institutions as a benchmark.", howToRead: "Price above VWAP = bullish momentum. Price below = bearish bias.", emoji: "⚖️" },
};

// ─── URL Generators ───────────────────────────────────────────────────────────
function getResearchLinks(symbol) {
  const s = symbol.toUpperCase();
  return {
    financials: [
      { label: "Balance Sheet & Ratios", url: `https://www.screener.in/company/${s}/consolidated/`, desc: "P/E, ROE, debt — all in one place on Screener" },
      { label: "Quarterly Results (NSE)", url: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${s}`, desc: "Quarterly earnings and revenue figures" },
      { label: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${s}.NS`, desc: "Global reference: financials, news, charts" },
    ],
    filings: [
      { label: "Annual Reports (NSE)", url: `https://www.nseindia.com/companies-listing/corporate-filings-annual-reports?symbol=${s}`, desc: "Official annual reports filed with NSE" },
      { label: "Shareholding Pattern", url: `https://www.nseindia.com/companies-listing/corporate-filings-shareholding-patterns?symbol=${s}`, desc: "Who owns what — FII, DII, promoter breakdown" },
      { label: "BSE Filings", url: `https://www.bseindia.com/stock-share-price/${s.toLowerCase()}/equitystock/`, desc: "BSE regulatory filings and disclosures" },
    ],
    analysis: [
      { label: "Analyst Ratings (Trendlyne)", url: `https://trendlyne.com/equity/detail/${s}/`, desc: "Broker target prices and consensus ratings" },
      { label: "Moneycontrol", url: `https://www.moneycontrol.com/india/stockpricequote/${s.toLowerCase()}/${s.toLowerCase()}`, desc: "News, charts, fundamentals in one place" },
    ],
    news: [
      { label: "Latest News", url: `https://economictimes.indiatimes.com/topic/${s.toLowerCase()}-share-price`, desc: "Business news and company events" },
      { label: "Moneycontrol News", url: `https://www.moneycontrol.com/stocks/company_info/stock_news.php?sc_id=${s}`, desc: "Real-time news and analyst views" },
    ],
  };
}

// ─── Components ───────────────────────────────────────────────────────────────
const ScoreRing = memo(function ScoreRing({ score, size = 68 }) {
  const r = size * 0.38, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 10) * circ;
  const color = score >= 7 ? "#16a34a" : score <= 3.5 ? "#dc2626" : "#d97706";
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={size * 0.09} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={size * 0.09}
        strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "stroke-dasharray 0.7s ease" }} />
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize={size * 0.24} fontWeight={800} fill={color} fontFamily="'DM Mono',monospace">{score}</text>
      <text x={cx} y={cy + size * 0.18} textAnchor="middle" fontSize={size * 0.13} fill="#9ca3af" fontFamily="'DM Mono',monospace">/10</text>
    </svg>
  );
});

// Beginner-friendly indicator card with plain English tooltip
const IndicatorCard = memo(function IndicatorCard({ label, value, signal, sub, onClick, plainEnglish }) {
  const s = signal || "HOLD";
  const [showTip, setShowTip] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <div onClick={onClick}
        style={{ background: sigBg(s), border: `1px solid ${sigBorder(s)}`, borderRadius: 10, padding: "11px 13px", cursor: "pointer", transition: "transform 0.12s, box-shadow 0.12s" }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.07)"; setShowTip(true); }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; setShowTip(false); }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
          <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</div>
          <div style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: "#fff", color: sigColor(s) }}>{s}</div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: sigColor(s), marginBottom: 2 }}>{value}</div>
        <div style={{ fontSize: 10, color: "#9ca3af" }}>{sub}</div>
        <div style={{ fontSize: 9, color: "#6b7280", marginTop: 4, borderTop: "1px dashed #e5e7eb", paddingTop: 4, fontStyle: "italic" }}>
          Tap for explanation ↗
        </div>
      </div>
      {showTip && plainEnglish && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "#1e293b", color: "#e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 11, lineHeight: 1.55, zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", pointerEvents: "none" }}>
          {plainEnglish}
          <div style={{ position: "absolute", bottom: -5, left: 16, width: 10, height: 10, background: "#1e293b", transform: "rotate(45deg)" }} />
        </div>
      )}
    </div>
  );
});

function InteractiveChart({ history, range, onRangeChange }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const ranges = ["1W","1M","3M","6M","1Y","ALL"];
  const W = 600, H = 180, PL = 8, PR = 8, PT = 16, PB = 24;
  const data = useMemo(() => sliceByRange(history, range), [history, range]);
  const prices = useMemo(() => data.map(d => d.close), [data]);
  const mn = Math.min(...prices), mx = Math.max(...prices);
  const toX = i => PL + (i / (data.length - 1)) * (W - PL - PR);
  const toY = v => PT + (1 - (v - mn) / (mx - mn || 1)) * (H - PT - PB);
  const pts = prices.map((p, i) => `${toX(i)},${toY(p)}`).join(" ");
  const fillPts = `${PL},${H-PB} ${pts} ${W-PR},${H-PB}`;
  const pct = prices.length > 1 ? parseFloat(((prices[prices.length-1] - prices[0]) / prices[0] * 100).toFixed(2)) : 0;
  const isUp = pct >= 0;
  const lineColor = isUp ? "#16a34a" : "#dc2626";
  const handleMove = useCallback((e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) * (W / rect.width);
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(((x - PL) / (W - PL - PR)) * (data.length - 1))));
    setHover({ idx, d: data[idx], x: toX(idx), y: toY(data[idx].close) });
  }, [data]);
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "10px 14px 0", gap: 2, flexWrap: "wrap" }}>
        {ranges.map(r => (
          <button key={r} onClick={() => onRangeChange(r)} style={{ padding: "4px 9px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, background: range === r ? "#111827" : "transparent", color: range === r ? "#fff" : "#9ca3af", transition: "all 0.15s" }}>{r}</button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: isUp ? "#16a34a" : "#dc2626" }}>{isUp ? "▲" : "▼"} {Math.abs(pct)}%</div>
      </div>
      <div style={{ padding: "4px 14px", height: 20, fontSize: 12, color: hover ? "#111827" : "#9ca3af", fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>
        {hover ? `₹${hover.d.close.toLocaleString("en-IN")} · ${new Date(hover.d.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : `₹${prices[prices.length-1]?.toLocaleString("en-IN")} · Latest`}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, cursor: "crosshair", display: "block" }}
        onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fillPts} fill="url(#cg)" />
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {hover && <>
          <line x1={hover.x} y1={PT} x2={hover.x} y2={H - PB} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,3" />
          <circle cx={hover.x} cy={hover.y} r={4} fill={lineColor} stroke="#fff" strokeWidth={2} />
        </>}
      </svg>
    </div>
  );
}

// Beginner-friendly explainer modal
function ExplainModal({ indicator, onClose, onAskAI }) {
  if (!indicator) return null;
  const info = EXPLANATIONS[indicator] || { what: "Details coming soon.", howToRead: "", emoji: "📊" };
  const plain = PLAIN_ENGLISH[indicator] || "";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 28 }}>{info.emoji}</span>
            <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 17 }}>{indicator}</div>
          </div>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>✕</button>
        </div>

        {/* Plain English - BIG and first */}
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#d97706", marginBottom: 8 }}>Simple English</div>
          <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.7, fontWeight: 500 }}>{plain}</div>
        </div>

        {/* Technical details - collapsed below */}
        {[
          { label: "What is it technically?", content: info.what },
          { label: "How to read it", content: info.howToRead },
        ].filter(s => s.content).map(s => (
          <div key={s.label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#6b7280", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7, background: "#f9fafb", borderRadius: 10, padding: "12px 14px" }}>{s.content}</div>
          </div>
        ))}

        <button onClick={() => { onAskAI(`Explain ${indicator} in super simple terms. What does it mean for my stock right now? Give me a beginner-friendly explanation with an example.`); onClose(); }}
          style={{ width: "100%", background: "#111827", color: "#fff", border: "none", borderRadius: 10, padding: "13px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 8 }}>
          🤖 Ask Sanket AI to explain this for me
        </button>
      </div>
    </div>
  );
}

// Loading spinner for stock data
function DataLoader({ symbol }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#eff6ff", borderRadius: 10, marginBottom: 12, border: "1px solid #bfdbfe" }}>
      <div style={{ width: 16, height: 16, border: "2px solid #bfdbfe", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 600 }}>Fetching real NSE data for {symbol} from Twelve Data…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// AI Chat Panel
function AIChatPanel({ aiMsgs, aiLoading, aiInput, setAiInput, sendAI, selStock, chatEndRef, aiState, setAiState }) {
  const isOpen = aiState === "open";
  const quickPrompts = [
    "What does this score mean?",
    "Should I buy more?",
    "What are the risks?",
    selStock ? `Explain ${selStock.symbol} in simple terms` : "How does RSI work?",
  ];
  if (aiState === "hidden") {
    return (
      <button onClick={() => setAiState("open")}
        style={{ position: "fixed", bottom: 24, right: 24, background: "#111827", color: "#fff", border: "none", borderRadius: 16, padding: "12px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 32px rgba(0,0,0,0.25)", zIndex: 200, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🤖</span> Sanket AI
        {aiMsgs.length > 1 && <span style={{ background: "#2563eb", borderRadius: "50%", width: 18, height: 18, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{aiMsgs.filter(m => m.role === "assistant").length}</span>}
      </button>
    );
  }
  return (
    <div style={{ position: "fixed", bottom: 0, right: 24, width: 300, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "16px 16px 0 0", boxShadow: "0 -4px 40px rgba(0,0,0,0.12)", zIndex: 200, display: "flex", flexDirection: "column", maxHeight: isOpen ? 480 : 0, transition: "max-height 0.3s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: isOpen ? "1px solid #f3f4f6" : "none", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", background: isOpen ? "#fff" : "#f9fafb", borderRadius: "16px 16px 0 0", flexShrink: 0 }}
        onClick={() => setAiState(isOpen ? "minimized" : "open")}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: aiLoading ? "#f59e0b" : "#16a34a" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>Sanket AI</div>
          {!isOpen && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>{aiMsgs.filter(m=>m.role==="assistant").length} replies</div>}
        </div>
        {isOpen ? (
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={e => { e.stopPropagation(); setAiState("minimized"); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, width: 24, height: 24, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>—</button>
            <button onClick={e => { e.stopPropagation(); setAiState("hidden"); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, width: 24, height: 24, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>▲ Open</div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {aiMsgs.map((m, i) => (
          <div key={i} style={{ maxWidth: "92%", alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "#111827" : "#f3f4f6", borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px", padding: "9px 12px", fontSize: 12, lineHeight: 1.65, color: m.role === "user" ? "#fff" : "#111827", whiteSpace: "pre-wrap" }}>
            {m.content}
          </div>
        ))}
        {aiLoading && <div style={{ alignSelf: "flex-start", background: "#f3f4f6", borderRadius: "14px 14px 14px 3px", padding: "9px 12px", fontSize: 12, color: "#9ca3af" }}>Thinking…</div>}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: "0 10px 6px", display: "flex", flexWrap: "wrap", gap: 4 }}>
        {quickPrompts.map(p => (
          <button key={p} onClick={() => { setAiInput(p); }} style={{ background: "#f3f4f6", border: "none", color: "#374151", borderRadius: 7, padding: "4px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>{p}</button>
        ))}
      </div>
      <div style={{ padding: "6px 10px 10px", borderTop: "1px solid #f3f4f6", display: "flex", gap: 6 }}>
        <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendAI()} placeholder="Ask anything in plain English…"
          style={{ flex: 1, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 9, padding: "7px 11px", color: "#111827", fontSize: 12, outline: "none", fontFamily: "'DM Sans',sans-serif" }} />
        <button onClick={sendAI} style={{ background: "#111827", color: "#fff", border: "none", borderRadius: 8, padding: "0 12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>↑</button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Sanket() {
  const [portfolio, setPortfolio] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState("analysis");
  const [range, setRange] = useState("3M");
  const [showAdd, setShowAdd] = useState(false);
  const [explainInd, setExplainInd] = useState(null);
  const [form, setForm] = useState({ symbol: "", buyPrice: "", qty: "", thesis: "" });
  const [searchQ, setSearchQ] = useState("");
  const [addError, setAddError] = useState("");
  const [aiMsgs, setAiMsgs] = useState([{ role: "assistant", content: "Hi! I'm Sanket AI 👋\n\nI'm here to help you understand your stocks in plain English — no jargon, no BS.\n\nAdd a stock and I'll automatically explain what all the indicators mean for you!" }]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [autoAnalysisDone, setAutoAnalysisDone] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [aiState, setAiState] = useState("open");
  const [loadingStocks, setLoadingStocks] = useState({});
  const chatEndRef = useRef(null);

  useEffect(() => { try { const s = localStorage.getItem("sanket_v6"); if (s) setPortfolio(JSON.parse(s)); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("sanket_v6", JSON.stringify(portfolio)); } catch {} }, [portfolio]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMsgs]);

  const selStock = useMemo(() => portfolio.find(p => p.id === selectedId) || null, [portfolio, selectedId]);
  const selInd = useMemo(() => selStock ? calcSanketScore(selStock.history) : null, [selStock]);
  const avgScore = useMemo(() => portfolio.length === 0 ? 0 : parseFloat((portfolio.reduce((a, s) => a + calcSanketScore(s.history).score, 0) / portfolio.length).toFixed(1)), [portfolio]);
  const totalInvested = useMemo(() => portfolio.reduce((a, s) => a + s.buyPrice * s.qty, 0), [portfolio]);
  const totalCurrent = useMemo(() => portfolio.reduce((a, s) => a + s.currentPrice * s.qty, 0), [portfolio]);
  const totalPnL = totalCurrent - totalInvested;
  const totalPct = totalInvested > 0 ? totalPnL / totalInvested * 100 : 0;
  const suggestions = POPULAR.filter(s => s.includes(searchQ.toUpperCase()) && searchQ.length > 0).slice(0, 6);

  // Auto-analysis when stock selected
  useEffect(() => {
    if (!selStock || !selInd || autoAnalysisDone[selStock.id]) return;
    const signal = sig(selInd.score);
    const { buyReasons, avoidReasons } = getBuySellReasons(selInd, selStock);
    const buyList = buyReasons.map(r => `+ ${r.text}`).join("\n");
    const avoidList = avoidReasons.map(r => `- ${r.text}`).join("\n");
    const dataSource = selStock.realData ? "✅ Real-time data from Yahoo Finance" : "⚠️ Simulated data (couldn't fetch real data)";
    const prompt = `Auto-analyse ${selStock.symbol}. ${dataSource}. Sanket Score: ${selInd.score}/10 (${signal}). P&L: ${((selStock.currentPrice - selStock.buyPrice) / selStock.buyPrice * 100).toFixed(1)}%.

Buy signals:\n${buyList}\n\nRisk signals:\n${avoidList}

Give a beginner-friendly analysis in plain English. Use simple language — imagine explaining to someone who just started investing. Include: 1) What this score means in plain terms, 2) Why it could go up, 3) Why it could fall, 4) A clear action. Max 180 words. No jargon unless you explain it.`;
    triggerAI(prompt, true);
    setAutoAnalysisDone(prev => ({ ...prev, [selStock.id]: true }));
  }, [selStock?.id]);

  // Live price refresh every 60s during market hours
  useEffect(() => {
    if (portfolio.length === 0) return;
    const refresh = async () => {
      if (!isMarketOpen()) return;
      const updates = await refreshLivePrices(portfolio);
      if (Object.keys(updates).length === 0) return;
      setPortfolio(p => p.map(s => {
        const newPrice = updates[s.symbol];
        if (!newPrice || newPrice === s.currentPrice) return s;
        const h = [...s.history];
        h[h.length - 1] = { ...h[h.length - 1], close: newPrice };
        return { ...s, currentPrice: newPrice, history: h, realData: true };
      }));
    };
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [portfolio.length]);
  useEffect(() => {
    if (portfolio.length === 0) return;
    const newAlerts = [];
    portfolio.forEach(stock => {
      const ind = calcSanketScore(stock.history);
      const pnlPct = (stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100;
      if (ind.rsi < 30) newAlerts.push({ id: `${stock.id}-rsi`, stock: stock.symbol, signal: "BUY", score: ind.score, msg: `RSI at ${ind.rsi} — oversold, potential bounce` });
      if (ind.rsi > 72) newAlerts.push({ id: `${stock.id}-rsi-ob`, stock: stock.symbol, signal: "SELL", score: ind.score, msg: `RSI at ${ind.rsi} — overbought, consider taking profits` });
      if (ind.score >= 7) newAlerts.push({ id: `${stock.id}-score-buy`, stock: stock.symbol, signal: "BUY", score: ind.score, msg: `Sanket Score ${ind.score}/10 — strong buy signal` });
      if (ind.score <= 3) newAlerts.push({ id: `${stock.id}-score-sell`, stock: stock.symbol, signal: "SELL", score: ind.score, msg: `Sanket Score ${ind.score}/10 — weak, consider exiting` });
      if (pnlPct <= -5) newAlerts.push({ id: `${stock.id}-drop`, stock: stock.symbol, signal: "SELL", score: ind.score, msg: `Down ${pnlPct.toFixed(1)}% from your buy price — review position` });
      if (ind.st.signal === "BUY" && ind.macd.hist > 0 && ind.ema20 > ind.ema50) newAlerts.push({ id: `${stock.id}-triple`, stock: stock.symbol, signal: "BUY", score: ind.score, msg: `Triple confirmation: Supertrend + MACD + EMA all bullish` });
    });
    if (newAlerts.length > 0) setAlerts(newAlerts.slice(0, 6));
  }, [portfolio]);

  async function triggerAI(message, isAuto = false) {
    setAiLoading(true);
    if (!isAuto) setAiMsgs(m => [...m, { role: "user", content: message }]);
    else setAiMsgs(m => [...m, { role: "assistant", content: `Analysing ${selStock?.symbol}…` }]);
    const ctx = portfolio.map(s => {
      const ind = calcSanketScore(s.history);
      return `${s.symbol}: Buy ₹${s.buyPrice} → Now ₹${s.currentPrice}, Sanket Score ${ind.score}/10 (${sig(ind.score)}), RSI ${ind.rsi}, MACD hist ${ind.macd.hist}. ${s.realData ? "Real data." : "Simulated data."}`;
    }).join("\n");
    try {
      const res = await fetch("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `You are Sanket AI — a friendly Indian stock market guide for beginners and Gen Z investors. Your job is to make investing simple, not scary. ALWAYS use plain English. Avoid jargon, or if you use it, explain it immediately in brackets. Use analogies and real-life comparisons. Be honest and balanced — mention both upsides AND risks. Never be one-sided. Think of yourself as a knowledgeable older sibling explaining stocks over chai, not a stiff financial advisor. Understand the Sanket Score (0–10 composite technical score: trend 40% + momentum 35% + volume 25%). Max 200 words.\n\nPortfolio:\n${ctx || "No stocks yet."}`,
          messages: [...aiMsgs.filter(m => !m.content.includes("Analysing ")), { role: "user", content: message }].map(m => ({ role: m.role, content: m.content }))
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Error — please try again.";
      setAiMsgs(m => {
        const filtered = isAuto ? m.filter(msg => !msg.content.includes("Analysing ")) : m;
        return [...filtered, { role: "assistant", content: reply }];
      });
    } catch {
      setAiMsgs(m => {
        const filtered = isAuto ? m.filter(msg => !msg.content.includes("Analysing ")) : m;
        return [...filtered, { role: "assistant", content: "Connection error. Make sure you're connected to the internet." }];
      });
    }
    setAiLoading(false);
  }

  function sendAI() {
    if (!aiInput.trim() || aiLoading) return;
    const msg = aiInput.trim(); setAiInput("");
    triggerAI(msg, false);
  }

  async function addStock() {
    setAddError("");
    const sym = form.symbol.trim().toUpperCase();
    if (!sym) return setAddError("Enter a stock symbol");
    if (!form.buyPrice || isNaN(form.buyPrice) || +form.buyPrice <= 0) return setAddError("Enter a valid buy price");
    if (!form.qty || isNaN(form.qty) || +form.qty <= 0) return setAddError("Enter a valid quantity");
    if (portfolio.find(s => s.symbol === sym)) return setAddError(`${sym} already in portfolio`);

    const buyPrice = parseFloat(form.buyPrice);
    const id = Date.now();
    setLoadingStocks(l => ({ ...l, [id]: true }));

    // Add with buy price first, fetch real data
    const baseHistory = generateHistory(buyPrice);
    const tempStock = {
      id, symbol: sym, buyPrice, currentPrice: buyPrice,
      qty: parseInt(form.qty), thesis: form.thesis,
      history: baseHistory, addedOn: new Date().toLocaleDateString("en-IN"),
      realData: false, loading: true
    };
    setPortfolio(p => [...p, tempStock]);
    setForm({ symbol: "", buyPrice: "", qty: "", thesis: "" });
    setSearchQ(""); setShowAdd(false);
    setSelectedId(id);

    // Fetch real data in background
    try {
      const [quote, history] = await Promise.all([
        fetchTDQuote(sym),
        fetchTDHistory(sym)
      ]);
      if (quote && history && history.length > 10) {
        setPortfolio(p => p.map(s => s.id === id ? {
          ...s,
          currentPrice: quote.price,
          history,
          realData: true,
          loading: false,
          quote,
        } : s));
        setAutoAnalysisDone(prev => { const next = {...prev}; delete next[id]; return next; });
      } else if (quote) {
        setPortfolio(p => p.map(s => s.id === id ? { ...s, currentPrice: quote.price, loading: false, realData: false, quote } : s));
      } else {
        setPortfolio(p => p.map(s => s.id === id ? { ...s, loading: false } : s));
      }
    } catch {
      setPortfolio(p => p.map(s => s.id === id ? { ...s, loading: false } : s));
    }
    setLoadingStocks(l => { const n = {...l}; delete n[id]; return n; });
  }

  function updatePrice(id, val) {
    const v = parseFloat(val); if (isNaN(v) || v <= 0) return;
    setPortfolio(p => p.map(s => { if (s.id !== id) return s; const h = [...s.history]; h[h.length-1] = { ...h[h.length-1], close: v }; return { ...s, currentPrice: v, history: h }; }));
  }

  const C = {
    root: { minHeight: "100vh", background: "#f4f5f7", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#111827" },
    header: { background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 54, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
    logo: { fontFamily: "'DM Mono','Courier New',monospace", fontSize: 20, fontWeight: 800, color: "#111827" },
    body: { display: "grid", gridTemplateColumns: "248px 1fr", flex: 1, minHeight: "calc(100vh - 54px)", alignItems: "start" },
    sidebar: { background: "#fff", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", position: "sticky", top: 54, maxHeight: "calc(100vh - 54px)", overflowY: "auto" },
    main: { padding: 20, paddingBottom: 120, minHeight: "calc(100vh - 54px)", overflowY: "visible" },
    addBtn: { background: "#111827", color: "#fff", border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
    input: { width: "100%", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 9, padding: "10px 14px", color: "#111827", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans',sans-serif" },
    label: { fontSize: 10, color: "#9ca3af", fontWeight: 700, letterSpacing: 1, marginBottom: 5, display: "block", textTransform: "uppercase" },
    modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" },
    sectionTitle: { fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#374151", marginBottom: 10 },
  };

  const mainTabs = [
    { id: "analysis", label: "Analysis" },
    { id: "insights", label: "Insights" },
    { id: "sectors", label: "Sectors" },
    ...(selStock ? [{ id: "research", label: "Research" }] : []),
  ];

  return (
    <div style={C.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@500;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>

      <header style={C.header}>
        <div style={C.logo}>san<span style={{ color: "#2563eb" }}>ket</span> <span style={{ fontSize: 11, fontFamily: "DM Sans", fontWeight: 600, color: "#9ca3af" }}>v6 · real data</span></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: isMarketOpen() ? "#f0fdf4" : "#f9fafb", border: `1px solid ${isMarketOpen() ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: 8, padding: "4px 10px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: isMarketOpen() ? "#16a34a" : "#9ca3af" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: isMarketOpen() ? "#16a34a" : "#6b7280" }}>{isMarketOpen() ? "Market Open" : "Market Closed"}</span>
          </div>
          {alerts[0] && (
            <div style={{ background: sigBg(alerts[0].signal), border: `1px solid ${sigBorder(alerts[0].signal)}`, borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: sigColor(alerts[0].signal) }}>
              {alerts[0].stock}: {alerts[0].signal} signal
            </div>
          )}
          <button style={C.addBtn} onClick={() => setShowAdd(true)}>+ Add Stock</button>
        </div>
      </header>

      <div style={C.body}>
        {/* Sidebar */}
        <div style={C.sidebar}>
          <div style={{ padding: "14px 14px 0" }}>
            <div style={{ background: "#f9fafb", borderRadius: 12, padding: "13px 14px", marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>Portfolio Value</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>₹{totalCurrent.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: totalPnL >= 0 ? "#16a34a" : "#dc2626", marginTop: 2 }}>
                {totalPnL >= 0 ? "▲" : "▼"} ₹{Math.abs(totalPnL).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ({Math.abs(totalPct).toFixed(2)}%)
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div style={{ background: "#f9fafb", borderRadius: 10, padding: "9px 11px" }}>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Avg Score</div>
                <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: avgScore >= 7 ? "#16a34a" : avgScore <= 3.5 ? "#dc2626" : "#d97706" }}>{avgScore}/10</div>
              </div>
              <div style={{ background: "#f9fafb", borderRadius: 10, padding: "9px 11px" }}>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Holdings</div>
                <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>{portfolio.length}</div>
              </div>
            </div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#9ca3af", marginBottom: 8 }}>Holdings</div>
          </div>

          {portfolio.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#9ca3af" }}>
              <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 4 }}>No stocks yet</div>
              <div style={{ fontSize: 12 }}>Add your first stock to get started</div>
            </div>
          ) : portfolio.map(stock => {
            const ind = calcSanketScore(stock.history);
            const signal = sig(ind.score);
            const pnlPct = (stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100;
            const isSel = selectedId === stock.id;
            const sectorColor = SECTOR_COLORS[SECTOR_MAP[stock.symbol]] || "#6b7280";
            return (
              <div key={stock.id} onClick={() => { setSelectedId(isSel ? null : stock.id); setActiveTab("analysis"); }}
                style={{ padding: "11px 14px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: isSel ? "#f0f7ff" : "transparent", borderLeft: isSel ? "3px solid #2563eb" : "3px solid transparent", transition: "all 0.12s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontWeight: 800, fontSize: 13, fontFamily: "'DM Mono',monospace" }}>{stock.symbol}</span>
                    {stock.loading && <div style={{ width: 8, height: 8, border: "1.5px solid #bfdbfe", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />}
                    {stock.realData && <span style={{ fontSize: 8, color: "#16a34a", fontWeight: 700 }}>LIVE</span>}
                    <span style={{ fontSize: 9, color: "#fff", background: sectorColor, borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>{SECTOR_MAP[stock.symbol] || "EQ"}</span>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: sigBg(signal), color: sigColor(signal) }}>{signal}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>Score: <b style={{ color: sigColor(signal), fontFamily: "'DM Mono',monospace" }}>{ind.score}</b>/10</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: pnlPct >= 0 ? "#16a34a" : "#dc2626" }}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}

          {alerts.length > 0 && (
            <div style={{ padding: 14, borderTop: "1px solid #f3f4f6", marginTop: "auto" }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#9ca3af", marginBottom: 8 }}>Alerts</div>
              {alerts.slice(0, 3).map(a => (
                <div key={a.id} style={{ background: sigBg(a.signal), border: `1px solid ${sigBorder(a.signal)}`, borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
                  <div style={{ fontWeight: 800, color: sigColor(a.signal), fontSize: 12 }}>{a.stock} — {a.signal}</div>
                  <div style={{ color: "#6b7280", fontSize: 11, marginTop: 1 }}>Score: {a.score}/10</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Main */}
        <div style={C.main}>
          <div style={{ display: "flex", gap: 2, background: "#e5e7eb", borderRadius: 12, padding: 3, marginBottom: 20, width: "fit-content" }}>
            {mainTabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ padding: "7px 18px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: activeTab === t.id ? "#fff" : "transparent", color: activeTab === t.id ? "#111827" : "#6b7280", boxShadow: activeTab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.15s" }}>{t.label}</button>
            ))}
          </div>

          {/* INSIGHTS */}
          {activeTab === "insights" && (
            <div style={{ paddingBottom: 20 }}>
              {portfolio.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>
                  <div style={{ fontWeight: 700, color: "#374151", fontSize: 16, marginBottom: 4 }}>Add stocks to see portfolio insights</div>
                </div>
              ) : (() => {
                const allInd = portfolio.map(s => ({ stock: s, ind: calcSanketScore(s.history) }));
                const buyCount = allInd.filter(x => sig(x.ind.score) === "BUY").length;
                const sellCount = allInd.filter(x => sig(x.ind.score) === "SELL").length;
                const holdCount = allInd.filter(x => sig(x.ind.score) === "HOLD").length;
                const sectorMap = portfolio.reduce((m, s) => { const sec = SECTOR_MAP[s.symbol] || "Other"; const val = s.currentPrice * s.qty; m[sec] = (m[sec] || 0) + val; return m; }, {});
                const totalVal = Object.values(sectorMap).reduce((a, b) => a + b, 0);
                const topSector = Object.entries(sectorMap).sort((a, b) => b[1] - a[1])[0];
                const topSectorPct = topSector ? (topSector[1] / totalVal * 100).toFixed(0) : 0;
                const weakest = [...allInd].sort((a, b) => a.ind.score - b.ind.score)[0];
                const strongest = [...allInd].sort((a, b) => b.ind.score - a.ind.score)[0];
                const avgRSI = parseFloat((allInd.reduce((a, x) => a + x.ind.rsi, 0) / allInd.length).toFixed(0));
                const portfolioRisk = allInd.filter(x => x.ind.rsi > 65 || sig(x.ind.score) === "SELL").length > portfolio.length / 2 ? "HIGH" : allInd.filter(x => sig(x.ind.score) === "BUY").length > portfolio.length / 2 ? "LOW" : "MEDIUM";
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* Signal summary */}
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#374151", marginBottom: 14 }}>Signal Summary</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                        {[{ label: "BUY", count: buyCount, color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" }, { label: "HOLD", count: holdCount, color: "#d97706", bg: "#fffbeb", border: "#fde68a" }, { label: "SELL", count: sellCount, color: "#dc2626", bg: "#fef2f2", border: "#fecaca" }].map(s => (
                          <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "14px 0", textAlign: "center" }}>
                            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: s.color }}>{s.count}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.label} signals</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Key insights */}
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#374151", marginBottom: 14 }}>Key Insights</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {[
                          { icon: "🏦", label: "Top sector concentration", value: topSector ? `${topSectorPct}% in ${topSector[0]}` : "—", warning: topSectorPct > 40, desc: topSectorPct > 40 ? "You're heavily concentrated — consider diversifying" : "Sector allocation looks balanced" },
                          { icon: "⚠️", label: "Portfolio risk level", value: portfolioRisk, warning: portfolioRisk === "HIGH", desc: portfolioRisk === "HIGH" ? "More than half your stocks show sell/caution signals" : portfolioRisk === "LOW" ? "Most stocks show bullish signals — good position" : "Mixed signals across your portfolio" },
                          { icon: "📊", label: "Average RSI", value: avgRSI, warning: avgRSI > 68, desc: avgRSI > 68 ? "Portfolio is overbought — consider taking some profits" : avgRSI < 35 ? "Portfolio is oversold — could be a buying opportunity" : "RSI is in healthy range" },
                          { icon: "💪", label: "Strongest stock", value: strongest?.stock.symbol, warning: false, desc: `Sanket Score ${strongest?.ind.score}/10 — your best performing signal` },
                          { icon: "📉", label: "Weakest stock", value: weakest?.stock.symbol, warning: true, desc: `Sanket Score ${weakest?.ind.score}/10 — review if you should exit` },
                        ].map((ins, i) => (
                          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", background: ins.warning ? "#fef9ec" : "#f9fafb", borderRadius: 10, border: `1px solid ${ins.warning ? "#fde68a" : "#e5e7eb"}` }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{ins.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, marginBottom: 2 }}>{ins.label}</div>
                              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: ins.warning ? "#d97706" : "#111827" }}>{ins.value}</div>
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{ins.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Smart alerts */}
                    {alerts.length > 0 && (
                      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 18 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#374151", marginBottom: 14 }}>Active Alerts</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {alerts.map(a => (
                            <div key={a.id} style={{ background: sigBg(a.signal), border: `1px solid ${sigBorder(a.signal)}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 800, color: sigColor(a.signal), fontSize: 13 }}>{a.stock} — {a.signal}</div>
                                <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{a.msg}</div>
                              </div>
                              <button onClick={() => { setSelectedId(portfolio.find(s => s.symbol === a.stock)?.id); setActiveTab("analysis"); }} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>View</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* AI mentor prompts */}
                    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 14, padding: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#1d4ed8", marginBottom: 12 }}>Ask Sanket AI about your portfolio</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          `What should I do with ₹10,000 right now given my portfolio?`,
                          `Am I overinvested in ${topSector?.[0] || "any sector"}?`,
                          `Which stock is the weakest in my portfolio and should I sell it?`,
                          `Give me an honest review of my overall portfolio — what am I doing right and wrong?`,
                        ].map(p => (
                          <button key={p} onClick={() => { triggerAI(p, false); setAiState("open"); }} style={{ background: "#fff", border: "1px solid #bfdbfe", borderRadius: 9, padding: "10px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#1d4ed8", textAlign: "left" }}>{p}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* SECTORS */}
          {activeTab === "sectors" && (
            <div style={{ padding: "0 0 20px" }}>
              {portfolio.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>
                  <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>🏢</div>
                  <div style={{ fontWeight: 700, color: "#374151", fontSize: 16 }}>Add stocks to see sector breakdown</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(
                    portfolio.reduce((map, s) => {
                      const sec = SECTOR_MAP[s.symbol] || "Other";
                      if (!map[sec]) map[sec] = [];
                      map[sec].push(s); return map;
                    }, {})
                  ).map(([sector, stocks]) => {
                    const avgSc = parseFloat((stocks.reduce((a, s) => a + calcSanketScore(s.history).score, 0) / stocks.length).toFixed(1));
                    const signal = sig(avgSc);
                    const color = SECTOR_COLORS[sector] || "#6b7280";
                    return (
                      <div key={sector} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
                          <div style={{ fontWeight: 800, fontSize: 14, fontFamily: "'DM Mono',monospace" }}>{sector}</div>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 5, background: sigBg(signal), color: sigColor(signal), marginLeft: "auto" }}>{signal}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>{stocks.length} stock{stocks.length !== 1 ? "s" : ""} · Avg Score: <b style={{ color: sigColor(signal) }}>{avgSc}/10</b></div>
                        {stocks.map(s => {
                          const pnl = ((s.currentPrice - s.buyPrice) / s.buyPrice * 100).toFixed(1);
                          return (
                            <div key={s.id} onClick={() => { setSelectedId(s.id); setActiveTab("analysis"); }} style={{ marginTop: 8, padding: "8px 12px", background: "#f9fafb", borderRadius: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: 700, fontFamily: "'DM Mono',monospace", fontSize: 13 }}>{s.symbol}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: parseFloat(pnl) >= 0 ? "#16a34a" : "#dc2626" }}>{pnl >= 0 ? "+" : ""}{pnl}%</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* RESEARCH */}
          {activeTab === "research" && selStock && (
            <div>
              <button onClick={() => setActiveTab("analysis")} style={{ background: "none", border: "none", color: "#6b7280", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>← Back to Analysis</button>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
                <div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 26, fontWeight: 800 }}>{selStock.symbol}</div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>{SECTOR_MAP[selStock.symbol] || "Equity"} · NSE Listed</div>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>₹{selStock.currentPrice.toLocaleString("en-IN")}</div>
                  {selStock.realData && <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}>✅ Live price from Yahoo Finance</div>}
                </div>
              </div>
              {["financials","filings","analysis","news"].map(tab => {
                const links = getResearchLinks(selStock.symbol)[tab];
                return (
                  <div key={tab} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#374151", marginBottom: 10 }}>{tab}</div>
                    {links.map((link, i) => (
                      <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                        style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 18px", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#93c5fd"; e.currentTarget.style.background = "#f0f7ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.background = "#fff"; }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 3 }}>{link.label}</div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>{link.desc}</div>
                        </div>
                        <div style={{ fontSize: 16, color: "#2563eb" }}>↗</div>
                      </a>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* ANALYSIS */}
          {activeTab === "analysis" && (
            <>
              {!selStock ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: "#9ca3af", textAlign: "center" }}>
                  <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.15 }}>◎</div>
                  <div style={{ fontWeight: 700, color: "#374151", fontSize: 18, marginBottom: 8 }}>Select a stock</div>
                  <div style={{ fontSize: 14, maxWidth: 340, lineHeight: 1.6, color: "#6b7280" }}>Click any holding on the left. I'll explain everything in plain English — no confusing charts or jargon.</div>
                  {portfolio.length === 0 && <button style={{ marginTop: 20, background: "#111827", color: "#fff", border: "none", borderRadius: 10, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }} onClick={() => setShowAdd(true)}>Add your first stock →</button>}
                </div>
              ) : (
                <>
                  {/* Stock Header */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <ScoreRing score={selInd.score} size={70} />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 800 }}>{selStock.symbol}</div>
                          {selStock.realData ? (
                            <span style={{ fontSize: 10, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>✅ LIVE DATA</span>
                          ) : selStock.loading ? (
                            <span style={{ fontSize: 10, background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>⏳ Loading…</span>
                          ) : (
                            <span style={{ fontSize: 10, background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>⚠️ Simulated</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{SECTOR_MAP[selStock.symbol] || "Equity"} · Added {selStock.addedOn}</div>
                        <span style={{ fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 6, background: sigBg(sig(selInd.score)), color: sigColor(sig(selInd.score)) }}>Sanket Score {selInd.score}/10 — {sig(selInd.score)}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>₹{selStock.currentPrice.toLocaleString("en-IN")}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: (selStock.currentPrice - selStock.buyPrice) >= 0 ? "#16a34a" : "#dc2626", marginBottom: 8 }}>
                        {((selStock.currentPrice - selStock.buyPrice) / selStock.buyPrice * 100).toFixed(2)}% from ₹{selStock.buyPrice}
                      </div>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button onClick={() => setActiveTab("research")} style={{ background: "#f0f7ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>Research</button>
                        <input type="number" defaultValue={selStock.currentPrice} style={{ ...C.input, width: 110, padding: "7px 10px", fontSize: 12 }} onBlur={e => updatePrice(selStock.id, e.target.value)} placeholder="Update price" />
                        <button onClick={() => { setPortfolio(p => p.filter(s => s.id !== selStock.id)); setSelectedId(null); }} style={{ background: "#fee2e2", border: "none", color: "#dc2626", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>Remove</button>
                      </div>
                    </div>
                  </div>

                  {selStock.loading && <DataLoader symbol={selStock.symbol} />}

                  {/* Chart */}
                  <InteractiveChart history={selStock.history} range={range} onRangeChange={setRange} />

                  {/* P&L Quick Stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
                    {[
                      { l: "P&L", v: `${((selStock.currentPrice - selStock.buyPrice) * selStock.qty >= 0) ? "+" : ""}₹${Math.abs((selStock.currentPrice - selStock.buyPrice) * selStock.qty).toFixed(0)}`, c: (selStock.currentPrice - selStock.buyPrice) >= 0 ? "#16a34a" : "#dc2626", hint: "Your profit or loss" },
                      { l: "52W High", v: selStock.quote?.fiftyTwoWeekHigh ? `₹${selStock.quote.fiftyTwoWeekHigh.toFixed(0)}` : "—", hint: "Highest in past year" },
                      { l: "52W Low", v: selStock.quote?.fiftyTwoWeekLow ? `₹${selStock.quote.fiftyTwoWeekLow.toFixed(0)}` : "—", hint: "Lowest in past year" },
                      { l: "ATR (Risk)", v: `₹${selInd.atr}`, hint: "Typical daily move" },
                    ].map(st => (
                      <div key={st.l} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{st.l}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: st.c || "#111827" }}>{st.v}</div>
                        {st.hint && <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 2 }}>{st.hint}</div>}
                      </div>
                    ))}
                  </div>

                  {/* Decision Intelligence */}
                  {(() => {
                    const { buyReasons, avoidReasons } = getBuySellReasons(selInd, selStock);
                    return (
                      <div style={{ marginBottom: 18 }}>
                        <div style={C.sectionTitle}>Decision Intelligence</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: 16 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#16a34a", letterSpacing: 0.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 16 }}>✅</span> Why to Buy
                            </div>
                            {buyReasons.length > 0 ? buyReasons.map((r, i) => (
                              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>{r.icon}</span>
                                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{r.text}</span>
                              </div>
                            )) : <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>No strong buy signals right now.</div>}
                          </div>
                          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 14, padding: 16 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#dc2626", letterSpacing: 0.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 16 }}>⚠️</span> Why to Avoid / Sell
                            </div>
                            {avoidReasons.length > 0 ? avoidReasons.map((r, i) => (
                              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>{r.icon}</span>
                                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{r.text}</span>
                              </div>
                            )) : <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>No major red flags detected.</div>}
                          </div>
                        </div>
                        <button onClick={() => { triggerAI(`Give me a deep balanced analysis of ${selStock.symbol} for a beginner investor. Sanket Score is ${selInd.score}/10. Explain in simple terms why it could go up AND why it could fall. Use simple language, no jargon.`); setAiState("open"); }}
                          style={{ width: "100%", marginTop: 10, background: "#111827", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          🤖 Ask AI for a deeper plain-English analysis →
                        </button>
                      </div>
                    );
                  })()}

                  {/* Sanket Score Breakdown */}
                  <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#1d4ed8", marginBottom: 6 }}>Sanket Score Breakdown</div>
                    <div style={{ fontSize: 11, color: "#3b82f6", marginBottom: 12 }}>A composite of 13 technical signals. Higher = stronger bullish case.</div>
                    {[
                      { label: "Trend (40%)", score: selInd.trendScore, what: "Are more indicators saying 'go up' or 'go down'?" },
                      { label: "Momentum (35%)", score: selInd.momentumScore, what: "Is the stock speeding up or slowing down?" },
                      { label: "Volume (25%)", score: selInd.volumeScore, what: "Are big players buying or selling?" },
                    ].map(b => (
                      <div key={b.label} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                          <div>
                            <span style={{ color: "#374151", fontWeight: 700 }}>{b.label}</span>
                            <span style={{ color: "#6b7280", fontSize: 10, marginLeft: 6 }}>{b.what}</span>
                          </div>
                          <span style={{ fontWeight: 800, fontFamily: "'DM Mono',monospace", color: sigColor(sig(b.score)) }}>{b.score}/10</span>
                        </div>
                        <div style={{ height: 6, background: "#dbeafe", borderRadius: 3 }}>
                          <div style={{ width: `${b.score * 10}%`, height: "100%", background: sigColor(sig(b.score)), borderRadius: 3, transition: "width 0.6s" }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Indicators — Scrollable section */}
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
                    <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#374151" }}>All Technical Indicators</div>
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>Hover for plain English · Tap for full explanation</div>
                    </div>

                    {/* Scrollable content */}
                    <div style={{ overflowY: "auto", maxHeight: 500, padding: "14px 16px" }}>

                      {/* Trend */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#374151", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                          🌊 Trend Indicators
                          <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>— Is the stock going up or down overall?</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                          <IndicatorCard label="Supertrend" value={selInd.st.signal} signal={selInd.st.signal} sub={`ATR ${selInd.st.atr}`} onClick={() => setExplainInd("Supertrend")} plainEnglish={PLAIN_ENGLISH["Supertrend"]} />
                          <IndicatorCard label="MACD" value={`${selInd.macd.hist > 0 ? "+" : ""}${selInd.macd.hist}`} signal={selInd.macd.hist > 0 ? "BUY" : selInd.macd.hist < 0 ? "SELL" : "HOLD"} sub={`Line ${selInd.macd.macd}`} onClick={() => setExplainInd("MACD")} plainEnglish={PLAIN_ENGLISH["MACD"]} />
                          <IndicatorCard label="EMA Cross" value={selInd.ema20 > selInd.ema50 ? "Bullish" : "Bearish"} signal={selInd.ema20 > selInd.ema50 ? "BUY" : "SELL"} sub={`20d ${selInd.ema20} / 50d ${selInd.ema50}`} onClick={() => setExplainInd("EMA Cross")} plainEnglish={PLAIN_ENGLISH["EMA Cross"]} />
                          <IndicatorCard label="Bollinger %B" value={`${selInd.bb.pct}%`} signal={selInd.bb.pct < 20 ? "BUY" : selInd.bb.pct > 80 ? "SELL" : "HOLD"} sub={`MA ₹${selInd.bb.ma}`} onClick={() => setExplainInd("Bollinger %B")} plainEnglish={PLAIN_ENGLISH["Bollinger %B"]} />
                          <IndicatorCard label="Parabolic SAR" value={selInd.sar.signal} signal={selInd.sar.signal} sub={`SAR ₹${selInd.sar.value}`} onClick={() => setExplainInd("Parabolic SAR")} plainEnglish={PLAIN_ENGLISH["Parabolic SAR"]} />
                          <IndicatorCard label="ATR (14)" value={`₹${selInd.atr}`} signal="HOLD" sub="Daily volatility" onClick={() => setExplainInd("ATR")} plainEnglish={PLAIN_ENGLISH["ATR"]} />
                        </div>
                      </div>

                      {/* Momentum */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#374151", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                          ⚡ Momentum Indicators
                          <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>— Is buying/selling pressure speeding up?</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                          <IndicatorCard label="RSI (14)" value={selInd.rsi} signal={selInd.rsi < 30 ? "BUY" : selInd.rsi > 70 ? "SELL" : "HOLD"} sub={selInd.rsi < 30 ? "Oversold" : selInd.rsi > 70 ? "Overbought" : "Neutral"} onClick={() => setExplainInd("RSI")} plainEnglish={PLAIN_ENGLISH["RSI"]} />
                          <IndicatorCard label="Stochastic %K" value={selInd.stoch.k} signal={selInd.stoch.k < 20 ? "BUY" : selInd.stoch.k > 80 ? "SELL" : "HOLD"} sub={`%D ${selInd.stoch.d}`} onClick={() => setExplainInd("Stochastic")} plainEnglish={PLAIN_ENGLISH["Stochastic"]} />
                          <IndicatorCard label="ADX" value={selInd.adx.adx} signal={selInd.adx.adx > 25 ? (selInd.adx.pdi > selInd.adx.ndi ? "BUY" : "SELL") : "HOLD"} sub={`+DI ${selInd.adx.pdi} / -DI ${selInd.adx.ndi}`} onClick={() => setExplainInd("ADX")} plainEnglish={PLAIN_ENGLISH["ADX"]} />
                          <IndicatorCard label="Williams %R" value={selInd.wr.r} signal={selInd.wr.signal} sub={selInd.wr.r < -80 ? "Oversold" : selInd.wr.r > -20 ? "Overbought" : "Neutral"} onClick={() => setExplainInd("Williams %R")} plainEnglish={PLAIN_ENGLISH["Williams %R"]} />
                          <IndicatorCard label="CCI (20)" value={selInd.cci.cci} signal={selInd.cci.signal} sub={selInd.cci.cci < -100 ? "Oversold" : selInd.cci.cci > 100 ? "Overbought" : "Neutral"} onClick={() => setExplainInd("CCI")} plainEnglish={PLAIN_ENGLISH["CCI"]} />
                        </div>
                      </div>

                      {/* Volume */}
                      <div style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#374151", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                          📦 Volume Indicators
                          <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>— Are big players buying or quietly selling?</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                          <IndicatorCard label="OBV Trend" value={selInd.obv.trend} signal={selInd.obv.trend === "Rising" ? "BUY" : "SELL"} sub="On-Balance Volume" onClick={() => setExplainInd("OBV")} plainEnglish={PLAIN_ENGLISH["OBV"]} />
                          <IndicatorCard label="VWAP" value={selStock.currentPrice > selInd.vwap ? "Above VWAP" : "Below VWAP"} signal={selStock.currentPrice > selInd.vwap ? "BUY" : "SELL"} sub={`VWAP ₹${selInd.vwap}`} onClick={() => setExplainInd("VWAP")} plainEnglish={PLAIN_ENGLISH["VWAP"]} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {selStock.thesis && (
                    <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px" }}>
                      <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Your Investment Thesis</div>
                      <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7 }}>{selStock.thesis}</div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <AIChatPanel aiMsgs={aiMsgs} aiLoading={aiLoading} aiInput={aiInput} setAiInput={setAiInput} sendAI={sendAI} selStock={selStock} chatEndRef={chatEndRef} aiState={aiState} setAiState={setAiState} />

      {/* Add Stock Modal */}
      {showAdd && (
        <div style={C.modal} onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: 480, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Add Stock</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 20 }}>We'll fetch real data from Yahoo Finance automatically 🔄</div>
            <div style={{ marginBottom: 14, position: "relative" }}>
              <label style={C.label}>NSE Stock Symbol</label>
              <input style={C.input} value={searchQ} onChange={e => { setSearchQ(e.target.value); setForm(f => ({ ...f, symbol: e.target.value })); }} placeholder="Type e.g. ZOMATO, TATASTEEL, RELIANCE…" />
              {suggestions.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", zIndex: 10, marginTop: 4, overflow: "hidden" }}>
                  {suggestions.map(sym => (
                    <div key={sym} onClick={() => { setForm(f => ({ ...f, symbol: sym })); setSearchQ(sym); }}
                      style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'DM Mono',monospace", borderBottom: "1px solid #f9fafb" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f0f7ff"}
                      onMouseLeave={e => e.currentTarget.style.background = "#fff"}>{sym}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div><label style={C.label}>Buy Price (₹)</label><input type="number" style={C.input} value={form.buyPrice} onChange={e => setForm(f => ({ ...f, buyPrice: e.target.value }))} placeholder="e.g. 1420" /></div>
              <div><label style={C.label}>Quantity</label><input type="number" style={C.input} value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} placeholder="e.g. 10" /></div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={C.label}>Why are you buying this? (optional)</label>
              <textarea style={{ ...C.input, minHeight: 70, resize: "vertical" }} value={form.thesis} onChange={e => setForm(f => ({ ...f, thesis: e.target.value }))} placeholder="e.g. 'I think Zomato will grow because food delivery is booming'" />
            </div>
            {addError && <div style={{ color: "#dc2626", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>⚠ {addError}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button style={{ flex: 1, background: "#111827", color: "#fff", border: "none", borderRadius: 10, padding: "13px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }} onClick={addStock}>Add to Portfolio →</button>
              <button onClick={() => { setShowAdd(false); setAddError(""); }} style={{ flex: 1, background: "#f3f4f6", border: "none", color: "#374151", borderRadius: 10, padding: "13px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <ExplainModal indicator={explainInd} onClose={() => setExplainInd(null)} onAskAI={(msg) => { setAiInput(msg); setAiState("open"); setExplainInd(null); }} />
    </div>
  );
}
