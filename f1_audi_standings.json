// updateAudiStandings.js
import fs from "node:fs/promises";
import path from "node:path";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Ergast-compatible sources
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// OpenF1 (headshots)
const OPENF1_BASE = "https://api.openf1.org/v1";

// Your GitHub Pages base (update if needed)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Where we save PNG logos (must be committed)
const TEAMLOGO_DIR = "teamlogos";

// ✅ Colored Audi logo PNG (your chosen source)
const STATIC_AUDI_LOGO_PNG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Audif1.com_logo17_%28cropped%29.svg/1920px-Audif1.com_logo17_%28cropped%29.svg.png";

// Output files
const OUT_JSON = "f1_audi_standings.json";
const OUT_LOGO_PNG = `${TEAMLOGO_DIR}/audi_logo_colored.png`;

// What counts as “Kick Sauber” historically
const SAUBER_MATCHERS = [
  "stake f1 team kick sauber",
  "kick sauber",
  "stake f1 team",
  "stake",
  "sauber",
  "alfa romeo",
];

function safeGet(obj, pathArr) {
  return pathArr.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

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
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return data;
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
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
  throw new Error(`All Ergast fetch attempts failed: ${JSON.stringify(attempts, null, 2)}`);
}

function teamMatchesAny(teamName, matchers) {
  const t = String(teamName || "").toLowerCase();
  return matchers.some((m) => t.includes(String(m).toLowerCase()));
}

function teamNameFromDriverStandingRow(d) {
  const constructors = Array.isArray(d.Constructors) ? d.Constructors : [];
  return constructors[0]?.name || "";
}

/* -------------------- Audi logo: ensure it exists as PNG in repo -------------------- */

async function buildAudiLogoPngIfMissing() {
  try {
    await fs.access(OUT_LOGO_PNG);
    return { ok: true, pngUrl: makePagesUrl(OUT_LOGO_PNG), note: "cached" };
  } catch {
    // continue
  }

  await ensureDir(TEAMLOGO_DIR);

  const pngBuf = await fetchBuffer(STATIC_AUDI_LOGO_PNG);
  await fs.writeFile(OUT_LOGO_PNG, pngBuf);

  return { ok: true, pngUrl: makePagesUrl(OUT_LOGO_PNG), note: "static_wikipedia_png" };
}

/* -------------------- OpenF1 headshots (best-effort) -------------------- */

