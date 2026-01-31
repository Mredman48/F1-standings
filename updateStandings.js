// updateStandings.js
import fs from "node:fs/promises";

const BASE_URL = "https://api.jolpi.ca/ergast/f1";
const STANDINGS_URL = `${BASE_URL}/current/driverstandings.json`;

// Long constructor names → short display names
const TEAM_NAME_MAP = {
  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",

  "RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",

  "Mercedes": "Mercedes",
  "Ferrari": "Ferrari",
  "McLaren": "McLaren",
  "Aston Martin": "Aston Martin",
  "Alpine F1 Team": "Alpine",
  "Williams": "Williams",
  "Haas F1 Team": "Haas",
  "Alfa Romeo": "Alfa Romeo",
  "Kick Sauber": "Sauber",
};

function normalizeTeamName(name) {
  if (!name) return null;
  return TEAM_NAME_MAP[name] || name;
}

async function fetchStandingsPayload() {
  const res = await fetch(STANDINGS_URL, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      "Accept": "application/json",
    },
    redirect: "follow",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to fetch standings: HTTP ${res.status}\n${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from standings endpoint: ${text.slice(0, 200)}`);
  }
}

async function updateStandings() {
  const data = await fetchStandingsPayload();

  const standingsLists = data?.MRData?.StandingsTable?.StandingsLists ?? [];
  const season = data?.MRData?.StandingsTable?.season ?? null;
  const round = data?.MRData?.StandingsTable?.round ?? null;
  const total = Number(data?.MRData?.total ?? 0);

  const driverStandings = standingsLists?.[0]?.DriverStandings ?? [];

  // If there are no standings yet (common pre-season), write an empty file and exit cleanly.
  const drivers = (driverStandings || []).map((d) => {
    const constructor = d.Constructors?.[0];

    return {
      position: `P${d.position}`,
      positionNumber: Number(d.position),
      points: Number(d.points),
      wins: Number(d.wins),

      driver: {
        code: d.Driver.code || null,
        firstName: d.Driver.givenName,
        lastName: d.Driver.familyName,
        fullName: `${d.Driver.givenName} ${d.Driver.familyName}`,
        nationality: d.Driver.nationality,
      },

      constructor: {
        name: normalizeTeamName(constructor?.name),
        fullName: constructor?.name || null,
        nationality: constructor?.nationality || null,
      },
    };
  });

  const out = {
    header: `${season ?? ""} Driver Standings`.trim() || "F1 Driver Standings",
    generatedAtUtc: new Date().toISOString(),
    source: {
      kind: "jolpica ergast-compatible",
      url: STANDINGS_URL,
    },
    season,
    round,
    totalDriversInResponse: total,
    note:
      drivers.length === 0
        ? "No driver standings are available yet for the current season. This will populate after the first classified session/race with standings."
        : null,
    drivers,
  };

  await fs.writeFile("f1_driver_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_driver_standings.json (season=${season}, drivers=${drivers.length})`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});