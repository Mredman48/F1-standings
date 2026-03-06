// updateNextRace.js
import fs from "fs/promises";

// Ergast API endpoint for current season
const ERGAST_API = "https://ergast.com/api/f1/current.json";

// Map country name to ISO2 for flags
const COUNTRY_MAP = {
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

// Convert country name → flag URLs
function buildFlagUrls(name) {
  if (!name) return { iso2: null, png: null, svg: null };
  const iso2 = COUNTRY_MAP[name.toLowerCase()] || null;
  return iso2
    ? {
        iso2,
        png: `https://flagcdn.com/w160/${iso2}.png`,
        svg: `https://flagcdn.com/${iso2}.svg`,
      }
    : { iso2: null, png: null, svg: null };
}

// Map session type
function mapSessionType(name) {
  const s = name.toLowerCase();
  if (s.includes("practice 1")) return "FP1";
  if (s.includes("practice 2")) return "FP2";
  if (s.includes("practice 3")) return "FP3";
  if (s.includes("sprint qualifying")) return "Sprint Quali";
  if (s.includes("sprint") && !s.includes("sprint qualifying")) return "Sprint";
  if (s.includes("qualifying") && !s.includes("sprint")) return "Quali";
  if (s.includes("race")) return "Race";
  return name;
}

// Convert ISO string → UTC
function formatUtc(dateStr) {
  return dateStr ? new Date(dateStr).toISOString() : null;
}

async function updateNextRace() {
  const now = new Date();
  try {
    const res = await fetch(ERGAST_API);
    if (!res.ok) throw new Error(`Failed to fetch Ergast API (${res.status})`);
    const data = await res.json();

    const races = data.MRData.RaceTable.Races || [];
    if (!races.length) {
      console.warn("No races found in Ergast API.");
      await fs.writeFile("f1_next_race.json", JSON.stringify(null, null, 2));
      return;
    }

    // Find the next race after now
    const upcoming = races.filter(
      (r) => new Date(r.date + "T" + (r.time || "00:00:00Z")) > now
    );

    if (!upcoming.length) {
      console.warn("No upcoming race found.");
      await fs.writeFile("f1_next_race.json", JSON.stringify(null, null, 2));
      return;
    }

    const nextRace = upcoming[0];
    const country = nextRace.Circuit.Location.country;
    const flag = buildFlagUrls(country);

    // Build session objects
    const sessions = [];
    if (nextRace.FirstPractice)
      sessions.push({
        type: "FP1",
        startUtc: formatUtc(nextRace.FirstPractice.date + "T" + nextRace.FirstPractice.time),
        endUtc: null,
      });
    if (nextRace.SecondPractice)
      sessions.push({
        type: "FP2",
        startUtc: formatUtc(nextRace.SecondPractice.date + "T" + nextRace.SecondPractice.time),
        endUtc: null,
      });
    if (nextRace.ThirdPractice)
      sessions.push({
        type: "FP3",
        startUtc: formatUtc(nextRace.ThirdPractice.date + "T" + nextRace.ThirdPractice.time),
        endUtc: null,
      });
    if (nextRace.Qualifying)
      sessions.push({
        type: "Quali",
        startUtc: formatUtc(nextRace.Qualifying.date + "T" + nextRace.Qualifying.time),
        endUtc: null,
      });
    if (nextRace.Sprint)
      sessions.push({
        type: "Sprint Quali",
        startUtc: formatUtc(nextRace.Sprint.date + "T" + nextRace.Sprint.time),
        endUtc: null,
      });
    // Main race
    sessions.push({
      type: "Race",
      startUtc: formatUtc(nextRace.date + "T" + (nextRace.time || "00:00:00Z")),
      endUtc: null,
    });

    // Weekend start/end
    const sessionStarts = sessions
      .map((s) => s.startUtc && new Date(s.startUtc))
      .filter(Boolean);
    const weekendStart = new Date(Math.min(...sessionStarts));
    const weekendEnd = new Date(Math.max(...sessionStarts));

    const out = {
      header: "Next F1 event",
      generatedAtUtc: now.toISOString(),
      source: { kind: "ergast", url: ERGAST_API },
      nextEvent: {
        type: "RACE_WEEKEND",
        title: nextRace.raceName,
        season: nextRace.season,
        location: { raw: country, flag },
        countdowns: {
          startsInDays: Math.ceil((weekendStart - now) / (1000 * 60 * 60 * 24)),
        },
        weekend: {
          startUtc: weekendStart.toISOString(),
          endUtc: weekendEnd.toISOString(),
        },
        sessions,
      },
    };

    await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2));
    console.log(`Wrote f1_next_race.json for ${nextRace.raceName}`);
  } catch (err) {
    console.error(err);
    await fs.writeFile("f1_next_race.json", JSON.stringify(null, null, 2));
  }
}

updateNextRace();