// UpdateAllTeamStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot";

const DRIVER_STANDINGS_FILE = "f1_driver_standings.json";
const CONSTRUCTOR_STANDINGS_FILE = "f1_constructors_standings.json";

const OPENF1_BASE = "https://api.openf1.org/v1";
const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const YEAR = new Date().getUTCFullYear();

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

const DRIVER_FIRSTNAME_OVERRIDES = {
  alexander: "alex",
};

const TEAMS = [
  {
    key: "redbull",
    displayName: "Red Bull",
    outputFile: "f1_redbull_standings.json",
    objectKey: "redBull",
    keywords: ["red bull"],
    logoFile: "2025_red-bull_color_v2.png",
  },
  {
    key: "ferrari",
    displayName: "Ferrari",
    outputFile: "f1_ferrari_standings.json",
    objectKey: "ferrari",
    keywords: ["ferrari"],
    logoFile: "2025_ferrari_color_v2.png",
  },
  {
    key: "mercedes",
    displayName: "Mercedes",
    outputFile: "f1_mercedes_standings.json",
    objectKey: "mercedes",
    keywords: ["mercedes"],
    logoFile: "2025_mercedes_color_v2.png",
  },
  {
    key: "mclaren",
    displayName: "McLaren",
    outputFile: "f1_mclaren_standings.json",
    objectKey: "mclaren",
    keywords: ["mclaren"],
    logoFile: "2025_mclaren_color_v2.png",
  },
  {
    key: "alpine",
    displayName: "Alpine",
    outputFile: "f1_alpine_standings.json",
    objectKey: "alpine",
    keywords: ["alpine"],
    logoFile: "2025_alpine_color_v2.png",
  },
  {
    key: "astonmartin",
    displayName: "Aston Martin",
    outputFile: "f1_astonmartin_standings.json",
    objectKey: "astonMartin",
    keywords: ["aston martin"],
    logoFile: "2025_aston-martin_color_v2.png",
  },
  {
    key: "williams",
    displayName: "Williams",
    outputFile: "f1_williams_standings.json",
    objectKey: "williams",
    keywords: ["williams"],
    logoFile: "2025_williams_color_v2.png",
  },
  {
    key: "haas",
    displayName: "Haas",
    outputFile: "f1_haas_standings.json",
    objectKey: "haas",
    keywords: ["haas"],
    logoFile: "2025_haas_color_v2.png",
  },
  {
    key: "audi",
    displayName: "Audi",
    outputFile: "f1_audi_standings.json",
    objectKey: "audi",
    keywords: ["audi"],
    logoFile: "audi_logo_colored.png",
  },
  {
    key: "cadillac",
    displayName: "Cadillac",
    outputFile: "f1_cadillac_standings.json",
    objectKey: "cadillac",
    keywords: ["cadillac"],
    logoFile: "2025_cadillac_color_v2.png",
  },
  {
    key: "vcarb",
    displayName: "VCARB",
    outputFile: "f1_vcarb_standings.json",
    objectKey: "vcarb",
    keywords: ["vcarb", "racing bulls", "visa cash app rb", "rb f1 team"],
    logoFile: "2025_vcarb_color_v2.png",
  },
];

