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

/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function exists(path) {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function headshot(first, last) {
  if (!first || !last) return null;

  const file = `${slug(first)}-${slug(last)}.png`;
  const local = `${HEADSHOTS_DIR}/${file}`;

  if (await exists(local)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${file}`;
  }

  return null;
}

function numberImage(num) {
  if (!num) return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${num}.png`;
}

function safeNumOrZero(x) {
  if (x == null || x === "" || x === "-") return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------ */
/* FETCH */
/* ------------------------------------------------ */

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });

  const text = await res.text();

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return JSON.parse(text);
}

/* ------------------------------------------------ */
/* READ LOCAL JSON */
/* ------------------------------------------------ */

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* ------------------------------------------------ */
/* FIND AUDI DRIVERS */
/* ------------------------------------------------ */

function getAudiDrivers(driverData) {
  const rows = driverData?.drivers ?? [];

  return rows.filter((d) => {
    const team =
      d?.constructor?.name ||
      d?.constructor?.fullName ||
      "";

    return String(team).toLowerCase().includes("audi");
  });
}

/* ------------------------------------------------ */
/* FIND TEAM STANDING */
/* ------------------------------------------------ */

function getAudiConstructor(constructorData) {
  const rows = constructorData?.constructors ?? [];

  const row = rows.find((c) =>
    String(c.team || "").toLowerCase().includes("audi")
  );

  if (!row) {
    return {
      team: "Audi",
      position: "-",
      points: 0,
      wins: 0
    };
  }

  return {
    team: "Audi",
    position: row.position ?? "-",
    points: safeNumOrZero(row.points),
    wins: safeNumOrZero(row.wins)
  };
}

/* ------------------------------------------------ */
/* OPENF1 BEST RESULT (FAST VERSION) */
/* ------------------------------------------------ */

async function getBestResultsForDrivers(driverNumbers) {

  const sessions = await fetchJson(
    `${OPENF1_BASE}/sessions?year=${YEAR}&session_name=Race`
  );

  const sessionMap = new Map();

  for (const s of sessions || []) {
    sessionMap.set(s.session_key, s);
  }

  const results = await fetchJson(
    `${OPENF1_BASE}/session_result?year=${YEAR}`
  );

  const best = {};

  for (const row of results || []) {

    const num = row.driver_number;

    if (!driverNumbers.includes(num)) continue;

    const pos = Number(row.position);

    if (!Number.isFinite(pos)) continue;

    if (!best[num] || pos < best[num].pos) {

      const session = sessionMap.get(row.session_key);

      best[num] = {
        pos,
        raceName: session?.meeting_name ?? "-",
        circuit: session?.circuit_short_name ?? "-",
        locality: session?.location ?? "-",
        country: session?.country_name ?? "-"
      };
    }
  }

  return best;
}

/* ------------------------------------------------ */
/* BUILD JSON */
/* ------------------------------------------------ */

async function buildJson() {

  const driverData = await readJson(DRIVER_STANDINGS_FILE);
  const constructorData = await readJson(CONSTRUCTOR_STANDINGS_FILE);

  const audiDrivers = getAudiDrivers(driverData);
  const teamStanding = getAudiConstructor(constructorData);

  const driverNumbers = audiDrivers.map(
    (d) => d?.driver?.driverNumber
  );

  const bestResults = await getBestResultsForDrivers(driverNumbers);

  const drivers = [];

  for (const d of audiDrivers) {

    const drv = d.driver ?? {};

    const first = drv.firstName ?? "-";
    const last = drv.lastName ?? "-";
    const num = drv.driverNumber ?? null;

    const best = bestResults[num];

    drivers.push({

      firstName: first,
      lastName: last,
      code: drv.code ?? "-",
      driverNumber: num,

      numberImageUrl: numberImage(num),
      headshotUrl: await headshot(first, last),

      position: d.position ?? "-",
      points: safeNumOrZero(d.points),
      wins: safeNumOrZero(d.wins),

      team: "Audi",

      bestResult: best
        ? {
            position: `P${best.pos}`,
            raceName: best.raceName,
            circuit: best.circuit,
            location: {
              locality: best.locality,
              country: best.country
            }
          }
        : {
            position: "-",
            raceName: "-",
            circuit: "-",
            location: { locality: "-", country: "-" }
          }
    });
  }

  return {

    header: "Audi standings",
    generatedAtUtc: new Date().toISOString(),

    sources: {
      driverStandings: DRIVER_STANDINGS_FILE,
      constructorStandings: CONSTRUCTOR_STANDINGS_FILE,
      bestResults: "OpenF1 season race results"
    },

    audi: {
      team: "Audi",
      teamLogoPng: AUDI_LOGO,
      teamStanding
    },

    lastRace: constructorData.lastRace ?? null,

    drivers
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

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