// updateStandings.js
import fs from "node:fs/promises";

const BASE_URL = "https://api.jolpi.ca/ergast/f1";

// Jolpica often behaves best with lowercase endpoints
const STANDINGS_URLS = [
  `${BASE_URL}/current/driverstandings.json`,   // preferred
  `${BASE_URL}/current/driverStandings.json`,   // fallback
];

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

function extractDriverStandings(payload) {
  // Ergast-compatible shape:
  // MRData.StandingsTable.StandingsLists[0].DriverStandings
  return payload?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? null;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      "Accept": "application/json",
    },
    redirect: "follow",
  });

  const text = await res.text(); // read once (works for debug + parse)
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 120)}`);
  }

  return { ok: res.ok, status: res.status, url, json, rawSnippet: text.slice(0, 200) };
}

async function fetchStandings() {
  const attempts = [];

  for (const url of STANDINGS_URLS) {
    const r = await fetchJson(url);
    attempts.push({ url: r.url, status: r.status, ok: r.ok });

    if (!r.ok) continue;

    const standings = extractDriverStandings(r.json);
    if (standings && Array.isArray(standings) && standings.length > 0) {
      return { data: r.json, sourceUrl: r.url, attempts };
    }
  }

  // If we got here, none matched expected structure
  throw new Error(
    `No standings data found. Attempts: ${JSON.stringify(attempts)}`
  );
}

async function updateStandings() {
  const { data, sourceUrl, attempts } = await fetchStandings();

  const standingsList =
    data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;

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
      url: sourceUrl,
      attempts,
    },
    drivers,
  };

  await fs.writeFile("f1_driver_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Updated f1_driver_standings.json");
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});