/* -------------------------------- */
/* HELPERS */
/* -------------------------------- */

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberImage(num) {
  if (!num) return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${num}.png`;
}

async function headshot(first, last) {
  if (!first || !last) return null;

  let firstName = String(first).toLowerCase();
  if (DRIVER_FIRSTNAME_OVERRIDES[firstName]) {
    firstName = DRIVER_FIRSTNAME_OVERRIDES[firstName];
  }

  const file = `${slug(firstName)}-${slug(last)}.png`;
  return `${PAGES_BASE}/${HEADSHOTS_DIR}/${file}`;
}

function normalizePoints(val) {
  if (val === "-" || val === "" || val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStandingPosition(pos) {
  if (!pos) return "-";

  const p = String(pos).toUpperCase().trim();

  if (p === "P0") return "-";
  if (p === "DNF") return "DNF";
  if (p === "DNS") return "DNS";
  if (p === "DSQ") return "DSQ";

  const n = Number(p.replace(/^P/, ""));
  if (!Number.isFinite(n) || n <= 0) return "-";

  return `P${n}`;
}

function classificationFromOpenF1(row) {
  if (!row) return "-";

  if (row.dsq === true) return "DSQ";
  if (row.dns === true) return "DNS";
  if (row.dnf === true) return "DNF";

  const pos = Number(row.position);
  if (!Number.isFinite(pos) || pos <= 0) return "-";

  return `P${pos}`;
}

function normalizeLocation(input) {
  return {
    locality: input?.locality ?? input?.location?.locality ?? "-",
    country: input?.country ?? input?.location?.country ?? "-",
  };
}

function emptyBestResult(position = "-") {
  return {
    position,
    raceName: "-",
    round: "-",
    date: "-",
    circuit: "-",
    location: {
      locality: "-",
      country: "-",
    },
    sessionKey: null,
    meetingKey: null,
  };
}

function emptyLastRace() {
  return {
    raceName: "-",
    round: "-",
    date: "-",
    circuit: "-",
    location: {
      locality: "-",
      country: "-",
    },
  };
}

function normalizeRaceName(name) {
  const value = String(name || "").trim();
  return value || "-";
}

function dateOnly(value) {
  if (!value) return "-";
  const s = String(value);
  return s.includes("T") ? s.slice(0, 10) : s.slice(0, 10);
}

function bestResultFromSessionRow(row, session, raceMetaBySessionKey) {
  const raceMeta =
    raceMetaBySessionKey?.get(Number(row?.session_key ?? session?.session_key)) || null;

  return {
    position: classificationFromOpenF1(row),
    raceName: raceMeta?.raceName ?? session?.meeting_name ?? "-",
    round: raceMeta?.round ?? "-",
    date: raceMeta?.date ?? dateOnly(session?.date_start) ?? "-",
    circuit: raceMeta?.circuit ?? session?.circuit_short_name ?? "-",
    location: {
      locality: raceMeta?.locality ?? session?.location ?? "-",
      country: raceMeta?.country ?? session?.country_name ?? "-",
    },
    sessionKey: row?.session_key ?? session?.session_key ?? null,
    meetingKey: row?.meeting_key ?? session?.meeting_key ?? null,
  };
}

function bestResultFromBestFinish(best, raceMetaBySessionKey) {
  const raceMeta = raceMetaBySessionKey?.get(Number(best.sessionKey)) || null;

  return {
    position: `P${best.pos}`,
    raceName: raceMeta?.raceName ?? best.raceName ?? "-",
    round: raceMeta?.round ?? best.round ?? "-",
    date: raceMeta?.date ?? best.date ?? "-",
    circuit: raceMeta?.circuit ?? best.circuit ?? "-",
    location: {
      locality: raceMeta?.locality ?? best.locality ?? "-",
      country: raceMeta?.country ?? best.country ?? "-",
    },
    sessionKey: best.sessionKey,
    meetingKey: best.meetingKey,
  };
}

function isCompletedRaceSession(session) {
  if (!session) return false;
  if (String(session.session_name || "") !== "Race") return false;

  const end = new Date(session.date_end || session.date_start || 0).getTime();
  return Number.isFinite(end) && end > 0 && end <= Date.now();
}

function matchesTeamName(name, keywords) {
  const value = String(name || "").toLowerCase();
  return keywords.some((keyword) => value.includes(keyword));
}

/* -------------------------------- */
/* FETCH */
/* -------------------------------- */

async function fetchJson(url, { retries = 6 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
      redirect: "follow",
    });

    const text = await res.text();

    if (res.status === 404) return null;

    if (res.status === 429) {
      if (attempt === retries) {
        throw new Error(`HTTP 429 from ${url}\n${text}`);
      }
      const waitMs = 1200 + attempt * 700;
      console.warn(`429 for ${url}. Retrying in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
    }

    return JSON.parse(text);
  }

  throw new Error(`Failed to fetch ${url}`);
}

/* -------------------------------- */
/* READ LOCAL JSON */
/* -------------------------------- */

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* -------------------------------- */
/* JOLPICA LOOKUPS */
/* -------------------------------- */

async function getRaceScheduleForYear(year) {
  const data = await fetchJson(`${JOLPICA_BASE}/${year}.json`);
  const races = data?.MRData?.RaceTable?.Races || [];

  return races.map((race) => ({
    round: String(race?.round ?? "-"),
    raceName: normalizeRaceName(race?.raceName),
    date: race?.date ?? "-",
    circuit: race?.Circuit?.circuitName ?? "-",
    locality: race?.Circuit?.Location?.locality ?? "-",
    country: race?.Circuit?.Location?.country ?? "-",
  }));
}

