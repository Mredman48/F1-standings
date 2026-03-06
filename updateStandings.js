import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const OPENF1_URL =
  "https://api.openf1.org/v1/drivers";

const HEADSHOTS =
  "https://mredman48.github.io/F1-standings/headshots";

const UA = "f1-standings-bot";

/* ------------------------------------------------ */
/* DRIVER NAME FIXES FOR HEADSHOT FILES */
/* ------------------------------------------------ */

const DRIVER_SLUG_OVERRIDES = {
  alexander: "alex",   // Alex Albon
};

/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeFirstName(first) {
  if (!first) return first;

  const lower = first.toLowerCase();

  if (DRIVER_SLUG_OVERRIDES[lower]) {
    return DRIVER_SLUG_OVERRIDES[lower];
  }

  return lower;
}

function headshot(first, last) {
  if (!first || !last) return null;

  const firstSlug = slug(normalizeFirstName(first));
  const lastSlug = slug(last);

  return `${HEADSHOTS}/${firstSlug}-${lastSlug}.png`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}

/* ------------------------------------------------ */
/* BUILD DRIVER LIST */
/* ------------------------------------------------ */

function buildAlphabeticalDrivers(drivers) {
  const rows = drivers
    .map((d) => ({
      firstName: d.first_name,
      lastName: d.last_name,
      driverNumber: d.driver_number,
      team: d.team_name,
    }))
    .filter((d) => d.firstName && d.lastName);

  rows.sort((a, b) =>
    a.lastName.localeCompare(b.lastName)
  );

  return rows.map((d) => ({
    position: "-",
    positionNumber: null,
    points: "-",
    wins: "-",

    driver: {
      firstName: d.firstName,
      lastName: d.lastName,
      fullName: `${d.firstName} ${d.lastName}`,
      driverNumber: d.driverNumber ?? null,
      headshotUrl: headshot(d.firstName, d.lastName),
    },

    constructor: {
      name: d.team ?? null,
    },
  }));
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();

  let drivers = [];
  let mode = "LIVE";

  try {
    const data = await fetchJson(OPENF1_URL);

    if (!Array.isArray(data) || !data.length) {
      throw new Error("OpenF1 returned no drivers");
    }

    drivers = buildAlphabeticalDrivers(data);

    console.log("Source: OpenF1");
  } catch (err) {
    console.warn("OpenF1 unavailable:", err.message);

    mode = "PLACEHOLDER";

    try {
      const fallback = await fetchJson(
        "https://api.openf1.org/v1/drivers"
      );

      drivers = buildAlphabeticalDrivers(fallback);

      console.log("Source: fallback alphabetical list");
    } catch {
      console.warn("Fallback also failed");
    }
  }

  const out = {
    header: "Driver Standings",
    generatedAtUtc: now,
    mode,
    drivers,
  };

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(out, null, 2)
  );

  console.log(
    `Wrote ${OUTPUT_FILE} drivers=${drivers.length}`
  );
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});