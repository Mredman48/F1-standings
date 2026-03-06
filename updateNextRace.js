// updateNextRace.js
import fs from "fs/promises";
import fetch from "node-fetch";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Minimal country -> ISO2 map for flags
const countryMap = {
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
  "united states": "us",
  usa: "us",
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

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  const code = iso2.toLowerCase();
  return {
    iso2: code,
    png: `https://flagcdn.com/w160/${code}.png`,
    svg: `https://flagcdn.com/${code}.svg`,
  };
}

function titleCaseWords(s) {
  if (!s) return null;
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

async function updateNextRace() {
  const now = new Date();
  const year = now.getUTCFullYear();

  // OpenF1 next race JSON URL
  const NEXT_RACE_URL = `https://raw.githubusercontent.com/openf1/openf1/master/data/races/${year}/next_race.json`;

  const res = await fetch(NEXT_RACE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${NEXT_RACE_URL}`);
  const nextRaceData = await res.json();

  // Extract race info
  const gpName = nextRaceData.name || "Unknown GP";
  const season = nextRaceData.season || year.toString();
  const locationRaw = nextRaceData.country || "Unknown";
  const weekendStart = new Date(nextRaceData.start); // UTC
  const weekendEnd = new Date(nextRaceData.end);     // UTC

  const countryIso = countryMap[locationRaw.toLowerCase()] || null;
  const flag = buildFlagUrls(countryIso);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "openf1", url: NEXT_RACE_URL },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: gpName,
      season,
      location: {
        raw: locationRaw,
        city: nextRaceData.city || null,
        country: titleCaseWords(locationRaw),
        flag,
      },
      racePage: {
        slug: nextRaceData.slug || null,
        url: nextRaceData.url || null,
      },
      trackMap: nextRaceData.trackMap || null,
      countdowns: {
        startsInDays: daysUntil(weekendStart, now),
      },
      weekend: {
        startUtc: weekendStart.toISOString(),
        endUtc: weekendEnd.toISOString(),
      },
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Next race JSON written successfully.");
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});