async function getLastRaceMeta() {
  const data = await fetchJson(`${JOLPICA_BASE}/current/last/results.json`);
  const race = data?.MRData?.RaceTable?.Races?.[0];

  if (!race) return null;

  return {
    raceName: normalizeRaceName(race?.raceName),
    round: String(race?.round ?? "-"),
    date: race?.date ?? "-",
    circuit: race?.Circuit?.circuitName ?? "-",
    location: {
      locality: race?.Circuit?.Location?.locality ?? "-",
      country: race?.Circuit?.Location?.country ?? "-",
    },
  };
}

function mergeLastRace(existingLastRace, jolpicaLastRace) {
  const base = existingLastRace
    ? {
        ...existingLastRace,
        location: normalizeLocation(existingLastRace),
      }
    : emptyLastRace();

  if (!jolpicaLastRace) return base;

  return {
    ...base,
    raceName: jolpicaLastRace.raceName ?? base.raceName ?? "-",
    round: jolpicaLastRace.round ?? base.round ?? "-",
    date: jolpicaLastRace.date ?? base.date ?? "-",
    circuit: jolpicaLastRace.circuit ?? base.circuit ?? "-",
    location: {
      locality:
        jolpicaLastRace.location?.locality ?? base.location?.locality ?? "-",
      country:
        jolpicaLastRace.location?.country ?? base.location?.country ?? "-",
    },
  };
}

/* -------------------------------- */
/* OPENF1 SHARED LOOKUPS */
/* -------------------------------- */

async function getRaceSessionsForYear() {
  const [sessions, schedule] = await Promise.all([
    fetchJson(`${OPENF1_BASE}/sessions?year=${YEAR}&session_name=Race`),
    getRaceScheduleForYear(YEAR),
  ]);

  const raceSessions = (sessions || [])
    .filter(isCompletedRaceSession)
    .sort(
      (a, b) =>
        new Date(a.date_start || 0).getTime() -
        new Date(b.date_start || 0).getTime()
    );

  const sessionMap = new Map();
  const allowedKeys = new Set();
  const raceMetaBySessionKey = new Map();

  for (let i = 0; i < raceSessions.length; i += 1) {
    const s = raceSessions[i];
    const sessionKey = Number(s.session_key);

    sessionMap.set(sessionKey, s);
    allowedKeys.add(sessionKey);

    const scheduleRace = schedule[i];
    if (scheduleRace) {
      raceMetaBySessionKey.set(sessionKey, {
        round: scheduleRace.round,
        raceName: scheduleRace.raceName,
        date: scheduleRace.date,
        circuit: scheduleRace.circuit,
        locality: scheduleRace.locality,
        country: scheduleRace.country,
      });
    }
  }

  return { sessionMap, allowedKeys, raceMetaBySessionKey };
}

async function getBestResultsForDriverNumbers(driverNumbers) {
  const { sessionMap, allowedKeys, raceMetaBySessionKey } =
    await getRaceSessionsForYear();

  const best = {};
  const latestClassification = {};

  for (const driverNumber of driverNumbers) {
    if (!driverNumber) continue;

    const rows = await fetchJson(
      `${OPENF1_BASE}/session_result?driver_number=${encodeURIComponent(driverNumber)}`
    );

    const filtered = (rows || [])
      .filter((row) => allowedKeys.has(Number(row.session_key)))
      .sort((a, b) => Number(a.session_key) - Number(b.session_key));

    if (filtered.length > 0) {
      latestClassification[driverNumber] = filtered[filtered.length - 1];
    }

    for (const row of filtered) {
      const pos = Number(row.position);
      if (!Number.isFinite(pos) || pos <= 0) continue;

      const session = sessionMap.get(Number(row.session_key));
      const raceMeta = raceMetaBySessionKey.get(Number(row.session_key));

      if (!best[driverNumber] || pos < best[driverNumber].pos) {
        best[driverNumber] = {
          pos,
          raceName: raceMeta?.raceName ?? session?.meeting_name ?? "-",
          round: raceMeta?.round ?? "-",
          date: raceMeta?.date ?? dateOnly(session?.date_start) ?? "-",
          circuit: raceMeta?.circuit ?? session?.circuit_short_name ?? "-",
          locality: raceMeta?.locality ?? session?.location ?? "-",
          country: raceMeta?.country ?? session?.country_name ?? "-",
          sessionKey: row.session_key ?? null,
          meetingKey: row.meeting_key ?? session?.meeting_key ?? null,
        };
      }
    }

    await sleep(450);
  }

  return { best, latestClassification, sessionMap, raceMetaBySessionKey };
}

