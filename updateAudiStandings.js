// updateAudiStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot";

const OUT_JSON = "f1_audi_standings.json";

const DRIVER_STANDINGS_FILE = "f1_driver_standings.json";
const CONSTRUCTOR_STANDINGS_FILE = "f1_constructors_standings.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";

const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

const AUDI_LOGO_FILE = "audi_logo_colored.png";
const AUDI_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/${AUDI_LOGO_FILE}`;

const OPENF1_BASE = "https://api.openf1.org/v1";
const YEAR = new Date().getUTCFullYear();

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

async function getHeadshotUrl(first, last) {
  if (!first || !last) return null;

  const file = `${slug(first)}-${slug(last)}.png`;
  const local = `${HEADSHOTS_DIR}/${file}`;

  if (await exists(local)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${file}`;
  }

  return null;
}

function getDriverNumberImageUrl(num) {
  if (!num) return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${num}.png`;
}

function safeNumOrZero(x) {
  if (x == null || x === "" || x === "-") return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------ */
/* POSITION FORMATTER */
/* ------------------------------------------------ */

function formatPosition(row) {
  if (!row) return "-";

  if (row.dsq === true) return "DSQ";
  if (row.dns === true) return "DNS";
  if (row.dnf === true) return "DNF";

  const pos = Number(row.position);

  if (!Number.isFinite(pos) || pos <= 0) return "-";

  return `P${pos}`;
}

/* ------------------------------------------------ */
/* FETCH */
/* ------------------------------------------------ */

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA }
  });

  const text = await res.text();

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return JSON.parse(text);
}

/* ------------------------------------------------ */
/* READ JSON */
/* ------------------------------------------------ */

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* ------------------------------------------------ */
/* FIND AUDI DRIVERS */
/* ------------------------------------------------ */

function getAudiDrivers(data) {
  const rows = data?.drivers ?? [];

  return rows.filter(d => {
    const team =
      d?.constructor?.name ||
      d?.constructor?.fullName ||
      "";

    return String(team).toLowerCase().includes("audi");
  });
}

/* ------------------------------------------------ */
/* FIND AUDI CONSTRUCTOR */
/* ------------------------------------------------ */

function getAudiConstructor(data) {
  const rows = data?.constructors ?? [];

  const row = rows.find(c =>
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
/* BEST RESULT FROM OPENF1 */
/* ------------------------------------------------ */

async function getBestResult(driverNumber) {

  if (!driverNumber) {
    return {
      position: "-",
      raceName: "-",
      circuit: "-",
      location: { locality: "-", country: "-" }
    };
  }

  const sessions = await fetchJson(
    `${OPENF1_BASE}/sessions?year=${YEAR}&session_name=Race`
  );

  if (!sessions) {
    return {
      position: "-",
      raceName: "-",
      circuit: "-",
      location: { locality: "-", country: "-" }
    };
  }

  let best = null;

  for (const session of sessions) {

    const results = await fetchJson(
      `${OPENF1_BASE}/session_result?session_key=${session.session_key}`
    );

    if (!results) continue;

    const row = results.find(
      r => Number(r.driver_number) === Number(driverNumber)
    );

    if (!row) continue;

    const pos = Number(row.position);

    if (!Number.isFinite(pos)) continue;

    if (!best || pos < best.pos) {
      best = {
        pos,
        raceName: session.meeting_name,
        circuit: session.circuit_short_name,
        locality: session.location,
        country: session.country_name
      };
    }
  }

  if (!best) {
    return {
      position: "-",
      raceName: "-",
      circuit: "-",
      location: { locality: "-", country: "-" }
    };
  }

  return {
    position: `P${best.pos}`,
    raceName: best.raceName,
    circuit: best.circuit,
    location: {
      locality: best.locality,
      country: best.country
    }
  };
}

/* ------------------------------------------------ */
/* BUILD JSON */
/* ------------------------------------------------ */

async function buildJson() {

  const driverData = await readJson(DRIVER_STANDINGS_FILE);
  const constructorData = await readJson(CONSTRUCTOR_STANDINGS_FILE);

  const audiDrivers = getAudiDrivers(driverData);
  const teamStanding = getAudiConstructor(constructorData);

  const drivers = [];

  for (const d of audiDrivers) {

    const driver = d?.driver ?? {};

    const first = driver.firstName ?? "-";
    const last = driver.lastName ?? "-";
    const num = driver.driverNumber ?? null;

    const bestResult = await getBestResult(num);

    drivers.push({

      firstName: first,
      lastName: last,
      code: driver.code ?? "-",
      driverNumber: num,

      numberImageUrl: getDriverNumberImageUrl(num),
      headshotUrl: await getHeadshotUrl(first, last),

      position: d.position ?? "-",
      points: safeNumOrZero(d.points),
      wins: safeNumOrZero(d.wins),

      team: "Audi",

      bestResult
    });
  }

  return {

    header: "Audi standings",
    generatedAtUtc: new Date().toISOString(),

    sources: {
      driverStandings: DRIVER_STANDINGS_FILE,
      constructorStandings: CONSTRUCTOR_STANDINGS_FILE,
      bestResult: "OpenF1 race results"
    },

    audi: {
      team: "Audi",
      teamLogoPng: AUDI_LOGO_PNG,
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

updateAudiStandings().catch(err => {
  console.error(err);
  process.exit(1);
});