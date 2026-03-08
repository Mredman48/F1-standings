// updateAudiStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_audi_standings.json";

// Your own JSON files
const DRIVER_STANDINGS_FILE = "f1_driver_standings.json";
const CONSTRUCTOR_STANDINGS_FILE = "f1_constructors_standings.json";

// GitHub Pages base
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// Assets
const AUDI_LOGO_FILE = "audi_logo_colored.png";
const AUDI_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/${AUDI_LOGO_FILE}`;

// OpenF1 only for best race result this season
const OPENF1_BASE = "https://api.openf1.org/v1";
const YEAR = new Date().getUTCFullYear();

/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

function fmtPos(pos) {
  if (pos == null || pos === "-" || pos === "") return "-";
  const n = Number(pos);
  if (!Number.isFinite(n)) return "-";
  return `P${n}`;
}

function safeNumOrDash(x) {
  if (x == null || x === "" || x === "-") return "-";
  const n = Number(x);
  return Number.isFinite(n) ? n : "-";
}

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTeamName(name) {
  const key = normalizeKey(name);

  const map = {
    audi: "Audi",
    sauber: "Audi",
    "kick sauber": "Audi",
    "stake f1 team kick sauber": "Audi",
    "stake sauber": "Audi",
    "audi formula 1 team": "Audi",

    "red bull racing": "Red Bull",
    "oracle red bull racing": "Red Bull",

    "racing bulls": "VCARB",
    "visa cash app rb": "VCARB",
    "visa cash app rb f1 team": "VCARB",
    "rb f1 team": "VCARB",

    "haas f1 team": "Haas",
    "moneygram haas f1 team": "Haas",

    "alpine f1 team": "Alpine",
    "bwt alpine formula one team": "Alpine",

    "williams racing": "Williams",
    "aston martin aramco formula one team": "Aston Martin",
    "mercedes amg petronas formula one team": "Mercedes",
    "scuderia ferrari hp": "Ferrari",
    "mclaren formula 1 team": "McLaren",
    "cadillac formula 1 team": "Cadillac",
  };

  return map[key] || name || "-";
}

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getSavedHeadshotUrl({ firstName, lastName }) {
  if (!firstName || !lastName || firstName === "-" || lastName === "-") return null;

  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  }

  return null;
}

async function readJsonFileStrict(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

/* ------------------------------------------------ */
/* OPENF1 FETCH HELPERS */
/* ------------------------------------------------ */

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });

  const text = await res.text();
  return { res, text };
}

async function fetchOpenF1(path, { retries = 4 } = {}) {
  const url = `${OPENF1_BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { res, text } = await fetchText(url);

    if (res.status === 429) {
      const waitMs = 1200 + attempt * 1000;
      console.warn(`OpenF1 429 for ${url}. Waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
    }

    try {
      return { json: JSON.parse(text), urlUsed: url };
    } catch {
      throw new Error(`Invalid JSON from ${url}\n${text.slice(0, 200)}`);
    }
  }

  throw new Error(`OpenF1 rate limited too long for ${url}`);
}

/* ------------------------------------------------ */
/* LOCAL JSON EXTRACTORS */
/* ------------------------------------------------ */

function extractAudiDrivers(driverStandingsJson) {
  const rows = Array.isArray(driverStandingsJson?.drivers)
    ? driverStandingsJson.drivers
    : [];

  const audiRows = rows.filter((row) => {
    const teamA = normalizeTeamName(row?.constructor?.name);
    const teamB = normalizeTeamName(row?.constructor?.fullName);
    const teamC = normalizeTeamName(row?.team);
    return teamA === "Audi" || teamB === "Audi" || teamC === "Audi";
  });

  return audiRows
    .slice()
    .sort((a, b) => {
      const pa = Number(a?.positionNumber ?? 999);
      const pb = Number(b?.positionNumber ?? 999);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;

      const na = Number(a?.driver?.driverNumber ?? 999);
      const nb = Number(b?.driver?.driverNumber ?? 999);
      return na - nb;
    })
    .slice(0, 2);
}

function extractAudiConstructor(constructorStandingsJson) {
  const rows = Array.isArray(constructorStandingsJson?.constructors)
    ? constructorStandingsJson.constructors
    : [];

  return rows.find((row) => normalizeTeamName(row?.team) === "Audi") || null;
}

/* ------------------------------------------------ */
/* OPENF1 BEST RESULT THIS SEASON */
/* ------------------------------------------------ */

function isCompletedRaceSession(session) {
  if (!session) return false;
  if (String(session.session_name || "") !== "Race") return false;

  const end = new Date(session.date_end || session.date_start || 0).getTime();
  if (!Number.isFinite(end) || end <= 0) return false;

  return end <= Date.now();
}

async function getCompletedRaceSessionsThisSeason() {
  const resp = await fetchOpenF1(`/sessions?year=${YEAR}&session_name=Race`);
  const sessions = Array.isArray(resp.json) ? resp.json : [];

  return {
    sessions: sessions
      .filter(isCompletedRaceSession)
      .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()),
    urlUsed: resp.urlUsed,
  };
}

async function getBestRaceResultForDriver(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") {
    return {
      bestResult: {
        position: "-",
        positionNumber: null,
        raceName: "-",
        round: "-",
        date: "-",
        circuit: "-",
        location: { locality: "-", country: "-" },
        sessionKey: null,
        meetingKey: null,
      },
      sources: {
        sessions: null,
        sessionResults: [],
      },
    };
  }

  const { sessions, urlUsed: sessionsUrl } = await getCompletedRaceSessionsThisSeason();

  let best = null;
  const sessionResultUrls = [];

  for (const session of sessions) {
    const path = `/session_result?session_key=${encodeURIComponent(session.session_key)}`;
    const res = await fetchOpenF1(path);
    sessionResultUrls.push(res.urlUsed);

    const rows = Array.isArray(res.json) ? res.json : [];
    const row = rows.find((r) => Number(r?.driver_number) === Number(driverNumber));

    if (!row) continue;

    const pos = Number(row?.position);
    if (!Number.isFinite(pos)) continue;

    const candidate = {
      position: fmtPos(pos),
      positionNumber: pos,
      raceName: session?.meeting_name || "-",
      round: session?.meeting_key != null ? String(session.meeting_key) : "-",
      date: session?.date_start || "-",
      circuit: session?.circuit_short_name || "-",
      location: {
        locality: session?.location || "-",
        country: session?.country_name || "-",
      },
      sessionKey: session?.session_key ?? null,
      meetingKey: session?.meeting_key ?? null,
    };

    if (!best || pos < best.positionNumber) {
      best = candidate;
    }
  }

  return {
    bestResult:
      best || {
        position: "-",
        positionNumber: null,
        raceName: "-",
        round: "-",
        date: "-",
        circuit: "-",
        location: { locality: "-", country: "-" },
        sessionKey: null,
        meetingKey: null,
      },
    sources: {
      sessions: sessionsUrl,
      sessionResults: sessionResultUrls,
    },
  };
}

/* ------------------------------------------------ */
/* BUILD JSON */
/* ------------------------------------------------ */

async function buildJson() {
  const now = new Date();

  const [driverJson, constructorJson] = await Promise.all([
    readJsonFileStrict(DRIVER_STANDINGS_FILE),
    readJsonFileStrict(CONSTRUCTOR_STANDINGS_FILE),
  ]);

  const audiDriverRows = extractAudiDrivers(driverJson);
  const audiConstructor = extractAudiConstructor(constructorJson);

  const teamStanding = audiConstructor
    ? {
        team: "Audi",
        position: audiConstructor.position ?? "-",
        points: audiConstructor.points ?? "-",
        wins: audiConstructor.wins ?? "-",
        originalTeam: audiConstructor.team ?? "Audi",
      }
    : {
        team: "Audi",
        position: "-",
        points: "-",
        wins: "-",
        originalTeam: "-",
      };

  const lastRace = constructorJson?.lastRace
    ? constructorJson.lastRace
    : {
        season: "-",
        round: "-",
        raceName: "-",
        date: "-",
        timeUtc: "-",
        circuit: { name: "-", locality: "-", country: "-" },
        winner: { name: "-", team: "-", laps: "-" },
      };

  const drivers = [];
  const bestResultSources = [];

  for (const row of audiDriverRows) {
    const d = row?.driver || {};
    const firstName = d.firstName ?? "-";
    const lastName = d.lastName ?? "-";
    const code = d.code ?? "-";
    const driverNumber = d.driverNumber ?? "-";

    const headshotUrl =
      firstName !== "-" && lastName !== "-"
        ? await getSavedHeadshotUrl({ firstName, lastName })
        : null;

    const best = await getBestRaceResultForDriver(driverNumber);
    bestResultSources.push(best.sources);

    drivers.push({
      firstName,
      lastName,
      code,
      driverNumber,

      numberImageUrl: getDriverNumberImageUrl(driverNumber),
      headshotUrl,

      position: row?.position ?? "-",
      points: row?.points ?? "-",
      wins: row?.wins ?? "-",

      team: "Audi",
      placeholder: false,

      bestResult: {
        position: best.bestResult.position,
        raceName: best.bestResult.raceName,
        round: best.bestResult.round,
        date: best.bestResult.date,
        circuit: best.bestResult.circuit,
        location: best.bestResult.location,
        sessionKey: best.bestResult.sessionKey,
        meetingKey: best.bestResult.meetingKey,
      },

      source: "local-json",
    });
  }

  return {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      driverStandingsFile: DRIVER_STANDINGS_FILE,
      constructorStandingsFile: CONSTRUCTOR_STANDINGS_FILE,
      bestResultSource:
        "OpenF1 sessions + session_result (best classified race finish this season)",
      bestResultNotes:
        "Uses your own JSON for driver/team standings and only uses OpenF1 for each driver's best race result this season.",
      openf1Base: OPENF1_BASE,
      openf1BestResultLookups: bestResultSources,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
    },
    meta: {
      mode: "LOCAL_JSON_STANDINGS_OPENF1_BEST_RESULT",
      team: "Audi",
      driversFound: drivers.length,
      note:
        "Driver standings and team points come from your own JSON files. Best race result comes from OpenF1 session_result across completed race sessions in the current season.",
    },
    audi: {
      team: "Audi",
      teamLogoPng: AUDI_LOGO_PNG,
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateAudiStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});