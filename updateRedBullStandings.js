// updateRedBullStandings.js
import fs from "node:fs/promises";
import path from "node:path";

// ====== SETTINGS ======
const DUMMY_MODE = true; // <-- keep true while building your widget; set to false later for live pulls

const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// ✅ Use the existing logo you already downloaded
const TEAMLOGO_PATH = "teamlogos/redbull_logo.png";

// Output JSON
const OUT_JSON = "f1_redbull_standings.json";

// Optional: if you later set DUMMY_MODE=false, these are used
const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];
const OPENF1_BASE = "https://api.openf1.org/v1";

function makePagesUrl(relPath) {
  return `${PAGES_BASE}/${relPath.split(path.sep).join("/")}`;
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(url, headers = {}) {
  const { res, text } = await fetchText(url, { Accept: "application/json", ...headers });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return data;
}

async function fetchErgastWithFallback(p) {
  const attempts = [];
  for (const base of ERGAST_BASES) {
    const url = `${base}${p}`;
    try {
      const data = await fetchJson(url);
      return { data, url, attempts };
    } catch (e) {
      attempts.push({ url, error: e?.message || String(e) });
    }
  }
  throw new Error(`All Ergast sources failed for ${p}. Attempts=${JSON.stringify(attempts)}`);
}

async function getOpenF1HeadshotMap() {
  try {
    const sessions = await fetchJson(`${OPENF1_BASE}/sessions?session_key=latest`);
    const sessionKey = sessions?.[0]?.session_key;
    if (!sessionKey) return new Map();

    const drivers = await fetchJson(`${OPENF1_BASE}/drivers?session_key=${encodeURIComponent(sessionKey)}`);
    const map = new Map();
    for (const d of drivers) {
      if (d?.driver_number != null) map.set(Number(d.driver_number), d.headshot_url || null);
    }
    return map;
  } catch {
    return new Map();
  }
}

// ----- Dummy builders (Audi-style fields, all populated) -----

function dummyTeamStanding() {
  return {
    team: "Red Bull",
    position: "P2",
    points: 123,
    wins: 4,
    originalTeam: "Oracle Red Bull Racing",
  };
}

function dummyLastRace() {
  return {
    season: "2026",
    round: "3",
    raceName: "Gulf Air Bahrain Grand Prix 2026",
    date: "2026-03-29",
    timeUtc: "15:00:00Z",
    circuit: {
      name: "Bahrain International Circuit",
      locality: "Sakhir",
      country: "Bahrain",
    },
  };
}

function dummyBestResult(position, raceName, round, date, circuit) {
  return {
    position,
    raceName,
    round,
    date,
    circuit,
  };
}

function dummyDrivers() {
  return [
    {
      position: "P1",
      points: 58,
      wins: 2,
      firstName: "Max",
      lastName: "Verstappen",
      code: "VER",
      driverNumber: 1,
      team: "Red Bull",
      headshotUrl: "https://example.com/headshots/max_verstappen.png",
      placeholder: true,
      bestResult: dummyBestResult("P1", "Australian Grand Prix 2026", "1", "2026-03-08", "Albert Park Circuit"),
    },
    {
      position: "P15",
      points: 2,
      wins: 0,
      firstName: "Isack",
      lastName: "Hadjar",
      code: "HAD",
      driverNumber: 99,
      team: "Red Bull",
      headshotUrl: "https://example.com/headshots/isack_hadjar.png",
      placeholder: true,
      bestResult: dummyBestResult("P8", "Saudi Arabian Grand Prix 2026", "2", "2026-03-15", "Jeddah Corniche Circuit"),
    },
  ];
}

async function buildDummyJson() {
  const now = new Date();

  return {
    header: "Red Bull standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      // keep these fields so your widget doesn’t change later
      driverStandings: "DUMMY",
      constructorStandings: "DUMMY",
      lastRace: "DUMMY",
      openf1: "DUMMY",
    },
    meta: {
      mode: "DUMMY_DATA_FOR_WIDGET_BUILD",
      seasonUsed: "2026",
      roundUsed: "3",
      note: "All fields are populated with dummy data to help build the Widgy widget layout. Set DUMMY_MODE=false to switch to live data later.",
    },
    redbull: {
      team: "Red Bull",
      teamLogoPng: makePagesUrl(TEAMLOGO_PATH),
      teamStanding: dummyTeamStanding(),
    },
    lastRace: dummyLastRace(),
    drivers: dummyDrivers(),
  };
}

// ----- Live mode (optional later; keeps same output shape) -----

function teamNameFromDriverStandingRow(d) {
  const constructors = Array.isArray(d.Constructors) ? d.Constructors : [];
  return constructors[0]?.name || "";
}

function mapConstructorRow(row, forcedTeamName = "Red Bull") {
  if (!row) return null;
  return {
    team: forcedTeamName,
    position: row.position ? `P${row.position}` : null,
    points: row.points ? Number(row.points) : null,
    wins: row.wins ? Number(row.wins) : null,
    originalTeam: row?.Constructor?.name || null,
  };
}

