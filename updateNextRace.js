// updateNextRace.js
import fs from "node:fs/promises";
import ical from "node-ical";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Your local timezone for Widgy-friendly strings
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Wikimedia Commons API
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
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

// Parse "Barcelona, Spain" → { city: "Barcelona", country: "Spain" }
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

// ---- Wikimedia Commons helpers ----

// Basic fetch JSON with origin=* (required for some clients; harmless in Actions)
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 200)}`);
  }
  return res.json();
}

function buildCommonsSearchQuery({ gpName, city, country }) {
  // We bias toward typical file names on Commons:
  // "2020 Monaco Grand Prix circuit map", "Circuit de Monaco map", etc.
  // We search for SVG first (usually clean), but accept others too.
  const bits = [gpName, city, country].filter(Boolean);
  const base = bits.join(" ");
  return `${base} circuit map OR track map OR circuit diagram`;
}

async function findTrackMapOnCommons({ gpName, city, country }) {
  const srsearch = buildCommonsSearchQuery({ gpName, city, country });

  // 1) Search files (namespace 6 is File:)
  const searchUrl =
    `${COMMONS_API}?action=query&format=json&origin=*` +
    `&list=search&srnamespace=6&srlimit=5` +
    `&srsearch=${encodeURIComponent(srsearch)}`;

  const searchJson = await fetchJson(searchUrl);
  const hits = searchJson?.query?.search || [];
  if (!hits.length) {
    return {
      query: srsearch,
      fileTitle: null,
      imageUrl: null,
      thumbUrl: null,
      licenseShortName: null,
      attribution: null,
      sourceUrl: null,
      note: "No matching track map files found on Wikimedia Commons.",
    };
  }

  // Prefer SVG first, then PNG
  const pick =
    hits.find((h) => (h.title || "").toLowerCase().endsWith(".svg")) ||
    hits.find((h) => (h.title || "").toLowerCase().endsWith(".png")) ||
    hits[0];

  const fileTitle = pick.title; // e.g., "File:Monaco Grand Prix circuit map.svg"

  // 2) Get direct URL + license metadata
  const infoUrl =
    `${COMMONS_API}?action=query&format=json&origin=*` +
    `&prop=imageinfo&titles=${encodeURIComponent(fileTitle)}` +
    `&iiprop=url|extmetadata&iiurlwidth=800`;

  const infoJson = await fetchJson(infoUrl);
  const pages = infoJson?.query?.pages || {};
  const page = Object.values(pages)[0];
  const ii = page?.imageinfo?.[0];

  const imageUrl = ii?.url || null;
  const thumbUrl = ii?.thumburl || null;

  const ext = ii?.extmetadata || {};
  const licenseShortName = ext?.LicenseShortName?.value || null;
  const attribution = ext?.Attribution?.value || ext?.Artist?.value || null;

  const sourceUrl = fileTitle
    ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, "_"))}`
    : null;

  return {
    query: srsearch,
    fileTitle,
    imageUrl,
    thumbUrl,
    licenseShortName,
    attribution,
    sourceUrl,
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
    .sort((a, b) => a.start - b.start);

  const nextRace = sessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRace) throw new Error("Could not find upcoming Race session in calendar feed.");

  const gpName = nextRace.gpName;
  const gpSessions = sessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);

  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  const { city, country } = splitLocation(nextRace.location);

  // --- NEW: track map lookup from Wikimedia Commons
  let trackMap = null;
  try {
    trackMap = await findTrackMapOnCommons({ gpName, city, country });
  } catch (e) {
    trackMap = {
      query: buildCommonsSearchQuery({ gpName, city, country }),
      fileTitle: null,
      imageUrl: null,
      thumbUrl: null,
      licenseShortName: null,
      attribution: null,
      sourceUrl: null,
      note: `Track map lookup failed: ${e?.message || String(e)}`,
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

        // Widgy-friendly local strings (24h)
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

    // NEW FIELD
    trackMap, // includes imageUrl + credit/license when found

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
      "Track map is best-effort via Wikimedia Commons search. Use trackMap.thumbUrl for widgets; imageUrl may be large. Licenses/attribution vary per file.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});