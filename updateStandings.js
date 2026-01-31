// updateStandings.js
import fs from "node:fs/promises";

const BASE_URL = "https://api.jolpi.ca/ergast/f1";
const STANDINGS_URL = `${BASE_URL}/current/driverStandings.json`;

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

async function fetchStandingsJson() {
  const res = await fetch(STANDINGS_URL, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      "Accept": "application/json",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch standings: HTTP ${res.status}\n${body.slice(0, 200)}`
    );
  }

  return res.json();
}

async function updateStandings() {
  const data = await fetchStandingsJson();

  const standingsList =
    data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;

  if (!standingsList) {
    throw new Error("No standings data found in API response");
  }

  const drivers = standingsList.map((d) => {
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
    header: "F1 Driver Standings",
    season: data?.MRData?.StandingsTable?.season || null,
    round: data?.MRData?.StandingsTable?.round || null,
    generatedAtUtc: new Date().toISOString(),
    source: {
      kind: "jolpica ergast-compatible",
      url: STANDINGS_URL,
    },
    drivers,
  };

  await fs.writeFile(
    "f1_driver_standings.json",
    JSON.stringify(out, null, 2),
    "utf8"
  );

  console.log("Updated f1_driver_standings.json");
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});