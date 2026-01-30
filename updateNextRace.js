// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import { Resvg } from "@resvg/resvg-js";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Your local timezone for Widgy-friendly strings
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// GitHub Pages base for your repo
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Track map source: julesr0y/f1-circuits-svg (MIT)
const CIRCUIT_REPO_OWNER = "julesr0y";
const CIRCUIT_REPO_NAME = "f1-circuits-svg";
const CIRCUIT_REPO_REF = "main";

// Choose style folder: "black" | "black-outline" | "white" | "white-outline"
const TRACK_STYLE = "white-outline";

// Where to store generated PNGs in your repo
const TRACKMAP_DIR = "trackmaps"; // committed folder

function jsDelivrUrl(repoPath) {
  return `https://cdn.jsdelivr.net/gh/${CIRCUIT_REPO_OWNER}/${CIRCUIT_REPO_NAME}@${CIRCUIT_REPO_REF}/${repoPath}`;
}

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

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
    headers: { "User-Agent": UA, Accept: "text/plain,*/*" },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 200)}`);
  }
  return res.text();
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseSeasons(seasonStr) {
  if (!seasonStr || typeof seasonStr !== "string") return [];
  const out = new Set();

  for (const part of seasonStr.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => parseInt(x.trim(), 10));
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let y = a; y <= b; y++) out.add(y);
      }
    } else {
      const y = parseInt(part, 10);
      if (Number.isFinite(y)) out.add(y);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function extractCircuits(obj) {
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj?.circuits)) return obj.circuits;
  if (Array.isArray(obj?.data)) return obj.data;
  return [];
}

function pickLayoutForYear(layouts, year) {
  if (!Array.isArray(layouts) || layouts.length === 0) return null;

  for (const lay of layouts) {
    const seasons = parseSeasons(lay?.seasons || lay?.season || "");
    if (seasons.includes(year)) return lay;
  }
  return layouts[layouts.length - 1];
}

function bestCircuitMatch(circuits, { gpName, city, country }) {
  const gpN = normalize(gpName);
  const cityN = normalize(city);
  const countryN = normalize(country);

  let best = null;
  let bestScore = -1;

  for (const c of circuits) {
    const nameN = normalize(c?.name || "");
    const cityCN = normalize(c?.city || c?.location || "");
    const countryCN = normalize(c?.country || "");

    let score = 0;

    if (cityN && (cityCN === cityN || nameN.includes(cityN))) score += 6;
    if (countryN && (countryCN === countryN || nameN.includes(countryN))) score += 2;

    if (gpN) {
      const gpTokens = gpN.split(" ").filter((t) => t.length > 2);
      for (const t of gpTokens) if (nameN.includes(t)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return bestScore >= 3 ? best : null;
}

async function getTrackMapSvgFromRepo({ gpName, city, country, year }) {
  const circuitsJsonUrl = jsDelivrUrl("circuits.json");
  const circuitsObj = await fetchJson(circuitsJsonUrl);
  const circuits = extractCircuits(circuitsObj);

  const circuit = bestCircuitMatch(circuits, { gpName, city, country });
  if (!circuit) {
    return {
      found: false,
      note: "Could not match next GP to a circuit entry in circuits.json.",
      circuitsJsonUrl,
      svgUrl: null,
      layoutId: null,
      circuitName: null,
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
      note: "Matched circuit but could not determine layout id.",
      circuitsJsonUrl,
      svgUrl: null,
      layoutId: null,
      circuitName: circuit?.name ?? null,
    };
  }

  const svgPath = `circuits/${TRACK_STYLE}/${layoutId}.svg`;
  const svgUrl = jsDelivrUrl(svgPath);

  return {
    found: true,
    note: null,
    circuitsJsonUrl,
    svgUrl,
    layoutId,
    circuitName: circuit?.name ?? null,
    layoutSeasons: layout?.seasons ?? null,
    style: TRACK_STYLE,
  };
}

// Render SVG string to PNG buffer
function renderSvgToPng(svgString, widthPx = 900) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: widthPx },
    // background: "transparent" is default
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
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
    .sort((a, b) => a.start - b.start);

  const nextRace = sessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRace) throw new Error("Could not find upcoming Race session in calendar feed.");

  const gpName = nextRace.gpName;
  const gpSessions = sessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);

  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  const { city, country } = splitLocation(nextRace.location);

  // ---- Track map: SVG lookup + PNG render ----
  const year = now.getUTCFullYear();
  let trackMap = null;

  try {
    const svgInfo = await getTrackMapSvgFromRepo({ gpName, city, country, year });

    if (!svgInfo.found || !svgInfo.svgUrl || !svgInfo.layoutId) {
      trackMap = {
        source: "github:julesr0y/f1-circuits-svg",
        ...svgInfo,
        pngUrl: null,
      };
    } else {
      // Fetch SVG content
      const svgText = await fetchText(svgInfo.svgUrl);

      // Render PNG and save to repo folder
      await ensureDir(TRACKMAP_DIR);
      const pngBuffer = renderSvgToPng(svgText, 900);

      const pngFilename = `${svgInfo.layoutId}.png`;
      const pngPath = path.join(TRACKMAP_DIR, pngFilename);
      await fs.writeFile(pngPath, pngBuffer);

      // Public URL via GitHub Pages
      const pngUrl = `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(pngFilename)}`;

      trackMap = {
        source: "github:julesr0y/f1-circuits-svg",
        found: true,
        style: svgInfo.style,
        circuitsJsonUrl: svgInfo.circuitsJsonUrl,
        circuitName: svgInfo.circuitName,
        layout: { id: svgInfo.layoutId, seasons: svgInfo.layoutSeasons },
        svgUrl: svgInfo.svgUrl,
        pngUrl,
        note: null,
      };
    }
  } catch (e) {
    trackMap = {
      source: "github:julesr0y/f1-circuits-svg",
      found: false,
      pngUrl: null,
      svgUrl: null,
      note: `Track map render failed: ${e?.message || String(e)}`,
    };
  }

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

    trackMap, // <-- bind Widgy Image to trackMap.pngUrl

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
      "Track map is rendered to PNG and committed under /trackmaps so Widgy can display it. Use trackMap.pngUrl in Widgy Image layers.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});