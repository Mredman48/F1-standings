import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const JOLPICA_URL =
  "https://api.jolpi.ca/ergast/f1/current/driverstandings.json";

const F1_RESULTS_URL =
  "https://www.formula1.com/en/results.html/2026/drivers.html";

const HEADSHOTS_BASE =
  "https://mredman48.github.io/F1-standings/headshots";

const UA = "f1-standings-bot";

/* ------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------ */

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function headshotUrl(first, last) {
  if (!first || !last) return null;
  return `${HEADSHOTS_BASE}/${slug(first)}-${slug(last)}.png`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const txt = await fetchText(url);
  return JSON.parse(txt);
}

async function readPreviousFile() {
  try {
    const raw = await fs.readFile(OUTPUT_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed?.drivers?.length) return parsed;
  } catch {}

  return null;
}

/* ------------------------------------------------ */
/* Source 1 — Jolpica */
/* ------------------------------------------------ */

async function getStandingsFromJolpica() {
  const json = await fetchJson(JOLPICA_URL);

  const season =
    json?.MRData?.StandingsTable?.season ?? null;

  const rows =
    json?.MRData?.StandingsTable?.StandingsLists?.[0]
      ?.DriverStandings ?? [];

  if (!rows.length) throw new Error("No Jolpica standings");

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
        nationality: d.Driver.nationality ?? null,
        headshotUrl: headshotUrl(first, last),
      },

      constructor: {
        name: ctor?.name ?? null,
        nationality: ctor?.nationality ?? null,
      },
    };
  });

  return {
    season,
    drivers,
    source: "jolpica",
  };
}

/* ------------------------------------------------ */
/* Source 2 — F1.com scrape */
/* ------------------------------------------------ */

function parseDriversFromHtml(html) {
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)];

  const drivers = [];

  for (const row of rows) {
    const text = row[0];

    const pos = text.match(/<td[^>]*class="dark"[^>]*>(\d+)<\/td>/);
    if (!pos) continue;

    const nameMatch =
      text.match(/<span class="hide-for-tablet">([^<]+)/);

    const lastMatch =
      text.match(/<span class="hide-for-mobile">([^<]+)/);

    const pts =
      text.match(/<td[^>]*class="bold"[^>]*>(\d+)<\/td>/);

    if (!nameMatch || !lastMatch) continue;

    const first = nameMatch[1].trim();
    const last = lastMatch[1].trim();

    drivers.push({
      position: `P${pos[1]}`,
      positionNumber: Number(pos[1]),
      points: Number(pts?.[1] ?? 0),

      driver: {
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`,
        nationality: null,
        headshotUrl: headshotUrl(first, last),
      },

      constructor: {
        name: null,
      },
    });
  }

  if (!drivers.length)
    throw new Error("F1.com scrape returned no drivers");

  return drivers;
}

async function getStandingsFromF1Site() {
  const html = await fetchText(F1_RESULTS_URL);

  const drivers = parseDriversFromHtml(html);

  return {
    season: 2026,
    drivers,
    source: "f1.com",
  };
}

/* ------------------------------------------------ */
/* Main */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();

  let result = null;

  /* ---- SOURCE 1: JOLPICA ---- */

  try {
    result = await getStandingsFromJolpica();
    console.log("Standings source: Jolpica");
  } catch (err) {
    console.warn("Jolpica failed:", err.message);
  }

  /* ---- SOURCE 2: F1.COM ---- */

  if (!result) {
    try {
      result = await getStandingsFromF1Site();
      console.log("Standings source: F1.com scrape");
    } catch (err) {
      console.warn("F1.com scrape failed:", err.message);
    }
  }

  /* ---- SOURCE 3: PREVIOUS FILE ---- */

  if (!result) {
    const prev = await readPreviousFile();

    if (prev) {
      result = {
        ...prev,
        source: "previous-file",
      };

      console.log("Standings source: previous JSON");
    }
  }

  /* ---- LAST RESORT PLACEHOLDER ---- */

  if (!result) {
    console.warn("All sources failed — placeholders used");

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
    `Wrote ${OUTPUT_FILE} source=${result.source} drivers=${result.drivers.length}`
  );
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});