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

// Circuit SVG source (MIT): julesr0y/f1-circuits-svg
const CIRCUIT_REPO_OWNER = "julesr0y";
const CIRCUIT_REPO_NAME = "f1-circuits-svg";
const CIRCUIT_REPO_REF = "main";

// Try multiple styles until we find an SVG that exists
const TRACK_STYLES = ["white-outline", "white", "black-outline", "black"];

// Where rendered PNGs go in your repo
const TRACKMAP_DIR = "trackmaps";

// Optional: bulletproof overrides (leave empty if you want auto-only)
// Add entries ONLY if a specific GP won't match reliably.
const GP_LAYOUT_OVERRIDES = [
  // { match: "monaco", layoutId: "monaco-1" },
  // { match: "italian", layoutId: "monza-1" },
];

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

function jsDelivrUrl(repoPath) {
  return `https://cdn.jsdelivr.net/gh/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}@${CIRCUIT_REPO_REF}/${repoPath}`;
}

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

// 24-hour time like "18:30"
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

// ---- Calendar parsing helpers ----
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

// ---- Networking helpers ----
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

async function urlExists(url) {
  const res = await fetch(url, {
    method: "HEAD",
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  return res.ok;
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractCircuits(obj) {
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj?.circuits)) return obj.circuits;
  if (Array.isArray(obj?.data)) return obj.data;
  return [];
}

function parseSeasons(seasonStr) {
  if (!seasonStr || typeof seasonStr !== "string") return [];
  const out = new Set();
  for (const part of seasonStr.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => parseInt(x.trim(), 10));
      if (Number.isFinite(a) && Number.isFinite(b)) for (let y = a; y <= b; y++) out.add(y);
    } else {
      const y = parseInt(part, 10);
      if (Number.isFinite(y)) out.add(y);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function pickLayoutForYear(layouts, year) {
  if (!Array.isArray(layouts) || layouts.length === 0) return null;

  // Prefer exact year match if seasons are provided
  for (const lay of layouts) {
    const seasons = parseSeasons(lay?.seasons || lay?.season || "");
    if (seasons.includes(year)) return lay;
  }

  // Otherwise pick the last layout (often most current)
  return layouts[layouts.length - 1];
}

// Strong scoring that still works if city/country are missing
function scoreCircuit(c, { gpName, city, country }) {
  const gpN = normalize(gpName);
  const cityN = normalize(city);
  const countryN = normalize(country);

  const nameN = normalize(c?.name || "");
  const cityCN = normalize(c?.city || c?.location || "");
  const countryCN = normalize(c?.country || "");

  let score = 0;

  // Strong if we have city/country
  if (cityN && (cityCN === cityN || nameN.includes(cityN))) score += 10;
  if (countryN && (countryCN === countryN || nameN.includes(countryN))) score += 5;

  // GP name token overlap ALWAYS counts
  if (gpN) {
    const tokens = gpN
      .replace(/\bgrand prix\b/g, "")
      .replace(/\bgp\b/g, "")
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t.length > 2);

    for (const t of tokens) {
      if (nameN.includes(t)) score += 3;
      if (cityCN.includes(t)) score += 2;
      if (countryCN.includes(t)) score += 1;
    }
  }

  return score;
}

function bestCircuitMatch(circuits, ctx) {
  const scored = circuits
    .map((c) => ({ c, score: scoreCircuit(c, ctx) }))
    .sort((a, b) => b.score - a.score);

  // Helpful debug in Actions logs
  console.log(
    "Circuit match top5:",
    scored.slice(0, 5).map((x) => ({
      score: x.score,
      name: x.c?.name,
      city: x.c?.city,
      country: x.c?.country,
    }))
  );

  return scored[0]?.c || null;
}

function renderSvgToPng(svgString, widthPx = 900) {
  const resvg = new Resvg(svgString, { fitTo: { mode: "width", value: widthPx } });
  return resvg.render().asPng();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function getTrackMapPng({ gpName, city, country, year }) {
  // 0) Manual override (guaranteed)
  const gpLower = (gpName || "").toLowerCase();
  const override = GP_LAYOUT_OVERRIDES.find((o) => gpLower.includes(o.match));
  if (override?.layoutId) {
    const layoutId = override.layoutId;
    for (const style of TRACK_STYLES) {
      const svgUrl = jsDelivrUrl(`circuits/${style}/${layoutId}.svg`);
      if (await urlExists(svgUrl)) {
        const svgText = await fetchText(svgUrl);
        await ensureDir(TRACKMAP_DIR);
        const pngBuffer = renderSvgToPng(svgText, 900);
        const pngFilename = `${layoutId}.png`;
        await fs.writeFile(path.join(TRACKMAP_DIR, pngFilename), pngBuffer);
        return {
          found: true,
          source: "override",
          style,
          circuitName: null,
          layout: { id: layoutId, seasons: null },
          svgUrl,
          pngUrl: `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(pngFilename)}`,
          note: null,
        };
      }
    }
    return {
      found: false,
      source: "override",
      note: `Override layoutId '${layoutId}' set, but no SVG exists in repo for any style.`,
      pngUrl: null,
      svgUrl: null,
    };
  }

  // 1) Auto match from circuits.json
  const circuitsJsonUrl = jsDelivrUrl("circuits.json");
  const circuitsObj = await fetchJson(circuitsJsonUrl);
  const circuits = extractCircuits(circuitsObj);

  const circuit = bestCircuitMatch(circuits, { gpName, city, country });
  if (!circuit) {
    return {
      found: false,
      source: "repo",
      circuitsJsonUrl,
      note: "Could not match any circuit entry.",
      pngUrl: null,
      svgUrl: null,
    };
  }

  const layout =
    pickLayoutForYear(circuit.layouts, year) ||
    pickLayoutForYear(circuit?.layoutsList, year) ||
    null;

  const layoutId = layout?.id || layout?.layout_id || layout?.name || null;
  if (!layoutId) {
    return {
      found: false,
      source: "repo",
      circuitsJsonUrl,
      circuitName: circuit?.name ?? null,
      note: "Matched circuit but could not determine layout id.",
      pngUrl: null,
      svgUrl: null,
    };
  }

  // 2) Validate an SVG exists by trying styles
  let chosenStyle = null;
  let svgUrl = null;

  for (const style of TRACK_STYLES) {
    const candidate = jsDelivrUrl(`circuits/${style}/${layoutId}.svg`);
    if (await urlExists(candidate)) {
      chosenStyle = style;
      svgUrl = candidate;
      break;
    }
  }

  if (!svgUrl) {
    return {
      found: false,
      source: "repo",
      circuitsJsonUrl,
      circuitName: circuit?.name ?? null,
      layout: { id: layoutId, seasons: layout?.seasons ?? null },
      note: "Layout id found, but no SVG exists for any style in the repo.",
      pngUrl: null,
      svgUrl: null,
    };
  }

  // 3) Render and write PNG
  const svgText = await fetchText(svgUrl);
  await ensureDir(TRACKMAP_DIR);
  const pngBuffer = renderSvgToPng(svgText, 900);

  const pngFilename = `${layoutId}.png`;
  await fs.writeFile(path.join(TRACKMAP_DIR, pngFilename), pngBuffer);

  return {
    found: true,
    source: "repo",
    circuitsJsonUrl,
    circuitName: circuit?.name ?? null,
    layout: { id: layoutId, seasons: layout?.seasons ?? null },
    style: chosenStyle,
    svgUrl,
    pngUrl: `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(pngFilename)}`,
    note: null,
  };
}

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

  // Debug what the calendar is giving us
  console.log("GP DEBUG:", {
    gpName,
    location: nextRace.location,
    city,
    country,
  });

  // Track map lookup + PNG render
  const year = now.getUTCFullYear();
  const trackMap = await getTrackMapPng({ gpName, city, country, year });

  console.log("Track map result:", trackMap);

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
    header: `Next F1 race weekend`,
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },

    grandPrix: {
      name: gpName,
      city,
      country,
      location: nextRace.location,
    },

    trackMap, // Widgy image should bind to trackMap.pngUrl

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
      "Track map PNG is generated and committed under /trackmaps for Widgy. Bind Widgy image to trackMap.pngUrl. If trackMap.found is false, use GP_LAYOUT_OVERRIDES for a guaranteed layout id.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});