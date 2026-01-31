// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import { Resvg } from "@resvg/resvg-js";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Widgy-friendly local strings
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Your GitHub Pages base URL
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Track map source repo
const CIRCUIT_REPO_OWNER = "julesr0y";
const CIRCUIT_REPO_NAME = "f1-circuits-svg";
const CIRCUIT_REPO_REF = "main";

// Prefer black outline
const TRACK_STYLES = ["black-outline", "black", "white-outline", "white"];

// Output folder for PNGs (committed)
const TRACKMAP_DIR = "trackmaps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Optional: emergency overrides for track SVG filename
// Example: { match: "monaco", file: "monaco-1.svg", style: "black-outline" }
const FILE_OVERRIDES = [
  // { match: "monaco", file: "monaco-1.svg", style: "black-outline" },
];

// Optional: emergency overrides for flag ISO2 if you ever need it
// Example: { match: "abu dhabi", iso2: "AE" }
const FLAG_OVERRIDES = [
  // { match: "abu dhabi", iso2: "AE" },
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

// More robust than before: last comma-separated token is treated as country
function splitLocation(location) {
  if (!location || typeof location !== "string") return { city: null, country: null };

  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: parts[0] || null, country: null };

  const country = parts[parts.length - 1] || null;
  const city = parts[0] || null;

  return { city, country };
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
function githubHeaders() {
  const headers = {
    "User-Agent": UA,
    "Accept": "application/vnd.github+json",
  };
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

// ---------- Flag helpers ----------
function inferCountryFromGpName(gpName) {
  const s = (gpName || "").toLowerCase();

  const rules = [
    ["bahrain", "Bahrain"],
    ["saudi", "Saudi Arabia"],
    ["australian", "Australia"],
    ["japanese", "Japan"],
    ["chinese", "China"],
    ["miami", "United States"],
    ["las vegas", "United States"],
    ["united states", "United States"],
    ["canadian", "Canada"],
    ["mexico", "Mexico"],
    ["mexican", "Mexico"],
    ["brazil", "Brazil"],
    ["brazilian", "Brazil"],
    ["british", "United Kingdom"],
    ["hungarian", "Hungary"],
    ["belgian", "Belgium"],
    ["dutch", "Netherlands"],
    ["italian", "Italy"],
    ["monaco", "Monaco"],
    ["spanish", "Spain"],
    ["french", "France"],
    ["austrian", "Austria"],
    ["azerbaijan", "Azerbaijan"],
    ["singapore", "Singapore"],
    ["qatar", "Qatar"],
    ["abu dhabi", "United Arab Emirates"],
    ["emilia romagna", "Italy"],
  ];

  for (const [key, country] of rules) {
    if (s.includes(key)) return country;
  }
  return null;
}

const ISO_FALLBACK = {
  "united kingdom": "GB",
  "uk": "GB",
  "great britain": "GB",
  "england": "GB",
  "scotland": "GB",
  "wales": "GB",
  "united states": "US",
  "usa": "US",
  "u.s.a.": "US",
  "united arab emirates": "AE",
  "uae": "AE",
  "south korea": "KR",
  "korea": "KR",
  "czechia": "CZ",
};

function iso2ToFlagUrls(iso2Upper) {
  const iso2 = iso2Upper.toLowerCase();
  return {
    pngUrl: `https://flagcdn.com/w80/${iso2}.png`,
    svgUrl: `https://flagcdn.com/${iso2}.svg`,
  };
}

async function getCountryCodeAndFlag(countryName, gpName) {
  // 0) manual override by gpName keyword
  const gpLower = (gpName || "").toLowerCase();
  const override = FLAG_OVERRIDES.find((o) => gpLower.includes(o.match));
  if (override?.iso2 && /^[A-Z]{2}$/.test(override.iso2)) {
    const urls = iso2ToFlagUrls(override.iso2);
    return {
      found: true,
      country: countryName || inferCountryFromGpName(gpName) || null,
      countryCode: override.iso2,
      ...urls,
      source: "override + flagcdn.com",
      note: null,
    };
  }

  // 1) If missing, infer
  let country = countryName || inferCountryFromGpName(gpName);

  if (!country) {
    return {
      found: false,
      country: null,
      countryCode: null,
      pngUrl: null,
      svgUrl: null,
      source: null,
      note: "No country found from location, and could not infer from gpName.",
    };
  }

  const norm = country.trim();
  const normKey = norm.toLowerCase();

  // 2) fallback iso mapping
  if (ISO_FALLBACK[normKey]) {
    const iso2Upper = ISO_FALLBACK[normKey];
    const urls = iso2ToFlagUrls(iso2Upper);
    return {
      found: true,
      country: norm,
      countryCode: iso2Upper,
      ...urls,
      source: "fallback-map + flagcdn.com",
      note: null,
    };
  }

  // 3) REST Countries lookup for ISO2
  const base = "https://restcountries.com/v3.1/name/";
  const q = encodeURIComponent(norm);

  const tryUrls = [
    `${base}${q}?fullText=true&fields=name,cca2`,
    `${base}${q}?fields=name,cca2`,
  ];

  for (const url of tryUrls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;

      const data = await res.json();
      const first = Array.isArray(data) ? data[0] : null;
      const cca2 = first?.cca2 ? String(first.cca2).toUpperCase() : null;
      if (!cca2 || !/^[A-Z]{2}$/.test(cca2)) continue;

      const urls = iso2ToFlagUrls(cca2);
      return {
        found: true,
        country: norm,
        countryCode: cca2,
        ...urls,
        source: "restcountries.com + flagcdn.com",
        note: null,
      };
    } catch {
      // try next
    }
  }

  return {
    found: false,
    country: norm,
    countryCode: null,
    pngUrl: null,
    svgUrl: null,
    source: "restcountries.com",
    note: "REST Countries lookup failed and no fallback ISO mapping matched.",
  };
}

// ---------- Track map helpers ----------
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
  for (const t of cityTokens) if (base.includes(t)) score += 8;
  for (const t of gpTokens) if (base.includes(t)) score += 4;
  for (const t of countryTokens) if (base.includes(t)) score += 2;

  return score;
}

