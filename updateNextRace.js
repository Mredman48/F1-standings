// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import { Resvg } from "@resvg/resvg-js";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Widgy-friendly local strings
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Your GitHub Pages base URL (used for PNG URL in JSON)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Track map source
const CIRCUIT_REPO_OWNER = "julesr0y";
const CIRCUIT_REPO_NAME = "f1-circuits-svg";
const CIRCUIT_REPO_REF = "main";

// Try these styles in order (folder names in the repo)
const TRACK_STYLES = ["white-outline", "white", "black-outline", "black"];

// Output folder in your repo (committed)
const TRACKMAP_DIR = "trackmaps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Optional: emergency overrides if you ever need them.
// You can leave empty.
// Example: { match: "monaco", file: "monaco-1.svg", style: "white-outline" }
const FILE_OVERRIDES = [
  // { match: "monaco", file: "monaco-1.svg", style: "white-outline" },
];

// ---------- Date/time helpers ----------
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

// 24-hour time
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

function splitLocation(location) {
  if (!location || typeof location !== "string") return { city: null, country: null };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  return { city: parts[0] || null, country: parts[1] || null };
}

// ---------- Calendar parsing helpers ----------
function getSessionType(summary) {
  const s = (summary || "").toLowerCase();
  if (s.includes("practice 1") || s.includes("fp1")) return "FP1";
  if (s.includes("practice 2") || s.includes("fp2")) return "FP2";
  if (s.includes("practice 3") || s.includes("fp3")) return "FP3";
  if (s.includes("sprint qualifying")) return "Sprint Qualifying";
  if (s.includes("sprint")) return "Sprint";
  if (s.includes("qualifying") || s.includes("quali")) return "Qualifying";
  if (s.includes("race")) return "Race";
  return null;
}

function getGpName(summary) {
  const parts = (summary || "").split(" - ");
  return (parts[0] || summary || "").trim();
}

// ---------- Network helpers ----------
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 200)}`);
  }
  return res.text();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

// ---------- Matching helpers ----------
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeForMatch(s) {
  return normalize(s)
    .replace(/\bgrand prix\b/g, "")
    .replace(/\bgp\b/g, "")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

function scoreFilename(filename, ctx) {
  const base = normalize(filename.replace(/\.svg$/i, ""));
  const gpTokens = tokenizeForMatch(ctx.gpName);
  const cityTokens = tokenizeForMatch(ctx.city);
  const countryTokens = tokenizeForMatch(ctx.country);

  let score = 0;

  // City tokens are strongest
  for (const t of cityTokens) if (base.includes(t)) score += 8;

  // GP tokens next
  for (const t of gpTokens) if (base.includes(t)) score += 4;

  // Country tokens help break ties
  for (const t of countryTokens) if (base.includes(t)) score += 2;

  // Slight bias for simpler IDs (often better)
  if (/^\w+-\d+$/.test(base.replace(/\s+/g, ""))) score += 1;

  return score;
}

function githubContentsUrl(style) {
  return `https://api.github.com/repos/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}/contents/circuits/${style}?ref=${CIRCUIT_REPO_REF}`;
}

function githubRawUrl(style, file) {
  // raw github is stable for file fetch
  return `https://raw.githubusercontent.com/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}/${CIRCUIT_REPO_REF}/circuits/${style}/${file}`;
}