function mapLastRaceInfo(race) {
  if (!race) return null;
  return {
    season: race.season || null,
    round: race.round || null,
    raceName: race.raceName || null,
    date: race.date || null,
    timeUtc: race.time || null,
    circuit: {
      name: race?.Circuit?.circuitName || null,
      locality: race?.Circuit?.Location?.locality || null,
      country: race?.Circuit?.Location?.country || null,
    },
  };
}

async function getLastRaceForSeason(seasonTag) {
  const { data, url } = await fetchErgastWithFallback(`/${seasonTag}/last/results.json`);
  const race = data?.MRData?.RaceTable?.Races?.[0] || null;
  return { race, source: url };
}

async function getDriverBestResultWithRace(seasonTag, driverId) {
  try {
    const { data } = await fetchErgastWithFallback(`/${seasonTag}/drivers/${driverId}/results.json?limit=500`);
    const races = data?.MRData?.RaceTable?.Races || [];

    let bestPos = null;
    let bestRace = null;

    for (const r of races) {
      const result = r?.Results?.[0];
      if (!result) continue;
      const pos = Number(result.position);
      if (!Number.isFinite(pos)) continue;

      if (bestPos === null || pos < bestPos) {
        bestPos = pos;
        bestRace = r;
      }
    }

    if (!bestRace) return null;

    return {
      position: `P${bestPos}`,
      raceName: bestRace.raceName || null,
      round: bestRace.round || null,
      date: bestRace.date || null,
      circuit: bestRace?.Circuit?.circuitName || null,
    };
  } catch {
    return null;
  }
}

async function buildLiveJson() {
  const now = new Date();
  const seasonTag = "current";

  const headshotMap = await getOpenF1HeadshotMap();

  // Driver standings
  const ds = await fetchErgastWithFallback(`/current/driverstandings.json`);
  const standings =
    ds.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];

  const redBullDrivers = standings.filter((d) => {
    const team = (teamNameFromDriverStandingRow(d) || "").toLowerCase();
    return team.includes("red bull");
  });

  // Constructor standings
  const cs = await fetchErgastWithFallback(`/${seasonTag}/constructorstandings.json`);
  const ctorList =
    cs.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  const ctorRow = ctorList.find((c) =>
    String(c?.Constructor?.name || "").toLowerCase().includes("red bull")
  );

  // Last race
  const lastRace = await getLastRaceForSeason(seasonTag);

  // Drivers output (force include Hadjar as second driver, placeholder if not found)
  const drivers = [];

  const d1 = redBullDrivers[0];
  if (d1?.Driver) {
    const dr = d1.Driver;
    const num = dr.permanentNumber ? Number(dr.permanentNumber) : null;
    drivers.push({
      position: d1.position ? `P${d1.position}` : null,
      points: d1.points ? Number(d1.points) : null,
      wins: d1.wins ? Number(d1.wins) : null,
      firstName: dr.givenName || "Max",
      lastName: dr.familyName || "Verstappen",
      code: dr.code || "VER",
      driverNumber: num,
      team: "Red Bull",
      headshotUrl: num != null ? headshotMap.get(num) || null : null,
      placeholder: false,
      bestResult: await getDriverBestResultWithRace(seasonTag, dr.driverId),
    });
  } else {
    drivers.push({
      position: null,
      points: null,
      wins: null,
      firstName: "Max",
      lastName: "Verstappen",
      code: "VER",
      driverNumber: 1,
      team: "Red Bull",
      headshotUrl: null,
      placeholder: true,
      bestResult: null,
    });
  }

  drivers.push({
    position: null,
    points: null,
    wins: null,
    firstName: "Isack",
    lastName: "Hadjar",
    code: "HAD",
    driverNumber: null,
    team: "Red Bull",
    headshotUrl: null,
    placeholder: true,
    bestResult: null,
  });

  return {
    header: "Red Bull standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      driverStandings: ds.url,
      constructorStandings: cs.url,
      lastRace: lastRace.source,
      openf1: OPENF1_BASE,
    },
    meta: {
      mode: "LIVE_DATA",
      seasonUsed: "current",
      roundUsed: ds.data?.MRData?.StandingsTable?.round ? String(ds.data.MRData.StandingsTable.round) : null,
      note: null,
    },
    redbull: {
      team: "Red Bull",
      teamLogoPng: makePagesUrl(TEAMLOGO_PATH),
      teamStanding: mapConstructorRow(ctorRow, "Red Bull"),
    },
    lastRace: mapLastRaceInfo(lastRace.race),
    drivers,
  };
}

async function updateRedBullStandings() {
  const out = DUMMY_MODE ? await buildDummyJson() : await buildLiveJson();

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON} (${out?.meta?.mode || "unknown"})`);
}

updateRedBullStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});