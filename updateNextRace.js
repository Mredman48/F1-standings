// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";

// Config
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Helper: Days until a date
function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// Helper: Format short date/time
function shortDateInTZ(dateObj) {
  return dateObj.toLocaleDateString(LOCALE, { timeZone: USER_TZ, weekday: "short", month: "short", day: "2-digit" });
}
function shortTimeInTZ(dateObj) {
  return dateObj.toLocaleTimeString(LOCALE, { timeZone: USER_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}
function shortDateTimeInTZ(dateObj) {
  return `${shortDateInTZ(dateObj)} ${shortTimeInTZ(dateObj)}`;
}

// Country -> ISO2 -> flag
function normalizeCountryName(s) {
  return (s || "").toLowerCase().replace(/&/g, "and").replace(/\./g, "").replace(/[^a-z\s-]/g, "").replace(/\s+/g, " ").trim();
}
function countryToIso2(countryName) {
  const map = {
    australia: "au", bahrain: "bh", china: "cn", japan: "jp", "saudi arabia": "sa", qatar: "qa",
    singapore: "sg", "united arab emirates": "ae", uae: "ae",
    canada: "ca", mexico: "mx", brazil: "br", argentina: "ar", usa: "us",
    "united kingdom": "gb", monaco: "mc", italy: "it", spain: "es", france: "fr", belgium: "be",
    netherlands: "nl", austria: "at", hungary: "hu", germany: "de", portugal: "pt", sweden: "se",
    finland: "fi", denmark: "dk", norway: "no", poland: "pl", turkey: "tr", switzerland: "ch"
  };
  return map[normalizeCountryName(countryName)] || null;
}
function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  const code = iso2.toLowerCase();
  return { iso2: code, png: `https://flagcdn.com/w160/${code}.png`, svg: `https://flagcdn.com/${code}.svg` };
}

// Fetch JSON from OpenF1
async function fetchOpenF1NextRace() {
  const url = "https://raw.githubusercontent.com/openf1/openf1/master/data/next_race.json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

// Main
async function updateNextRace() {
  const now = new Date();

  // Fetch race data
  const raceData = await fetchOpenF1NextRace();

  const gpName = raceData.title;
  const season = String(raceData.season);
  const locationRaw = raceData.location || null;

  const country = locationRaw ? locationRaw : null;
  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  const weekendStart = new Date(raceData.weekend.startUtc);
  const weekendEnd = new Date(raceData.weekend.endUtc);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "openf1", url: "https://raw.githubusercontent.com/openf1/openf1/master/data/next_race.json" },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: gpName,
      season,
      location: {
        raw: locationRaw || null,
        city: raceData.city || null,
        country,
        flag
      },
      racePage: {
        slug: raceData.slug || null,
        url: raceData.url || null
      },
      trackMap: {
        found: !!raceData.trackMapUrl,
        pageUrl: raceData.url || null,
        mediaUrl: raceData.trackMapUrl || null,
        pngUrl: raceData.trackMapUrl ? `${PAGES_BASE}/trackmaps/${season}_${raceData.slug}_detailed.png` : null,
        note: raceData.trackMapUrl ? null : "No detailed track image found"
      },
      countdowns: { startsInDays: daysUntil(weekendStart, now) },
      weekend: { startUtc: weekendStart.toISOString(), endUtc: weekendEnd.toISOString() },
      sessions: raceData.sessions || []
    }
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote f1_next_race.json");
}

updateNextRace().catch(err => {
  console.error(err);
  process.exit(1);
});