// updateNextRace.js
import fs from "fs/promises";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Helpers
function formatIsoUTC(date) {
  return date ? date.toISOString() : null;
}

function sessionTypeFromSummary(summary) {
  const s = summary.toLowerCase();
  if (s.includes("practice 1")) return "FP1";
  if (s.includes("practice 2")) return "FP2";
  if (s.includes("practice 3")) return "FP3";
  if (s.includes("sprint qualifying")) return "Sprint Quali";
  if (s.includes("sprint") && !s.includes("sprint qualifying")) return "Sprint";
  if (s.includes("qualifying") && !s.includes("sprint")) return "Quali";
  if (s.includes("race")) return "Race";
  return null;
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
    portugal: "pt"
  };
  return map[(name || "").toLowerCase()] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  return {
    iso2,
    png: `https://flagcdn.com/w160/${iso2}.png`,
    svg: `https://flagcdn.com/${iso2}.svg`
  };
}

async function fetchICS() {
  const res = await fetch(ICS_URL, { headers: { "User-Agent": "f1-standings-bot/1.0" } });
  if (!res.ok) throw new Error(`Failed to fetch ICS (${res.status})`);
  return res.text();
}

// Minimal ICS parser for VEVENTs
function parseICS(text) {
  const events = [];
  const lines = text.split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) current = {};
    else if (line.startsWith("END:VEVENT")) {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":");
      if (key.startsWith("SUMMARY")) current.summary = value;
      else if (key.startsWith("DTSTART")) current.start = new Date(value);
      else if (key.startsWith("DTEND")) current.end = new Date(value);
      else if (key.startsWith("LOCATION")) current.location = value;
    }
  }
  return events;
}

async function updateNextRace() {
  const now = new Date();
  const icsText = await fetchICS();
  const parsedEvents = parseICS(icsText);

  const upcoming = parsedEvents.filter(e => e.start > now);

  // group by GP
  const grouped = {};
  for (const ev of upcoming) {
    const gpName = ev.summary.split(" - ")[0].trim();
    grouped[gpName] = grouped[gpName] || [];
    grouped[gpName].push(ev);
  }

  const nextGpNames = Object.keys(grouped);
  if (nextGpNames.length === 0) throw new Error("No upcoming race found.");

  const nextGpName = nextGpNames[0];
  const gpSessions = grouped[nextGpName];

  const sessionObjects = gpSessions.map(s => ({
    type: sessionTypeFromSummary(s.summary),
    startUtc: formatIsoUTC(s.start),
    endUtc: formatIsoUTC(s.end)
  }));

  const starts = sessionObjects.map(s => new Date(s.startUtc));
  const ends = sessionObjects.map(s => new Date(s.endUtc));
  const weekendStart = new Date(Math.min(...starts));
  const weekendEnd = new Date(Math.max(...ends));

  const country = gpSessions[0].location || null;
  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    source: { kind: "ics", url: ICS_URL },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: nextGpName,
      season: String(weekendStart.getUTCFullYear()),
      location: { raw: country, flag },
      countdowns: {
        startsInDays: Math.ceil((weekendStart - now) / (1000 * 60 * 60 * 24))
      },
      weekend: {
        startUtc: formatIsoUTC(weekendStart),
        endUtc: formatIsoUTC(weekendEnd)
      },
      sessions: sessionObjects
    }
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2));
  console.log(`Wrote f1_next_race.json with full session schedule for ${nextGpName}`);
}

updateNextRace().catch(err => {
  console.error(err);
  process.exit(1);
});