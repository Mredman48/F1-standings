import fs from "node:fs/promises";

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

/* -------------------------------- */
/* FORCE NORMALIZATION */
/* -------------------------------- */

function normalizePoints(val) {

  if (val === "-" || val === "" || val === null || val === undefined) {
    return 0;
  }

  const n = Number(val);

  return Number.isFinite(n) ? n : 0;
}

function normalizeStandingPosition(pos) {

  if (!pos) return "-";

  const p = String(pos).toUpperCase();

  if (p === "P0") return "-";

  if (p === "DNF") return "DNF";
  if (p === "DNS") return "DNS";
  if (p === "DSQ") return "DSQ";

  const n = Number(p.replace("P", ""));

  if (!Number.isFinite(n) || n <= 0) return "-";

  return `P${n}`;
}

function classificationFromOpenF1(row) {

  if (!row) return "-";

  if (row.dns === true) return "DNS";
  if (row.dnf === true) return "DNF";
  if (row.dsq === true) return "DSQ";

  const pos = Number(row.position);

  if (!Number.isFinite(pos) || pos <= 0) return "-";

  return `P${pos}`;
}

/* -------------------------------- */
/* FETCH */
/* -------------------------------- */

async function fetchJson(url) {

  const res = await fetch(url);
  const text = await res.text();

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return JSON.parse(text);
}

/* -------------------------------- */
/* READ JSON */
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
      wins: 0
    };
  }

  return {

    team: "Audi",
    position: normalizeStandingPosition(row.position),
    points: normalizePoints(row.points),
    wins: normalizePoints(row.wins)
  };
}

/* -------------------------------- */
/* BEST RESULTS FROM OPENF1 */
/* -------------------------------- */

async function getBestResults(driverNumbers) {

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

    if (!Number.isFinite(pos) || pos <= 0) continue;

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

/* -------------------------------- */
/* BUILD JSON */
/* -------------------------------- */

async function buildJson() {

  const driverData = await readJson(DRIVER_STANDINGS_FILE);
  const constructorData = await readJson(CONSTRUCTOR_STANDINGS_FILE);

  const audiDrivers = getAudiDrivers(driverData);

  const teamStanding = getAudiConstructor(constructorData);

  const driverNumbers = audiDrivers.map(
    (d) => d?.driver?.driverNumber
  );

  const bestResults = await getBestResults(driverNumbers);

  const drivers = [];

  for (const d of audiDrivers) {

    const drv = d.driver || {};

    const first = drv.firstName || "-";
    const last = drv.lastName || "-";
    const num = drv.driverNumber || null;

    const best = bestResults[num];

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
            location: {
              locality: "-",
              country: "-"
            }
          }
    });
  }

  return {

    header: "Audi standings",
    generatedAtUtc: new Date().toISOString(),

    audi: {
      team: "Audi",
      teamLogoPng: AUDI_LOGO,
      teamStanding
    },

    lastRace: constructorData.lastRace ?? null,

    drivers
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