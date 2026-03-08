// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TRACKMAP_DIR = "trackmaps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

/* -------------------- time helpers -------------------- */

function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function shortDateInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleDateString(LOCALE, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

function shortTimeInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleTimeString(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function shortDateTimeInTZ(dateObj, timeZone = USER_TZ) {
  return `${shortDateInTZ(dateObj, timeZone)} ${shortTimeInTZ(dateObj, timeZone)}`;
}

/* -------------------- fs helpers -------------------- */

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

/* -------------------- network helpers -------------------- */

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*,*/*" },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/* -------------------- generic helpers -------------------- */

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function titleCaseWords(s) {
  if (!s) return null;
  return String(s)
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function titleCaseFromSlug(slug) {
  if (!slug) return null;
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function stripFormula1Prefix(name) {
  if (!name) return name;
  return name
    .replace(/^formula 1\s+/i, "F1 ")
    .replace(/^formule 1\s+/i, "F1 ")
    .trim();
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/* -------------------- ICS parsing -------------------- */

function getSessionType(summary) {
  const s = String(summary || "").toLowerCase().trim();

  if (/\b(practice\s*1|fp1)\b/.test(s)) return "FP1";
  if (/\b(practice\s*2|fp2)\b/.test(s)) return "FP2";
  if (/\b(practice\s*3|fp3)\b/.test(s)) return "FP3";

  // Must come before plain sprint
  if (
    /\b(sprint\s+qualifying|sprint\s+shootout|sq)\b/.test(s) ||
    (/\bsprint\b/.test(s) && /\b(qualifying|shootout)\b/.test(s))
  ) {
    return "Sprint Qualifying";
  }

  // Regular qualifying only
  if (/\bqualifying\b/.test(s) && !/\bsprint\b/.test(s)) {
    return "Qualifying";
  }

  // Plain sprint race
  if (/\bsprint\b/.test(s)) {
    return "Sprint";
  }

  // Race / Grand Prix only
  if (
    /\b(race|grand prix)\b/.test(s) &&
    !/\bqualifying\b/.test(s) &&
    !/\bsprint\b/.test(s)
  ) {
    return "Race";
  }

  return null;
}

function getGpName(summary) {
  const parts = String(summary || "").split(" - ");
  return (parts[0] || summary || "").trim();
}

/* -------------------- official race page resolution -------------------- */

function isBadSlug(slug) {
  return !slug || slug.startsWith("pre-season-testing");
}

function scoreSlug(slug, gpName, locationRaw) {
  const sTokens = tokens(slug);
  const gpTokens = new Set(tokens(gpName));
  const locTokens = new Set(tokens(locationRaw));

  let score = 0;

  for (const t of sTokens) {
    if (locTokens.has(t)) score += 20;
    if (gpTokens.has(t)) score += 6;
  }

  const gpNorm = normalize(gpName);
  if (slug === "australia" && gpNorm.includes("australian")) score += 30;
  if (slug === "great-britain" && gpNorm.includes("british")) score += 30;
  if (slug === "sao-paulo" && gpNorm.includes("brazil")) score += 25;
  if (slug === "china" && gpNorm.includes("chinese")) score += 30;
  if (slug === "japan" && gpNorm.includes("japanese")) score += 30;
  if (slug === "saudi-arabia" && gpNorm.includes("saudi")) score += 30;
  if (slug === "abu-dhabi" && gpNorm.includes("abu")) score += 30;

  return score;
}

async function resolveRacePage({ season, gpName, locationRaw }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const matches = Array.from(
    html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g"))
  ).map((m) => m[0]);

  const slugs = [...new Set(matches)]
    .map((href) => href.split(`/en/racing/${season}/`)[1])
    .filter((slug) => slug && !isBadSlug(slug));

  if (slugs.length === 0) {
    throw new Error("No race slugs found on season page.");
  }

  const ranked = slugs
    .map((slug) => ({
      slug,
      score: scoreSlug(slug, gpName, locationRaw),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) {
    throw new Error("Could not resolve official race page slug.");
  }

  return {
    slug: best.slug,
    pageUrl: `https://www.formula1.com/en/racing/${season}/${best.slug}`,
    rankedTop: ranked.slice(0, 8),
  };
}

/* -------------------- official race metadata -------------------- */

function countryFromSlug(slug) {
  const map = {
    australia: "Australia",
    china: "China",
    japan: "Japan",
    bahrain: "Bahrain",
    "saudi-arabia": "Saudi Arabia",
    miami: "United States",
    monaco: "Monaco",
    spain: "Spain",
    canada: "Canada",
    austria: "Austria",
    "great-britain": "United Kingdom",
    belgium: "Belgium",
    hungary: "Hungary",
    netherlands: "Netherlands",
    italy: "Italy",
    azerbaijan: "Azerbaijan",
    singapore: "Singapore",
    "united-states": "United States",
    mexico: "Mexico",
    "sao-pa