function makePngUrl(layoutId) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(layoutId)}.png`;
}

// Render SVG string to PNG buffer
function renderSvgToPng(svgString, widthPx = 900) {
  const resvg = new Resvg(svgString, { fitTo: { mode: "width", value: widthPx } });
  return resvg.render().asPng();
}

// Core: find a track SVG by listing filenames in style folders
async function findBestTrackSvgFile({ gpName, city, country }) {
  // 0) manual override (if you ever need it)
  const gpLower = (gpName || "").toLowerCase();
  const override = FILE_OVERRIDES.find((o) => gpLower.includes(o.match));
  if (override?.file && override?.style) {
    return { found: true, style: override.style, file: override.file, source: "override" };
  }

  const ctx = { gpName, city, country };

  // Try styles in order; pick best scoring within first style that yields a good score,
  // otherwise keep best global.
  let best = { score: -1, style: null, file: null };

  for (const style of TRACK_STYLES) {
    const listUrl = githubContentsUrl(style);
    const items = await fetchJson(listUrl);

    const svgs = (items || [])
      .filter((x) => x?.type === "file" && typeof x?.name === "string" && x.name.toLowerCase().endsWith(".svg"))
      .map((x) => x.name);

    if (!svgs.length) continue;

    // Score all filenames
    const scored = svgs
      .map((file) => ({ file, score: scoreFilename(file, ctx) }))
      .sort((a, b) => b.score - a.score);

    // Log top candidates to actions output (super useful)
    console.log(
      `Track candidates (${style}) top5:`,
      scored.slice(0, 5).map((x) => ({ file: x.file, score: x.score }))
    );

    const top = scored[0];
    if (top && top.score > best.score) {
      best = { score: top.score, style, file: top.file };
    }

    // If we get a strong match, stop early
    if (top?.score >= 10) break;
  }

  if (!best.file || !best.style || best.score < 4) {
    return {
      found: false,
      note: `No confident SVG filename match found. bestScore=${best.score}`,
      bestGuess: best.file ? { style: best.style, file: best.file, score: best.score } : null,
    };
  }

  return { found: true, style: best.style, file: best.file, score: best.score, source: "filename-match" };
}

async function renderTrackMapPng({ gpName, city, country }) {
  const match = await findBestTrackSvgFile({ gpName, city, country });

  if (!match.found) {
    return {
      found: false,
      source: "github-contents",
      note: match.note || "No match",
      bestGuess: match.bestGuess || null,
      svgUrl: null,
      pngUrl: null,
    };
  }

  const svgUrl = githubRawUrl(match.style, match.file);
  const svgText = await fetchText(svgUrl);

  await ensureDir(TRACKMAP_DIR);

  const layoutId = match.file.replace(/\.svg$/i, "");
  const pngPath = path.join(TRACKMAP_DIR, `${layoutId}.png`);
  const pngBuffer = renderSvgToPng(svgText, 900);

  await fs.writeFile(pngPath, pngBuffer);

  return {
    found: true,
    source: "github-contents",
    matchSource: match.source,
    style: match.style,
    file: match.file,
    svgUrl,
    pngUrl: makePngUrl(layoutId),
    note: null,
  };
}

// ---------- Main ----------
async function updateNextRace() {
  const now = new Date();

  const data = await ical.async.fromURL(ICS_URL, {
    headers: { "User-Agent": UA },
  });

  const events = Object.values(data).filter((x) => x?.type === "VEVENT");

  const sessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);
      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      return {
        uid: ev.uid,
        summary,
        gpName: getGpName(summary),
        sessionType,
        start,
        end,
        location: ev.location || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const nextRace = sessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRace) throw new Error("Could not find upcoming Race session in calendar feed.");

  const gpName = nextRace.gpName;
  const gpSessions = sessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);

  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  const { city, country } = splitLocation(nextRace.location);

  console.log("GP DEBUG:", {
    gpName,
    location: nextRace.location,
    city,
    country,
  });

  // Track map render
  const trackMap = await renderTrackMapPng({ gpName, city, country });
  console.log("TRACKMAP DEBUG:", trackMap);

  const sessionOrder = ["FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"];
  const sessionsOut = sessionOrder
    .map((type) => {
      const s = gpSessions.find((x) => x.sessionType === type);
      if (!s) return null;
      return {
        type,
        startUtc: s.start.toISOString(),
        endUtc: s.end.toISOString(),
        startLocalDateShort: shortDateInTZ(s.start),
        startLocalTimeShort: shortTimeInTZ(s.start),
        startLocalDateTimeShort: shortDateTimeInTZ(s.start),
      };
    })
    .filter(Boolean);

  const out = {
    header: "Next F1 race weekend",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },

    grandPrix: {
      name: gpName,
      city,
      country,
      location: nextRace.location,
    },

    trackMap, // bind Widgy image to trackMap.pngUrl

    countdowns: {
      weekendStartsInDays: daysUntil(weekendStart, now),
      raceStartsInDays: daysUntil(nextRace.start, now),
    },

    weekend: {
      startUtc: weekendStart.toISOString(),
      endUtc: weekendEnd.toISOString(),
      startLocalDateShort: shortDateInTZ(weekendStart),
      startLocalTimeShort: shortTimeInTZ(weekendStart),
    },

    race: {
      startUtc: nextRace.start.toISOString(),
      endUtc: nextRace.end.toISOString(),
      startLocalDateShort: shortDateInTZ(nextRace.start),
      startLocalTimeShort: shortTimeInTZ(nextRace.start),
    },

    sessions: sessionsOut,

    notes:
      "Track map PNG is generated and committed under /trackmaps for Widgy. Bind Widgy image to trackMap.pngUrl. If not found, check TRACKMAP DEBUG bestGuess in Actions logs.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});