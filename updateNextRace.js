// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import { Resvg } from "@resvg/resvg-js";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Your GitHub Pages base URL (used for PNG URL in JSON)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Circuit SVG source (MIT)
const CIRCUIT_REPO_OWNER = "julesr0y";
const CIRCUIT_REPO_NAME = "f1-circuits-svg";
const CIRCUIT_REPO_REF = "main";

// Try these styles in order until an SVG exists
const TRACK_STYLES = ["white-outline", "white", "black-outline", "black"];

// Where rendered PNGs go in your repo
const TRACKMAP_DIR = "trackmaps";

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
  // jsDelivr supports HEAD
  const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
  return res.ok;
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

  // Try exact year match first
  for (const lay of layouts) {
    const seasons = parseSeasons(lay?.seasons || lay?.season || "");
    if (seasons.includes(year)) return lay;
  }
  // Otherwise pick newest-looking (last)
  return layouts[layouts.length - 1];
}

function scoreCircuit(c, { gpName, city, country }) {
  const gpN = normalize(gpName);
  const cityN = normalize(city);
  const countryN = normalize(country);

  const nameN = normalize(c?.name || "");
  const cityCN = normalize(c?.city || c?.location || "");
  const countryCN = normalize(c?.country || "");

  let score = 0;

  // City and country are strong signals
  if (cityN && (cityCN === cityN || nameN.includes(cityN))) score += 8;
  if (countryN && (countryCN === countryN || nameN.includes(countryN))) score += 4;

  // GP name token overlap
  if (gpN) {
    const tokens = gpN.split(" ").filter((t) => t.length > 2 && t !== "grand" && t !== "prix" && t !== "gp");
    for (const t of tokens) if (nameN.includes(t)) score += 2;
  }

  return score;
}

function bestCircuitMatch(circuits, ctx) {
  let best = null;
  let bestScore = -1;

  for (const c of circuits) {
    const sc = scoreCircuit(c, ctx);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }

  // Lower threshold so we still get *something* and then validate via svg existence
  return best;
}

function renderSvgToPng(svgString, widthPx = 900) {
  const resvg = new Resvg(svgString, { fitTo: { mode: "width", value: widthPx } });
  return resvg.render().asPng();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function getTrackMapPng({ gpName, city, country, year }) {
  const circuitsJsonUrl = jsDelivrUrl("circuits.json");
  const circuitsObj = await fetchJson(circuitsJsonUrl);
  const circuits = extractCircuits(circuitsObj);

  const circuit = bestCircuitMatch(circuits, { gpName, city, country });
  if (!circuit) {
    return {
      found: false,
      circuitsJsonUrl,
      note: "No circuits available in circuits.json (unexpected).",
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
      circuitsJsonUrl,
      circuitName: circuit?.name ?? null,
      note: "Matched a circuit but no layout id found.",
      pngUrl: null,
      svgUrl: null,
    };
  }

  // Find an SVG that actually exists by trying styles
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
      circuitsJsonUrl,
      circuitName: circuit?.name ?? null,
      layout: { id: layoutId, seasons: layout?.seasons ?? null },
      note: "Layout id found, but no SVG exists for any style in the repo.",
      pngUrl: null,
      svgUrl: null,
    };
  }

  // Render PNG and write it
  await ensureDir(TRACKMAP_DIR);

  const svgText = await fetchText(svgUrl);
  const pngBuffer = renderSvgToPng(svgText, 900);

  const pngFilename = `${layoutId}.png`;
  const pngPath = path.join(TRACKMAP_DIR, pngFilename);
  await fs.writeFile(pngPath, pngBuffer);

  return {
    found: true,
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
    .sort((