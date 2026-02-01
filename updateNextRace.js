// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Local strings for your widget
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Your GitHub Pages base URL
const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TRACKMAP_DIR = "trackmaps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ---------------------- date helpers ----------------------
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
    hour12: false, // 24h
  });
}

function shortDateTimeInTZ(dateObj, timeZone = USER_TZ) {
  return `${shortDateInTZ(dateObj, timeZone)} ${shortTimeInTZ(dateObj, timeZone)}`;
}

function parseMonthShort(mon) {
  const m = (mon || "").toLowerCase();
  const map = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  return map[m] ?? null;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

// ---------------------- calendar parsing helpers ----------------------
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

// ---------------------- networking helpers ----------------------
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "image/*,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\bgrand prix\b/g, "")
    .replace(/\bgp\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugifyFromGpName(gpName) {
  const n = normalize(gpName);
  if (!n) return null;
  return n.split(" ").join("-");
}

function scoreHref(href, gpName) {
  const tokens = normalize(gpName).split(" ").filter((t) => t.length > 2);
  const h = href.toLowerCase();
  let score = 0;
  for (const t of tokens) if (h.includes(t)) score += 2;
  return score;
}

// ---------------------- F1 detailed track image ----------------------
async function resolveF1RaceSlug(season, gpName) {
  // Try direct slug first
  const candidate = slugifyFromGpName(gpName);
  if (candidate) {
    const url = `https://www.formula1.com/en/racing/${season}/${candidate}`;
    try {
      await fetchText(url);
      return { slug: candidate, url, source: "slugified" };
    } catch {
      // fall through
    }
  }

  // Fallback: scrape season page for race links
  const seasonUrl = `https://www.formula1.com/en/racing/${season}.html`;
  const html = await fetchText(seasonUrl);

  const hrefs = Array.from(
    html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g"))
  )
    .map((m) => m[0])
    .filter(Boolean);

  const uniq = [...new Set(hrefs)];
  if (uniq.length === 0) throw new Error(`No race links found on ${seasonUrl}`);

  const best = uniq
    .map((href) => ({ href, score: scoreHref(href, gpName) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score === 0) {
    throw new Error(`Could not match gpName="${gpName}" to a race link on formula1.com`);
  }

  const fullUrl = `https://www.formula1.com${best.href}`;
  const slug = best.href.split(`/en/racing/${season}/`)[1];

  return { slug, url: fullUrl, source: "season-page-scan" };
}

function extractDetailedTrackMediaUrl(html, season) {
  // e.g. https://media.formula1.com/image/upload/.../common/f1/2026/track/...detailed.webp
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/track/[^"']+detailed\\.(webp|png)`,
    "i"
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

async function fetchF1DetailedTrackPng({ season, gpName }) {
  const resolved = await resolveF1RaceSlug(season, gpName);
  const html = await fetchText(resolved.url);

  const mediaUrl = extractDetailedTrackMediaUrl(html, season);
  if (!mediaUrl) {
    return {
      found: false,
      source: "formula1.com race page",
      racePageUrl: resolved.url,
      note: "Could not find a '...track/...detailed.webp' image on the race page.",
      mediaUrl: null,
      pngUrl: null,
    };
  }

  await ensureDir(TRACKMAP_DIR);

  const inputBuf = await fetchBuffer(mediaUrl);
  const outputName = `f1_${season}_${resolved.slug}_detailed.png`;
  const outputPath = path.join(TRACKMAP_DIR, outputName);

  const pngBuf = await sharp(inputBuf).png().toBuffer();
  await fs.writeFile(outputPath, pngBuf);

  return {
    found: true,
    source: "media.formula1.com (scraped from race page)",
    racePageUrl: resolved.url,
    mediaUrl,
    pngUrl: makeTrackPngUrl(outputName),
  };
}

// ---------------------- NEW: Testing blocks from F1 schedule page ----------------------
async function fetchTestingBlocks(season) {
  // This page lists testing blocks like:
  // "TESTING ... Bahrain ... PRE-SEASON TESTING 1 2026 11 - 13 Feb"
  // "TESTING ... Bahrain ... PRE-SEASON TESTING 2 2026 18 - 20 Feb"
  // Source: formula1.com racing season listing
  const url = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(url);

  // Make parsing more stable by flattening whitespace
  const flat = html.replace(/\s+/g, " ");

  // Capture location + title + date range (best-effort regex)
  // Groups:
  // 1) location token (e.g., Bahrain)
  // 2) testing title (e.g., FORMULA 1 ARAMCO PRE-SEASON TESTING 1 2026)
  // 3) start day (e.g., 11)
  // 4) end day (e.g., 13)
  // 5) month short (e.g., Feb)
  const re = new RegExp(
    `TESTING[^]*?Flag[^]*?([A-Za-z’'\\- ]+?)\\s+([A-Z0-9 \\-’'\\.]+PRE-SEASON TESTING\\s+[0-9]+\\s+${season})\\s+([0-9]{2})\\s*-\\s*([0-9]{2})\\s+([A-Za-z]{3})`,
    "g"
  );

  const matches = [...flat.matchAll(re)];
  if (matches.length === 0) {
    return { found: false, sourceUrl: url, blocks: [], note: "No testing blocks matched on F1 season page." };
  }

  const blocks = matches.map((m) => {
    const location = (m[1] || "").trim();
    const title = (m[2] || "").trim();
    const startDay = Number(m[3]);
    const endDay = Number(m[4]);
    const monthShort = (m[5] || "").trim();

    const monthIdx = parseMonthShort(monthShort);
    let startUtc = null;
    let endUtc = null;

    if (Number.isFinite(startDay) && Number.isFinite(endDay) && monthIdx != null) {
      // Dates only (no official time on this page) — set to 00:00Z
      startUtc = new Date(Date.UTC(Number(season), monthIdx, startDay, 0, 0, 0)).toISOString();
      endUtc = new Date(Date.UTC(Number(season), monthIdx, endDay, 23, 59, 59)).toISOString();
    }

    return {
      type: "TESTING",
      title,
      location,
      startUtc,
      endUtc,
      startDateLabel: startUtc ? shortDateInTZ(new Date(startUtc)) : null,
      endDateLabel: endUtc ? shortDateInTZ(new Date(endUtc)) : null,
    };
  });

  // de-dupe by title+dates
  const uniq = [];
  const seen = new Set();
  for (const b of blocks) {
    const key = `${b.title}|${b.startUtc}|${b.endUtc}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(b);
    }
  }

  // Determine next upcoming testing block
  const now = new Date();
  const upcoming = uniq
    .filter((b) => b.startUtc && new Date(b.startUtc) > now)
    .sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));

  return {
    found: true,
    sourceUrl: url,
    blocks: uniq,
    next: upcoming[0] || null,
    note: null,
  };
}

// ---------------------- Main ----------------------
async function updateNextRace() {
  const now = new Date();

  // ICS sessions (race weekend)
  const ics = await ical.async.fromURL(ICS_URL, { headers: { "User-Agent": UA } });
  const events = Object.values(ics).filter((x) => x?.type === "VEVENT");

  const sessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);
      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      return {
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
  const season = String(nextRace.start.getUTCFullYear());

  const gpSessions = sessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  // NEW: Testing blocks (from official F1 season listing)
  const testing = await fetchTestingBlocks(season);

  // Official detailed map for the NEXT GP race weekend
  const trackMap = await fetchF1DetailedTrackPng({ season, gpName });

  // Determine "nextEvent" between testing and race weekend
  const nextTestingStart = testing?.next?.startUtc ? new Date(testing.next.startUtc) : null;
  const nextRaceWeekendStart = weekendStart;

  let nextEvent = {
    type: "RACE_WEEKEND",
    name: gpName,
    startUtc: weekendStart.toISOString(),
    startLocalDateShort: shortDateInTZ(weekendStart),
    startLocalTimeShort: shortTimeInTZ(weekendStart),
    startsInDays: daysUntil(weekendStart, now),
  };

  if (nextTestingStart && nextTestingStart < nextRaceWeekendStart) {
    nextEvent = {
      type: "TESTING",
      name: testing.next.title,
      location: testing.next.location,
      startUtc: testing.next.startUtc,
      endUtc: testing.next.endUtc,
      startDateLabel: testing.next.startDateLabel,
      endDateLabel: testing.next.endDateLabel,
      startsInDays: daysUntil(nextTestingStart, now),
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
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },

    nextEvent, // either TESTING or RACE_WEEKEND

    // Race weekend (still included even if testing comes first)
    grandPrix: {
      name: gpName,
      location: nextRace.location,
      season,
    },

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

    // NEW: Testing section
    testing: {
      found: testing.found,
      sourceUrl: testing.sourceUrl,
      next: testing.next,
      all: testing.blocks,
      note: testing.note,
    },

    notes:
      "Testing blocks come from the official F1 season listing; race weekend sessions/times come from the ICS feed.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName} (season ${season})`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});