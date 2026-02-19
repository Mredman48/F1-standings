// updateCadillacStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OUT_JSON = "f1_cadillac_standings.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

const CACHE_BUST = true;

const CADILLAC_LOGO_FILE = "2025_cadillac_color_v2.png";

// Ergast + Jolpica fallback
const ERGAST_BASES = [
  "https://ergast.com/api/f1",
  "https://api.jolpi.ca/ergast/api/f1",
];

// Placeholder lineup (until Cadillac is real in Ergast)
const DRIVERS_BASE = [
  { firstName: "Valtteri", lastName: "Bottas", code: "BOT", driverNumber: 77 },
  { firstName: "Sergio", lastName: "Perez", code: "PER", driverNumber: 11 },
];

// ---------- helpers ----------

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}?v=${Date.now()}` : url;
}

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getTeamLogoUrl(fileName) {
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

function getDriverNumberImageUrl(driverNumber) {
  if (!driverNumber) return null;
  return withCacheBust(
    `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`
  );
}

function getSavedHeadshotUrl(firstName, lastName) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  return withCacheBust(`${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchFromAnyBase(path) {
  for (const base of ERGAST_BASES) {
    try {
      const url = `${base}${path}`;
      const json = await fetchJson(url);
      return { json, urlUsed: url };
    } catch {}
  }
  throw new Error("All Ergast endpoints failed");
}

function getDriverStandings(mr) {
  return mr?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
}

function getConstructorStandings(mr) {
  return mr?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? [];
}

function getLastRace(mr) {
  const race = mr?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  return {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    date: race.date,
    timeUtc: race.time,
    circuit: {
      name: race?.Circuit?.circuitName,
      locality: race?.Circuit?.Location?.locality,
      country: race?.Circuit?.Location?.country,
    },
  };
}

// ---------- build JSON ----------

async function buildJson() {
  const now = new Date();

  const drivers = DRIVERS_BASE.map((d) => ({
    ...d,
    numberImageUrl: getDriverNumberImageUrl(d.driverNumber),
    position: "-",
    points: "-",
    wins: "-",
    team: "Cadillac",
    placeholder: true,
    bestResult: { position: "-", raceName: "-", round: "-", date: "-", circuit: "-" },
    headshotUrl: getSavedHeadshotUrl(d.firstName, d.lastName),
  }));

  let teamStanding = {
    team: "Cadillac",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };

  let lastRace = {
    season: "-",
    round: "-",
    raceName: "-",
    date: "-",
    timeUtc: "-",
    circuit: { name: "-", locality: "-", country: "-" },
  };

  let placeholderMode = true;

  try {
    const ds = await fetchFromAnyBase("/current/driverStandings.json");
    const cs = await fetchFromAnyBase("/current/constructorStandings.json");
    const lr = await fetchFromAnyBase("/current/last/results.json");

    const driverStandings = getDriverStandings(ds.json);
    const constructorStandings = getConstructorStandings(cs.json);
    const parsedLastRace = getLastRace(lr.json);
    if (parsedLastRace) lastRace = parsedLastRace;

    const constructorIds = new Set();

    for (const d of drivers) {
      const match = driverStandings.find(
        (row) =>
          row?.Driver?.code === d.code ||
          row?.Driver?.familyName?.toLowerCase() === d.lastName.toLowerCase()
      );

      if (match) {
        d.position = match.position;
        d.points = match.points;
        d.wins = match.wins;
        d.placeholder = false;

        const ctorId = match?.Constructors?.[0]?.constructorId;
        if (ctorId) constructorIds.add(ctorId);
      }
    }

    // Infer constructor row from drivers
    if (constructorIds.size === 1) {
      const ctorId = Array.from(constructorIds)[0];
      const ctorRow = constructorStandings.find(
        (c) => c?.Constructor?.constructorId === ctorId
      );

      if (ctorRow) {
        teamStanding = {
          team: "Cadillac",
          position: ctorRow.position,
          points: ctorRow.points,
          wins: ctorRow.wins,
          originalTeam: ctorRow?.Constructor?.name,
        };
      }
    }

    const anyDriverLive = drivers.some((d) => !d.placeholder);
    const teamLive = teamStanding.position !== "-";
    placeholderMode = !(anyDriverLive || teamLive);
  } catch {
    placeholderMode = true;
  }

  return {
    header: "Cadillac standings",
    generatedAtUtc: now.toISOString(),
    meta: {
      mode: placeholderMode ? "PLACEHOLDERS" : "ERGAST_LIVE",
      note:
        "Before first race this shows placeholders. After Race 1 it auto-populates from Ergast current standings.",
    },
    cadillac: {
      team: "Cadillac",
      teamLogoPng: getTeamLogoUrl(CADILLAC_LOGO_FILE),
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

// ---------- run ----------

async function updateCadillacStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateCadillacStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});