function githubContentsUrl(style) {
  return `https://api.github.com/repos/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}/contents/circuits/${style}?ref=${CIRCUIT_REPO_REF}`;
}

function githubRawUrl(style, file) {
  return `https://raw.githubusercontent.com/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}/${CIRCUIT_REPO_REF}/circuits/${style}/${file}`;
}

function makeTrackPngUrl(layoutId) {
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

async function findBestTrackSvgFile({ gpName, city, country }) {
  // manual override if needed
  const gpLower = (gpName || "").toLowerCase();
  const override = FILE_OVERRIDES.find((o) => gpLower.includes(o.match));
  if (override?.file && override?.style) {
    return { found: true, style: override.style, file: override.file, source: "override" };
  }

  const ctx = { gpName, city, country };
  let best = { score: -1, style: null, file: null };
  const topCandidatesByStyle = {};

  for (const style of TRACK_STYLES) {
    let svgs = [];
    try {
      svgs = await listSvgFiles(style);
    } catch (e) {
      topCandidatesByStyle[style] = { error: e?.message || String(e) };
      continue;
    }

    const scored = svgs
      .map((file) => ({ file, score: scoreFilename(file, ctx) }))
      .sort((a, b) => b.score - a.score);

    topCandidatesByStyle[style] = scored.slice(0, 8);

    const top = scored[0];
    if (top && top.score > best.score) {
      best = { score: top.score, style, file: top.file };
    }

    if (top?.score >= 10) break;
  }

  if (!best.file || !best.style) {
    return {
      found: false,
      note: "No SVG files could be listed from any style folder.",
      debug: { topCandidatesByStyle },
    };
  }

  return {
    found: true,
    style: best.style,
    file: best.file,
    score: best.score,
    source: "filename-match",
    debug: { topCandidatesByStyle },
  };
}

async function renderTrackMapPng({ gpName, city, country }) {
  const match = await findBestTrackSvgFile({ gpName, city, country });

  if (!match.found) {
    return {
      found: false,
      source: "github-contents",
      note: match.note || "No match",
      svgUrl: null,
      pngUrl: null,
      debug: match.debug || null,
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
    pngUrl: makeTrackPngUrl(layoutId),
    score: match.score ?? null,
    note: match.score != null && match.score < 8 ? "Low-confidence match; add FILE_OVERRIDES if wrong." : null,
    debug: match.debug || null,
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

  // Track map (PNG)
  const trackMap = await renderTrackMapPng({ gpName, city, country });

  // Flag (PNG/SVG)
  const flag = await getCountryCodeAndFlag(country, gpName);

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
      country: flag?.found ? flag.country : country, // prefer inferred/normalized
      location: nextRace.location,
    },

    flag, // Widgy Image -> flag.pngUrl
    trackMap, // Widgy Image -> trackMap.pngUrl

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
      "Use flag.pngUrl for the country flag (PNG) and trackMap.pngUrl for the circuit map (PNG). Track map prefers black-outline style. If flag.found is false, add an entry in FLAG_OVERRIDES or expand inferCountryFromGpName().",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});