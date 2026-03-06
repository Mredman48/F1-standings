// updateNextRace.js
import fs from "fs/promises";

const USER_TZ = "UTC"; // keep UTC for widgets
const LOCALE = "en-CA";

// Base URL for your GitHub Pages track maps
const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TRACKMAP_DIR = "trackmaps";

// OpenF1 API endpoint for next race
const OPENF1_URL = "https://raw.githubusercontent.com/openf1/openf1/master/data/next_race.json";

/* -------------------- helpers -------------------- */

function titleCaseWords(s) {
  if (!s) return null;
  return String(s)
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

function daysUntil(date, now = new Date()) {
  const ms = new Date(date).getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function normalizeCountryName(s) {
  return (s || "").toLowerCase().replace(/[^a-z\s]/g, "").trim();
}

function countryToIso2(countryName) {
  const map = {
    australia: "au",
    bahrain: "bh",
    china: "cn",
    japan: "jp",
    "saudi arabia": "sa",
    qatar: "qa",
    singapore: "sg",
    "united arab emirates": "ae",
    uae: "ae",
    canada: "ca",
    mexico: "mx",
    brazil: "br",
    argentina: "ar",
    usa: "us",
    "united states": "us",
    "united states of america": "us",
    "united kingdom": "gb",
    monaco: "mc",
    italy: "it",
    spain: "es",
    france: "fr",
    belgium: "be",
    netherlands: "nl",
    austria: "at",
    hungary: "hu",
    germany: "de",
    portugal: "pt",
    sweden: "se",
    finland: "fi",
    denmark: "dk",
    norway: "no",
    poland: "pl",
    turkey: "tr",
    switzerland: "ch",
  };
  return map[normalizeCountryName(countryName)] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  const code = iso2.toLowerCase();
  return {
    iso2: code,
    png: `https://flagcdn.com/w160/${code}.png`,
    svg: `https://flagcdn.com/${code}.svg`,
  };
}

/* -------------------- main -------------------- */

async function updateNextRace() {
  const now = new Date();

  // Fetch OpenF1 JSON
  const res = await fetch(OPENF1_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${OPENF1_URL}`);
  const data = await res.json();

  const nextRace = data.nextEvent;
  if (!nextRace) throw new Error("No next race data found in OpenF1 feed.");

  // Extract country and flag
  const country = nextRace.location?.raw ? titleCaseWords(nextRace.location.raw) : null;
  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  // Track map PNG URL
  const trackMap = {
    found: Boolean(nextRace.trackMap?.mediaUrl),
    pageUrl: nextRace.trackMap?.pageUrl || null,
    mediaUrl: nextRace.trackMap?.mediaUrl || null,
    pngUrl: nextRace.trackMap?.pngUrl || null,
    note: null,
  };

  // Weekend start/end
  const weekendStart = nextRace.weekend?.startUtc;
  const weekendEnd = nextRace.weekend?.endUtc;

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "openf1", url: OPENF1_URL },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: nextRace.title,
      season: nextRace.season,
      location: {
        raw: country,
        city: nextRace.location?.city || null,
        country,
        flag,
      },
      racePage: nextRace.racePage || null,
      trackMap,
      countdowns: {
        startsInDays: weekendStart ? daysUntil(weekendStart, now) : null,
      },
      weekend: {
        startUtc: weekendStart,
        endUtc: weekendEnd,
      },
      sessions: nextRace.sessions || [],
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Updated f1_next_race.json");
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});
