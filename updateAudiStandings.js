// updateAudiStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot";

const OUT_JSON = "f1_audi_standings.json";

const DRIVER_STANDINGS_FILE = "f1_driver_standings.json";
const CONSTRUCTOR_STANDINGS_FILE = "f1_constructors_standings.json";

const OPENF1_BASE = "https://api.openf1.org/v1";
const YEAR = new Date().getUTCFullYear();

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

const AUDI_LOGO = `${PAGES_BASE}/${TEAMLOGOS_DIR}/audi_logo_colored.png`;

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

function numberImage(num) {
  if (!num) return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${num}.png`;
}

async function headshot(first, last) {
  if (!first || !last) return null;
  const file = `${slug(first)}-${slug(last)}.png`;
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

function bestResultFromSessionRow(row, session) {
  return {
    position: classificationFromOpenF1(row),
    raceName: session?.meeting_name ?? "-",
    round: session?.meeting_key != null ? String(session.meeting_key) : "-",
    date: session?.date_start ?? "-",
    circuit: session?.circuit_short_name ?? "-",
    location: {
      locality: session?.location ?? "-",
      country: session?.country_name ?? "-",
    },
    sessionKey: row?.session_key ?? session?.session_key ?? null,
    meetingKey: row?.meeting_key ?? session?.meeting_key ?? null,
  };
}

function bestResultFromBestFinish(best) {
  return {
    position: `P${best.pos}`,
    raceName: best.raceName,
    round: best.round,
    date: best.date,
    circuit: best.circuit,
    location: {
      locality: best.locality,
      country: best.country,
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

/* -------------------------------- */
/* FETCH */
/* -------------------------------- */

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
    redirect: "follow",
  });

  const text = await res.text();

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return JSON.parse(text);
}

/* -------------------------------- */
/* READ LOCAL JSON */
/* -------------------------------- */

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* -------------------------------- */
/* FIND AUDI DRIVERS */
/* -------------------------------- */

function getAudiDrivers(driverData) {
  return (driverData.drivers || []).filter((d) => {
    const team =
      d?.constructor?.name ||
      d?.constructor?.fullName ||
      "";
    return team.toLowerCase().includes("audi");
  });
}

/* -------------------------------- */
/* TEAM STANDING */
/* -------------------------------- */

function getAudiConstructor(constructorData) {
  const row = (constructorData.constructors || []).find((c) =>
    String(c.team || "").toLowerCase().includes("audi")
  );

  if (!row) {
    return {
      team: "Audi",
      position: "-",
      points: 0,
      wins: 0,
    };
  }

  return {
    team: "Audi",
    position: normalizeStandingPosition(row.position),
    points: normalizePoints(row.points),
    wins: normalizePoints(row.wins),
  };
}

/* -------------------------------- */
/* BEST RESULTS FROM OPENF1 */
/* -------------------------------- */

async function getRaceSessionsForYear() {
  const sessions = await fetchJson(
    `${OPENF1_BASE}/sessions?year=${YEAR}&session_name=Race`
  );

  const raceSessions = (sessions || [])
    .filter(isCompletedRaceSession)
    .sort(
      (a, b) =>
        new Date(a.date_start || 0).getTime() - new Date(b.date_start || 0).getTime()
    );

  const sessionMap = new Map();
  const allowedKeys = new Set();

  for (const s of raceSessions) {
    sessionMap.set(Number(s.session_key), s);
    allowedKeys.add(Number(s.session_key));
  }

  return { sessionMap, allowedKeys };
}

async function getBestResults(driverNumbers) {
  const { sessionMap, allowedKeys } = await getRaceSessionsForYear();

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

      if (!best[driverNumber] || pos < best[driverNumber].pos) {
        best[driverNumber] = {
          pos,
          raceName: session?.meeting_name ?? "-",
          round: session?.meeting_key != null ? String(session.meeting_key) : "-",
          date: session?.date_start ?? "-",
          circuit: session?.circuit_short_name ?? "-",
          locality: session?.location ?? "-",
          country: session?.country_name ?? "-",
          sessionKey: row.session_key ?? null,
          meetingKey: row.meeting_key ?? session?.meeting_key ?? null,
        };
      }
    }
  }

  return { best, latestClassification, sessionMap };
}

/* -------------------------------- */
/* BUILD JSON */
/* -------------------------------- */

async function buildJson() {
  const driverData = await readJson(DRIVER_STANDINGS_FILE);
  const constructorData = await readJson(CONSTRUCTOR_STANDINGS_FILE);

  const audiDrivers = getAudiDrivers(driverData);
  const teamStanding = getAudiConstructor(constructorData);

  const driverNumbers = audiDrivers.map((d) => d?.driver?.driverNumber);
  const { best: bestResults, latestClassification, sessionMap } =
    await getBestResults(driverNumbers);

  const drivers = [];

  for (const d of audiDrivers) {
    const drv = d.driver || {};

    const first = drv.firstName || "-";
    const last = drv.lastName || "-";
    const num = drv.driverNumber || null;

    const best = bestResults[num];
    const latest = latestClassification[num];
    const latestSession = latest ? sessionMap.get(Number(latest.session_key)) : null;

    let bestResult = emptyBestResult();

    if (best) {
      bestResult = bestResultFromBestFinish(best);
    } else if (latest) {
      bestResult = bestResultFromSessionRow(latest, latestSession);
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

      team: "Audi",

      bestResult,
    });
  }

  return {
    header: "Audi standings",
    generatedAtUtc: new Date().toISOString(),

    sources: {
      driverStandings: DRIVER_STANDINGS_FILE,
      constructorStandings: CONSTRUCTOR_STANDINGS_FILE,
      bestResults:
        "OpenF1 sessions?year=YYYY&session_name=Race + session_result?driver_number=NN",
    },

    audi: {
      team: "Audi",
      teamLogoPng: AUDI_LOGO,
      teamStanding,
    },

    lastRace: constructorData.lastRace ?? null,

    drivers,
  };
}

/* -------------------------------- */
/* MAIN */
/* -------------------------------- */

async function updateAudiStandings() {
  const out = await buildJson();

  await fs.writeFile(
    OUT_JSON,
    JSON.stringify(out, null, 2),
    "utf8"
  );

  console.log(`Wrote ${OUT_JSON}`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});