// updateNextRace.js
import fs from "fs/promises";
import fetch from "node-fetch";

const CALENDAR_JSON_URL =
  "https://raw.githubusercontent.com/f1data/season-calendar/main/2026.json"; // public JSON feed

// Helpers
function formatIsoUTC(dateStr) {
  return dateStr ? new Date(dateStr).toISOString() : null;
}

// Map session name to widget-friendly
function sessionTypeFromSummary(summary) {
  const s = summary.toLowerCase();
  if (s.includes("practice 1")) return "FP1";
  if (s.includes("practice 2")) return "FP2";
  if (s.includes("practice 3")) return "FP3";
  if (s.includes("sprint qualifying")) return "Sprint Quali";
  if (s.includes("sprint") && !s.includes("sprint qualifying")) return "Sprint";
  if (s.includes("qualifying") && !s.includes("sprint")) return "Quali";
  if (s.includes("race")) return "Race";
  return summary;
}

function countryToIso2(name) {
  const map = {
    australia: "au",
    bahrain: "bh",
    china: "cn",
    japan: "jp",
    "saudi arabia": "sa",
    qatar: "qa",
    singapore: "sg",
    uae: "ae",
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
  return map[(name || "").toLowerCase()] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  return {
    iso2,
    png: `https://flagcdn.com/w160/${iso2}.png`,
    svg: `https://flagcdn.com/${iso2}.svg`,
  };
}

// Fetch calendar JSON
async function fetchCalendar() {
  const res = await fetch(CALENDAR_JSON_URL, {
    headers: { "User-Agent": "f1-standings-bot/1.0" },
  });
  if (!res.ok) throw new Error(`Failed to fetch JSON (${res.status})`);
  return res.json();
}

async function updateNextRace() {
  const now = new Date();

  const calendar = await fetchCalendar();

  // Each race should have: name, round, country, sessions[]
  const upcomingRaces = calendar.filter((race) => {
    const raceStart = new Date(race.sessions.Race);
    return raceStart > now;
  });

  if (upcomingRaces.length === 0) throw new Error("No upcoming race found.");

  const nextRace = upcomingRaces[0];
  const sessionObjects = Object.entries(nextRace.sessions)
    .filter(([name, time]) => !!time)
    .map(([name, time]) => ({
      type: sessionTypeFromSummary(name),
      startUtc: formatIsoUTC(time),
    }));

  const starts = sessionObjects.map((s) => new Date(s.startUtc));
  const weekendStart = new Date(Math.min(...starts));
  const weekendEnd = new Date(Math.max(...starts));

  const iso2 = countryToIso2(nextRace.country);
  const flag = buildFlagUrls(iso2);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: new Date().toISOString(),
    source: { kind: "json", url: CALENDAR_JSON_URL },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: nextRace.name,
      season: String(weekendStart.getUTCFullYear()),
      location: { raw: nextRace.country, flag },
      round: nextRace.round,
      countdowns: {
        startsInDays: Math.ceil((weekendStart - now) / (1000 * 60 * 60 * 24)),
      },
      weekend: {
        startUtc: formatIsoUTC(weekendStart),
        endUtc: formatIsoUTC(weekendEnd),
      },
      sessions: sessionObjects,
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2));
  console.log(`Wrote f1_next_race.json for ${nextRace.name}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});