/* -------------------------------- */
/* TEAM BUILDERS */
/* -------------------------------- */

function getTeamDrivers(driverData, teamConfig) {
  return (driverData.drivers || []).filter((d) => {
    const teamA = d?.constructor?.name || "";
    const teamB = d?.constructor?.fullName || "";
    return (
      matchesTeamName(teamA, teamConfig.keywords) ||
      matchesTeamName(teamB, teamConfig.keywords)
    );
  });
}

function getTeamConstructor(constructorData, teamConfig) {
  const row = (constructorData.constructors || []).find((c) =>
    matchesTeamName(c.team, teamConfig.keywords)
  );

  if (!row) {
    return {
      team: teamConfig.displayName,
      position: "-",
      points: 0,
      wins: 0,
    };
  }

  return {
    team: teamConfig.displayName,
    position: normalizeStandingPosition(row.position),
    points: normalizePoints(row.points),
    wins: normalizePoints(row.wins),
  };
}

async function buildTeamJson(
  teamConfig,
  driverData,
  constructorData,
  bestResultsPack,
  lastRace
) {
  const teamDrivers = getTeamDrivers(driverData, teamConfig);
  const teamStanding = getTeamConstructor(constructorData, teamConfig);

  const {
    best: bestResults,
    latestClassification,
    sessionMap,
    raceMetaBySessionKey,
  } = bestResultsPack;

  const drivers = [];

  for (const d of teamDrivers) {
    const drv = d.driver || {};

    const first = drv.firstName || "-";
    const last = drv.lastName || "-";
    const num = drv.driverNumber || null;

    const best = bestResults[num];
    const latest = latestClassification[num];
    const latestSession = latest ? sessionMap.get(Number(latest.session_key)) : null;

    let bestResult = emptyBestResult();

    if (best) {
      bestResult = bestResultFromBestFinish(best, raceMetaBySessionKey);
    } else if (latest) {
      bestResult = bestResultFromSessionRow(
        latest,
        latestSession,
        raceMetaBySessionKey
      );
    }

    drivers.push({
      firstName: first,
      lastName: last,
      code: drv.code || "-",
      driverNumber: num,

      numberImageUrl: numberImage(num),
      headshotUrl: await headshot(first, last),

      position: normalizeStandingPosition(d.position),
      points: normalizePoints(d.points),
      wins: normalizePoints(d.wins),

      team: teamConfig.displayName,
      bestResult,
    });
  }

  return {
    header: `${teamConfig.displayName} standings`,
    generatedAtUtc: new Date().toISOString(),

    sources: {
      driverStandings: DRIVER_STANDINGS_FILE,
      constructorStandings: CONSTRUCTOR_STANDINGS_FILE,
      bestResults:
        "OpenF1 session_result + OpenF1 race sessions + Jolpica season schedule",
      lastRace: "Jolpica current/last/results.json",
    },

    [teamConfig.objectKey]: {
      team: teamConfig.displayName,
      teamLogoPng: `${PAGES_BASE}/${TEAMLOGOS_DIR}/${teamConfig.logoFile}`,
      teamStanding,
    },

    lastRace,

    drivers,
  };
}

/* -------------------------------- */
/* MAIN */
/* -------------------------------- */

async function updateAllTeamStandings() {
  const [driverData, constructorData] = await Promise.all([
    readJson(DRIVER_STANDINGS_FILE),
    readJson(CONSTRUCTOR_STANDINGS_FILE),
  ]);

  const allDriverNumbers = [
    ...new Set(
      (driverData.drivers || [])
        .map((d) => d?.driver?.driverNumber)
        .filter(Boolean)
    ),
  ];

  const [bestResultsPack, jolpicaLastRace] = await Promise.all([
    getBestResultsForDriverNumbers(allDriverNumbers),
    getLastRaceMeta(),
  ]);

  const mergedLastRace = mergeLastRace(constructorData.lastRace, jolpicaLastRace);

  for (const teamConfig of TEAMS) {
    const out = await buildTeamJson(
      teamConfig,
      driverData,
      constructorData,
      bestResultsPack,
      mergedLastRace
    );

    await fs.writeFile(
      teamConfig.outputFile,
      JSON.stringify(out, null, 2),
      "utf8"
    );

    console.log(`Wrote ${teamConfig.outputFile}`);
  }
}

updateAllTeamStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
