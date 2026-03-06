import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const JOLPICA =
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
  if (!first || !last) return null;
  return `${HEADSHOTS}/${slug(first)}-${slug(last)}.png`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
  });

  if (!res.ok)
    throw new Error(`HTTP ${res.status}`);

  return res.json();
}

async function readPrevious() {
  try {
    const raw = await fs.readFile(OUTPUT_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed?.drivers?.length)
      return parsed;
  } catch {}

  return null;
}

/* ---------------- jolpica ---------------- */

async function getStandings() {
  const json = await fetchJson(JOLPICA);

  const season =
    json?.MRData?.StandingsTable?.season;

  const rows =
    json?.MRData?.StandingsTable?.StandingsLists?.[0]
      ?.DriverStandings ?? [];

  if (!rows.length)
    throw new Error("No standings returned");

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

  return { season, drivers };
}

/* ---------------- main ---------------- */

async function updateStandings() {
  const now = new Date().toISOString();

  let data = null;

  /* ---- PRIMARY SOURCE ---- */

  try {
    data = await getStandings();
    console.log("Source: Jolpica");
  } catch (err) {
    console.warn("Jolpica failed:", err.message);
  }

  /* ---- FALLBACK: previous JSON ---- */

  if (!data) {
    const prev = await readPrevious();

    if (prev) {
      data = {
        season: prev.season,
        drivers: prev.drivers,
        source: "previous-file",
      };

      console.log("Source: previous JSON");
    }
  }

  /* ---- LAST RESORT ---- */

  if (!data) {
    data = {
      season: null,
      drivers: [],
      source: "placeholder",
    };

    console.warn("All sources failed");
  }

  const out = {
    header: `${data.season ?? "Current"} Driver Standings`,
    generatedAtUtc: now,
    season: data.season,
    source: data.source ?? "jolpica",
    drivers: data.drivers,
  };

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(out, null, 2)
  );

  console.log(
    `Wrote ${OUTPUT_FILE} drivers=${data.drivers.length}`
  );
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});