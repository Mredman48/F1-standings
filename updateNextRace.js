// updateNextRace.js
import fs from "node:fs/promises";

const OPENF1_SCHEDULE_BASE = "https://api.jolpi.ca/ergast/f1";
const NEXT_RACE_ENDPOINT = `${OPENF1_SCHEDULE_BASE}/current/next.json`;
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// country→ISO map (same as you had before)
const COUNTRY_ISO = {
  australia: "au",
  bahrain: "bh",
  china: "cn",
  japan: "jp",
  "saudi arabia": "sa",
  qatar: "qa",
  singapore: "sg",
  "united arab emirates": "ae",
  canada: "ca",
  mexico: "mx",
  brazil: "br",
  italy: "it",
  spain: "es",
  france: "fr",
  belgium: "be",
  netherlands: "nl",
  austria: "at",
  hungary: "hu",
  germany: "de",
  portugal: "pt",
};

// convert country to iso2
function countryToIso2(name) {
  if (!name) return null;
  return COUNTRY_ISO[String(name).toLowerCase()] || null;
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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "f1-standings-bot/1.0", Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return JSON.parse(text);
}

async function updateNextRace() {
  const now = new Date().toISOString();
  const schedule = await fetchJson(NEXT_RACE_ENDPOINT);

  // Ergast/Jolpica schedule JSON:
  // MRData.RaceTable.Races is an array, `[0]` is next race
  const race = schedule?.MRData?.RaceTable?.Races?.[0];
  if (!race) throw new Error("No upcoming race found in schedule.");

  const season = race.season;
  const round = race.round;
  const raceName = race.raceName;
  const date = race.date;
  const time = race.time || null;

  // flag and location
  const country = race?.Circuit?.Location?.country || null;
  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  // weekend start / end from schedule (date only)
  const weekendStart = `${date}T00:00:00.000Z`;
  const weekendEnd = `${date}T23:59:59.000Z`;

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now,
    nextEvent: {
      type: "RACE_WEEKEND",
      title: raceName,
      season: String(season),
      location: {
        raw: country,
        city: race?.Circuit?.Location?.locality || null,
        country,
        flag,
      },
      raceInfo: {
        round: round,
        date,
        time,
      },
      weekend: {
        startUtc: weekendStart,
        endUtc: weekendEnd,
      },
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote f1_next_race.json", raceName);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});