async function getOpenF1HeadshotMap() {
  try {
    const sessions = await fetchJson(`${OPENF1_BASE}/sessions?session_key=latest`);
    const sessionKey = Array.isArray(sessions) ? sessions[0]?.session_key : null;
    if (!sessionKey) return new Map();

    const drivers = await fetchJson(
      `${OPENF1_BASE}/drivers?session_key=${encodeURIComponent(sessionKey)}`
    );

    const map = new Map();
    if (Array.isArray(drivers)) {
      for (const d of drivers) {
        if (d?.driver_number != null) map.set(Number(d.driver_number), d.headshot_url || null);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/* -------------------- Ergast helpers -------------------- */

function parseDriverStandings(payload) {
  const list =
    safeGet(payload, ["MRData", "StandingsTable", "StandingsLists", 0, "DriverStandings"]) || [];
  const season = safeGet(payload, ["MRData", "StandingsTable", "season"]) || null;
  const round = safeGet(payload, ["MRData", "StandingsTable", "round"]) || null;
  const total = Number(payload?.MRData?.total || 0);
  return { list: Array.isArray(list) ? list : [], season, round, total };
}

async function getDriverStandingsForSeason(seasonTag) {
  const { data, url } = await fetchErgastWithFallback(`/${seasonTag}/driverstandings.json`);
  const parsed = parseDriverStandings(data);
  return { ...parsed, source: url, seasonTag: String(seasonTag) };
}

function parseConstructorStandings(payload) {
  const list =
    safeGet(payload, ["MRData", "StandingsTable", "StandingsLists", 0, "ConstructorStandings"]) ||
    [];
  const season = safeGet(payload, ["MRData", "StandingsTable", "season"]) || null;
  const round = safeGet(payload, ["MRData", "StandingsTable", "round"]) || null;
  const total = Number(payload?.MRData?.total || 0);
  return { list: Array.isArray(list) ? list : [], season, round, total };
}

async function getConstructorStandingsForSeason(seasonTag) {
  const { data, url } = await fetchErgastWithFallback(`/${seasonTag}/constructorstandings.json`);
  const parsed = parseConstructorStandings(data);
  return { ...parsed, source: url, seasonTag: String(seasonTag) };
}

async function getLastRaceForSeason(seasonTag) {
  const { data, url } = await fetchErgastWithFallback(`/${seasonTag}/last/results.json`);
  const race = safeGet(data, ["MRData", "RaceTable", "Races", 0]) || null;
  return { race, source: url };
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

/**
 * ✅ Return both:
 * - best finishing position
 * - the race where it happened (raceName, round, date, circuit)
 */
async function getDriverBestFinishWithRace(seasonTag, driverId) {
  try {
    const { data } = await fetchErgastWithFallback(
      `/${seasonTag}/drivers/${driverId}/results.json?limit=500`
    );

    const races = safeGet(data, ["MRData", "RaceTable", "Races"]) || [];

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

    if (bestPos === null || !bestRace) return null;

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

function mapDriverStanding(d, headshotMap, options = {}) {
  const driver = d.Driver || {};
  const originalTeam = teamNameFromDriverStandingRow(d) || null;
  const num = driver.permanentNumber ? Number(driver.permanentNumber) : null;

  const obj = {
    driverId: driver.driverId || null,
    position: d.position ? `P${d.position}` : null,
    points: d.points ? Number(d.points) : null,
    wins: d.wins ? Number(d.wins) : null,
    firstName: driver.givenName || null,
    lastName: driver.familyName || null,
    code: driver.code || null,
    driverNumber: num,
    team: options.teamOverride || originalTeam,
    headshotUrl: num != null ? headshotMap.get(num) || null : null,
    placeholder: Boolean(options.placeholder),
    bestFinish: null, // will be filled later
  };

  if (options.includeOriginalTeam) obj.originalTeam = originalTeam;
  return obj;
}

function findConstructorRow(list, matchers) {
  const row = (list || []).find((c) => {
    const name = c?.Constructor?.name || "";
    return teamMatchesAny(name, matchers);
  });
  return row || null;
}

function mapConstructorRow(row, forcedTeamName = "Audi") {
  if (!row) return null;
  return {
    team: forcedTeamName,
    position: row.position ? `P${row.position}` : null,
    points: row.points ? Number(row.points) : null,
    wins: row.wins ? Number(row.wins) : null,
    originalTeam: row?.Constructor?.name || null,
  };
}

/* -------------------- main -------------------- */

async function updateAudiStandings() {
  const now = new Date();
  const prevYear = String(now.getUTCFullYear() - 1);

  // Logo
  const audiLogo = await buildAudiLogoPngIfMissing();

  // Headshots
  const headshotMap = await getOpenF1HeadshotMap();

  // Current season drivers
  const currentDrivers = await getDriverStandingsForSeason("current");

  const audiDriversCurrent = currentDrivers.list
    .filter((d) => teamMatchesAny(teamNameFromDriverStandingRow(d), ["audi"]))
    .map((d) => mapDriverStanding(d, headshotMap, { teamOverride: "Audi" }));

  let driversOut;
  let seasonUsed;
  let roundUsed;
  let mode;
  let driverStandingsSource;

  if (audiDriversCurrent.length > 0) {
    driversOut = audiDriversCurrent;
    seasonUsed = currentDrivers.seasonTag; // "current"
    roundUsed = currentDrivers.round ? String(currentDrivers.round) : null;
    mode = "AUDI_LIVE_FROM_CURRENT_SEASON";
    driverStandingsSource = currentDrivers.source;
  } else {
    const lastYearDrivers = await getDriverStandingsForSeason(prevYear);

    const sauberDrivers = lastYearDrivers.list
      .filter((d) => teamMatchesAny(teamNameFromDriverStandingRow(d), SAUBER_MATCHERS))
      .map((d) =>
        mapDriverStanding(d, headshotMap, {
          teamOverride: "Audi",
          includeOriginalTeam: true,
          placeholder: true,
        })
      );

    driversOut = sauberDrivers;
    seasonUsed = prevYear;
    roundUsed = lastYearDrivers.round ? String(lastYearDrivers.round) : null;
    mode = "AUDI_PLACEHOLDERS_FROM_KICK_SAUBER_LAST_YEAR";
    driverStandingsSource = lastYearDrivers.source;

    if (!driversOut || driversOut.length === 0) {
      driversOut = [
        {
          driverId: null,
          position: "P?",
          points: 0,
          wins: 0,
          firstName: "Audi",
          lastName: "Driver 1",
          code: null,
          driverNumber: null,
          team: "Audi",
          headshotUrl: null,
          placeholder: true,
          originalTeam: null,
          bestFinish: null,
        },
        {
          driverId: null,
          position: "P?",
          points: 0,
          wins: 0,
          firstName: "Audi",
          lastName: "Driver 2",
          code: null,
          driverNumber: null,
          team: "Audi",
          headshotUrl: null,
          placeholder: true,
          originalTeam: null,
          bestFinish: null,
        },
      ];
    }
  }

  // Constructor standings for seasonUsed
  const ctor = await getConstructorStandingsForSeason(seasonUsed);
  const ctorRow =
    mode === "AUDI_LIVE_FROM_CURRENT_SEASON"
      ? findConstructorRow(ctor.list, ["audi"])
      : findConstructorRow(ctor.list, SAUBER_MATCHERS);

  const teamStanding = mapConstructorRow(ctorRow, "Audi");

  // Last race info for seasonUsed
  const lastRace = await getLastRaceForSeason(seasonUsed);
  const lastRaceInfo = mapLastRaceInfo(lastRace.race);

  // ✅ Best finish + race info per driver
  for (const d of driversOut) {
    if (d?.driverId) {
      d.bestFinish = await getDriverBestFinishWithRace(seasonUsed, d.driverId);
    } else {
      d.bestFinish = null;
    }
  }

  const out = {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      audiLogoSourcePng: STATIC_AUDI_LOGO_PNG,
      ergastBases: ERGAST_BASES,
      driverStandings: driverStandingsSource,
      constructorStandings: ctor.source,
      lastRace: lastRace.source,
    },
    meta: {
      mode,
      seasonUsed: String(seasonUsed),
      roundUsed,
      note:
        mode === "AUDI_PLACEHOLDERS_FROM_KICK_SAUBER_LAST_YEAR"
          ? "Audi not present in current standings yet; using Kick Sauber drivers + constructor data from last year as placeholders (team label forced to Audi)."
          : null,
    },
    audi: {
      team: "Audi",
      teamLogoPng: audiLogo.ok ? audiLogo.pngUrl : null,
      teamLogoLocalPath: OUT_LOGO_PNG,
      teamStanding,
    },
    lastRace: lastRaceInfo,
    drivers: driversOut,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON} (${mode})`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});