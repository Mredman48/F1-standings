import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const F1_API =
  "https://api.formula1.com/v1/standings/drivers?season=2026";

const JOLPICA_API =
  "https://api.jolpi.ca/ergast/f1/current/driverstandings.json";

const HEADSHOTS =
  "https://mredman48.github.io/F1-standings/headshots";

const UA = "f1-standings-bot";

/* ---------------- helpers ---------------- */

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function headshot(first, last) {
  return `${HEADSHOTS}/${slug(first)}-${slug(last)}.png`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });

  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${url}`);

  return res.json();
}

async function readPrevious() {
  try {
    const raw = await fs.readFile(OUTPUT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.drivers?.length) return parsed;
  } catch {}

  return null;
}

/* ---------------- source 1 : F1 API ---------------- */

async function fromF1API() {
  const json = await fetchJson(F1_API);

  const rows = json?.standings ?? [];
  if (!rows.length) throw new Error("F1 API empty");

  const drivers = rows.map((d) => {
    const first = d.driver.firstName;
    const last = d.driver.lastName;

    return {
      position: `P${d.position}`,
      positionNumber: d.position,
      points: d.points,
      wins: d.wins ?? 0,

      driver: {
        code: d.driver.code ?? null,
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`,
        nationality: d.driver.nationality,
        driverNumber: d.driver.number,
        headshotUrl: headshot(first, last),
      },

      constructor: {
        name: d.team.name,
        nationality: d.team.nationality,
      },
    };
  });

  return {
    season: json.season,
    drivers,
    source: "f1-api",
  };
}

/* ---------------- source 2 : Jolpica ---------------- */

async function fromJolpica() {
  const json = await fetchJson(JOLPICA_API);

  const season =
    json?.MRData?.StandingsTable?.season;

  const rows =
    json?.MRData?.StandingsTable?.StandingsLists?.[0]
      ?.DriverStandings ?? [];

  if (!rows.length)
    throw new Error("Jolpica empty");

  const drivers = rows.map((d) => {
    const ctor = d.Constructors?.[0];

    const first = d.Driver.givenName;
    const last = d.Driver.familyName;

    return {
      position: `P${d.position}`,
      positionNumber: Number(d.position),
      points: Number(d.points),
      wins: Number(d.wins),

      driver: {
        code: d.Driver.code ?? null,
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`,
        nationality: d.Driver.nationality,
        headshotUrl: headshot(first, last),
      },

      constructor: {
        name: ctor?.name,
        nationality: ctor?.nationality,
      },
    };
  });

  return {
    season,
    drivers,
    source: "jolpica",
  };
}

/* ---------------- main ---------------- */

async function updateStandings() {
  const now = new Date().toISOString();

  let result = null;

  /* source 1 */

  try {
    result = await fromF1API();
    console.log("Standings source: F1 API");
  } catch (err) {
    console.warn("F1 API failed:", err.message);
  }

  /* source 2 */

  if (!result) {
    try {
      result = await fromJolpica();
      console.log("Standings source: Jolpica");
    } catch (err) {
      console.warn("Jolpica failed:", err.message);
    }
  }

  /* source 3 */

  if (!result) {
    const prev = await readPrevious();

    if (prev) {
      result = {
        ...prev,
        source: "previous-file",
      };

      console.log("Standings source: previous file");
    }
  }

  /* placeholder */

  if (!result) {
    result = {
      season: null,
      drivers: [],
      source: "placeholder",
    };
  }

  const out = {
    header: `${result.season ?? "Current"} Driver Standings`,
    generatedAtUtc: now,
    season: result.season,
    source: result.source,
    drivers: result.drivers,
  };

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(out, null, 2)
  );

  console.log(
    `Wrote ${OUTPUT_FILE} source=${result.source}`
  );
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});