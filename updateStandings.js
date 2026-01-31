// updateStandings.js
import fs from "node:fs/promises";
import fetch from "node-fetch";

const ERGAST_URL =
  "https://ergast.com/api/f1/current/driverStandings.json";

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
  "Kick Sauber": "Sauber"
};

function normalizeTeamName(name) {
  if (!name) return null;
  return TEAM_NAME_MAP[name] || name;
}

async function updateStandings() {
  const res = await fetch(ERGAST_URL);

  if (!res.ok) {
    throw new Error(`Failed to fetch standings: HTTP ${res.status}`);
  }

  const data = await res.json();

  const standingsList =
    data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;

  if (!standingsList) {
    throw new Error("No standings data found in Ergast response");
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
        fullName: constructor?.name,
        nationality: constructor?.nationality || null,
      },
    };
  });

  const out = {
    header: "F1 Driver Standings",
    season: data?.MRData?.StandingsTable?.season,
    round: data?.MRData?.StandingsTable?.round,
    generatedAtUtc: new Date().toISOString(),
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