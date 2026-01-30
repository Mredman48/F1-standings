// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import { Resvg } from "@resvg/resvg-js";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Your GitHub Pages base URL
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Track SVG repo
const CIRCUIT_REPO_OWNER = "julesr0y";
const CIRCUIT_REPO_NAME = "f1-circuits-svg";
const CIRCUIT_REPO_REF = "main";

// Try styles in order
const TRACK_STYLES = ["white-outline", "white", "black-outline", "black"];

// Output folder (committed)
const TRACKMAP_DIR = "trackmaps";

// OPTIONAL: if auto-pick is wrong for one GP, set it here once and forget it.
// match = substring of gpName lowercased.
const FILE_OVERRIDES = [
  // { match: "bahrain", style: "white-outline", file: "bahrain-3.svg" },
  // { match: "monaco", style: "white-outline", file: "monaco-1.svg" },
];

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ---------- Time helpers ----------
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

function splitLocation(location) {
  if (!location || typeof location !== "string") return { city: null, country: null };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  return { city: parts[0] || null, country: parts[1] || null };
}

// ---------- Calendar helpers ----------
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
function githubHeaders() {
  const headers = {
    "User-Agent": UA,
    "Accept": "application/vnd.github+json",
  };

  // IMPORTANT: authenticate in Actions to avoid rate limits
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { ...githubHeaders(), ...headers },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 300)}`);
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

function tokenize(s) {
  return normalize(s)
    .replace(/\bgrand prix\b/g, "")
    .replace(/\bgp\b/g, "")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

function scoreFilename(filename, { gpName, city, country }) {
  const base = normalize(filename.replace(/\.svg$/i, ""));
  const gpTokens = tokenize(gpName);
  const cityTokens = tokenize(city);
  const countryTokens = tokenize(country);

  let score = 0;

  // City strongest if present
  for (const t of cityTokens) if (base.includes(t)) score += 8;

  // GP name tokens
  for (const t of gpTokens) if (base.includes(t)) score += 4;

  // Country tokens
  for (const t of countryTokens) if (base.includes(t)) score += 2;

  return score;
}

function githubContentsUrl(style) {
  return `https://api.github.com/repos/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}/contents/circuits/${style}?ref=${CIRCUIT_REPO_REF}`;
}

function githubRawUrl(style, file) {
  return `https://raw.githubusercontent.com/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}/${CIRCUIT_REPO_REF}/circuits/${style}/${file}`;
}

function pngUrlFor(layoutId) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(layoutId)}.png`;
}

function renderSvgToPng(svgString, widthPx = 900) {
  const resvg = new Resvg(svgString, { fitTo: { mode: "width", value: widthPx } });
  return resvg.render().asPng();
}

async function listSvgFiles(style) {
  const url = githubContentsUrl(style);
  const items = await fetchJson(url);
  return (items || [])
    .filter((x) => x?.type === "file" && typeof x?.name === "string" && x.name.toLowerCase().endsWith(".svg"))
    .map((x) => x.name);
}

async function pickBestSvg({ gpName, city, country }) {
  const ctx = { gpName, city, country };
  const gpLower = (gpName || "").toLowerCase();

  // 0) override
  const ov = FILE_OVERRIDES.find((o) => gpLower.includes(o.match));
  if (ov?.style && ov?.file) {
    return {
      picked: { style: ov.style, file: ov.file, score: 999, source: "override" },
      debug: { ctx, triedStyles: TRACK_STYLES, topCandidatesByStyle: {} },
    };
  }

  const topCandidatesByStyle = {};
  let best = null;

  for (const style of TRACK_STYLES) {
    let files;
    try {
      files = await listSvgFiles(style);
    } catch (e) {
      topCandidatesByStyle[style] = { error: e.message };
      continue;
    }

    const scored = files
      .map((file) => ({ file, score: scoreFilename(file, ctx) }))
      .sort((a, b) => b.score - a.score);

    topCandidatesByStyle[style] = scored.slice(0, 8);

    // Keep global best
    const top = scored[0];
    if (top && (!best || top.score > best.score)) {
      best = { style, file: top.file, score: top.score, source: "filename-match" };
    }

    // If we got a strong match, stop early
    if (top?.score >= 12) break;
  }

  return {
    picked: best, // may be low score; we will still use it
    debug: { ctx, triedStyles: TRACK_STYLES, topCandidatesByStyle },
  };
}

async function renderTrackPng({ gpName, city, country }) {
  const { picked, debug } = await pickBestSvg({ gpName, city, country });

  if (!picked?.style || !picked?.file) {
    return {
      found: false,
      note: "Could not list any SVG files from the repo styles (API blocked or empty).",
      pngUrl: null,
      svgUrl: null,
      picked: null,
      debug,
    };
  }

  // Fetch svg & render
  const svgUrl = githubRawUrl(picked.style, picked.file);
  const svgText = await fetchText(svgUrl);

  await ensureDir(TRACKMAP_DIR);

  const layoutId = picked.file.replace(/\.svg$/i, "");
  const pngPath = path.join(TRACKMAP_DIR, `${layoutId}.png`);

  const png = renderSvgToPng(svgText, 900);
  await fs.writeFile(pngPath, png);

  return {
    found: true,
    note: picked.score < 8 ? "Low-confidence match; if wrong, add FILE_OVERRIDES for this GP." : null,
    picked,
    svgUrl,
    pngUrl: pngUrlFor(layoutId),
    debug,
  };
}

// ---------- Main ----------
async function updateNextRace() {
  const now = new Date();

  const data = await ical.async.fromURL(ICS_URL, { headers: { "User-Agent": UA } });
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

  // Track map (PNG)
  const trackMap = await renderTrackPng({ gpName, city, country });

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

    trackMap, // Widgy binds to trackMap.pngUrl

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
      "Track map is rendered to PNG and committed under /trackmaps. If the match is wrong, set FILE_OVERRIDES using trackMap.debug.topCandidatesByStyle to choose the right SVG filename.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});