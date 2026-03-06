import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const JOLPICA_STANDINGS_URLS = [
  "https://api.jolpi.ca/ergast/f1/current/driverStandings.json",
  "https://api.jolpi.ca/ergast/f1/current/driverstandings.json"
];

const JOLPICA_LAST_RACE_URL =
  "https://api.jolpi.ca/ergast/f1/current/last/results.json";

const OPENF1_URL =
  "https://api.openf1.org/v1/drivers?meeting_key=latest";

const HEADSHOTS =
  "https://mredman48.github.io/F1-standings/headshots";

const UA = "f1-standings-bot";

/* ------------------------------------------------ */
/* DRIVER NAME FIXES FOR HEADSHOT FILES */
/* ------------------------------------------------ */

const DRIVER_SLUG_OVERRIDES = {
  alexander: "alex"
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
  return DRIVER_SLUG_OVERRIDES[lower] || lower;
}

function headshot(first, last) {
  if (!first || !last) return null;

  const firstSlug = slug(normalizeFirstName(first));
  const lastSlug = slug(last);

  return `${HEADSHOTS}/${firstSlug}-${lastSlug}.png`;
}

function normalizeTeamName(name) {
  if (!name) return null;

  const map = {
    "Red Bull Racing": "Red Bull",
    "Oracle Red Bull Racing": "Red Bull",
    "RB F1 Team": "VCARB",
    "Visa Cash App RB": "VCARB",
    "Visa Cash App RB F1 Team": "VCARB",
    "Haas F1 Team": "Haas",
    "Alpine F1 Team": "Alpine"
  };

  return map[name] || name;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json"
    },
    redirect: "follow"
  });

  const text = await res.text();
  return { res, text };
}

async function fetchJsonSafe(url) {
  const { res, text } = await fetchText(url);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      text,
      json: null,
      url
    };
  }

  try {
    return {
      ok: true,
      status: res.status,
      text: null,
      json: JSON.parse(text),
      url
    };
  } catch {
    return {
      ok: false,
      status: res.status,
      text,
      json: null,
      url
    };
  }
}

async function readPreviousFile() {
  try {
    const raw = await fs.readFile(OUTPUT_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed?.drivers) && parsed.drivers.length > 0) {
      return parsed;
    }
  } catch {}

  return null;
}

/* ------------------------------------------------ */
/* LAST FINISHED RACE */
/* ------------------------------------------------ */

async function getLastFinishedRace() {
  const resp = await fetchJsonSafe(JOLPICA_LAST_RACE_URL);

  if (!resp.ok) return null;

  const race = resp?.json?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  const winner = race?.Results?.[0] ?? null;

  return {
    season: race?.season ?? null,
    round: race?.round ? Number(race.round) : null,
    raceName: race?.raceName ?? null,
    date: race?.date ?? null,
    time: race?.time ?? null,
    circuit: {
      name: race?.Circuit?.circuitName ?? null,
      location: {
        locality: race?.Circuit?.Location?.locality ?? null,
        country: race?.Circuit?.Location?.country ?? null
      }
    },
    winner: winner
      ? {
          position: winner?.position ? Number(winner.position) : null,
          points: winner?.points != null ? Number(winner.points) : null,
          driver: {
            code: winner?.Driver?.code ?? null,
            firstName: winner?.Driver?.givenName ?? null,
            lastName: winner?.Driver?.familyName ?? null,
            fullName:
              winner?.Driver?.givenName && winner?.Driver?.familyName
                ? `${winner.Driver.givenName} ${winner.Driver.familyName}`
                : null,
            nationality: winner?.Driver?.nationality ?? null
          },
          constructor: {
            name: normalizeTeamName(winner?.Constructor?.name ?? null),
            fullName: winner?.Constructor?.name ?? null,
            nationality: winner?.Constructor?.nationality ?? null
          }
        }
      : null
  };
}

/* ------------------------------------------------ */
/* SOURCE 1: JOLPICA REAL STANDINGS */
/* ------------------------------------------------ */

function parseJolpicaStandings(json) {
  const season = json?.MRData?.StandingsTable?.season ?? null;

  const lists = json?.MRData?.StandingsTable?.StandingsLists ?? [];

  const rows = lists.length ? lists[0].DriverStandings ?? [] : [];

  if (!rows.length) {
    return { season, drivers: [] };
  }

  const drivers = rows.map((d) => {
    const ctor = d?.Constructors?.[0] ?? null;
    const first = d?.Driver?.givenName ?? null;
    const last = d?.Driver?.familyName ?? null;

    return {
      position: d?.position ? `P${d.position}` : "-",
      positionNumber: d?.position ? Number(d.position) : null,
      points: d?.points != null ? Number(d.points) : "-",
      wins: d?.wins != null ? Number(d.wins) : "-",

      driver: {
        code: d?.Driver?.code ?? null,
        firstName: first,
        lastName: last,
        fullName: first && last ? `${first} ${last}` : null,
        nationality: d?.Driver?.nationality ?? null,
        driverNumber: null,
        headshotUrl: first && last ? headshot(first, last) : null
      },

      constructor: {
        name: normalizeTeamName(ctor?.name ?? null),
        fullName: ctor?.name ?? null,
        nationality: ctor?.nationality ?? null
      }
    };
  });

  return { season, drivers };
}

async function getLiveStandingsFromJolpica() {
  for (const url of JOLPICA_STANDINGS_URLS) {
    const resp = await fetchJsonSafe(url);

    if (!resp.ok) continue;

    const parsed = parseJolpicaStandings(resp.json);

    if (parsed.drivers.length > 0) {
      return {
        ok: true,
        season: parsed.season,
        drivers: parsed.drivers,
        sourceUrl: url
      };
    }
  }

  return {
    ok: false,
    season: null,
    drivers: [],
    sourceUrl: null
  };
}

/* ------------------------------------------------ */
/* SOURCE 2: OPENF1 ALPHABETICAL ROSTER */
/* ------------------------------------------------ */

function dedupeOpenF1Drivers(drivers) {
  const byNumber = new Map();

  for (const d of drivers) {
    const num = d?.driver_number;
    const first = d?.first_name;
    const last = d?.last_name;

    if (num == null || !first || !last) continue;

    if (!byNumber.has(num)) {
      byNumber.set(num, d);
    }
  }

  return Array.from(byNumber.values());
}

function buildAlphabeticalDrivers(drivers) {
  const uniqueDrivers = dedupeOpenF1Drivers(drivers);

  const rows = uniqueDrivers
    .map((d) => ({
      firstName: d.first_name,
      lastName: d.last_name,
      driverNumber: d.driver_number,
      team: d.team_name
    }))
    .filter((d) => d.firstName && d.lastName);

  rows.sort((a, b) => {
    const lastCmp = a.lastName.localeCompare(b.lastName);
    if (lastCmp !== 0) return lastCmp;
    return a.firstName.localeCompare(b.firstName);
  });

  return rows.map((d) => ({
    position: "-",
    positionNumber: null,
    points: "-",
    wins: "-",

    driver: {
      code: null,
      firstName: d.firstName,
      lastName: d.lastName,
      fullName: `${d.firstName} ${d.lastName}`,
      nationality: null,
      driverNumber: d.driverNumber ?? null,
      headshotUrl: headshot(d.firstName, d.lastName)
    },

    constructor: {
      name: normalizeTeamName(d.team ?? null),
      fullName: d.team ?? null,
      nationality: null
    }
  }));
}

async function getAlphabeticalFallbackFromOpenF1() {
  const resp = await fetchJsonSafe(OPENF1_URL);

  if (!resp.ok || !Array.isArray(resp.json) || resp.json.length === 0) {
    return {
      ok: false,
      drivers: [],
      sourceUrl: OPENF1_URL,
      status: resp.status
    };
  }

  return {
    ok: true,
    drivers: buildAlphabeticalDrivers(resp.json),
    sourceUrl: OPENF1_URL,
    status: resp.status
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();
  const previous = await readPreviousFile();
  const lastRace = await getLastFinishedRace();

  // 1) Real standings from Jolpica
  const live = await getLiveStandingsFromJolpica();
  if (live.ok && live.drivers.length > 0) {
    const out = {
      header: `${live.season ?? "Current"} Driver Standings`,
      generatedAtUtc: now,
      season: live.season,
      mode: "LIVE",
      source: {
        kind: "jolpica",
        url: live.sourceUrl,
        note: null
      },
      lastRace,
      drivers: live.drivers
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=LIVE drivers=${out.drivers.length}`);
    return;
  }

  // 2) Alphabetical fallback from OpenF1
  const alpha = await getAlphabeticalFallbackFromOpenF1();
  if (alpha.ok && alpha.drivers.length > 0) {
    const out = {
      header: "Driver Standings",
      generatedAtUtc: now,
      season: live.season ?? previous?.season ?? null,
      mode: "ALPHABETICAL_FALLBACK",
      source: {
        kind: "openf1-roster",
        url: alpha.sourceUrl,
        note: "No standings available; using alphabetical driver roster fallback."
      },
      lastRace: lastRace ?? previous?.lastRace ?? null,
      drivers: alpha.drivers
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=ALPHABETICAL_FALLBACK drivers=${out.drivers.length}`);
    return;
  }

  // 3) Previous file fallback
  if (previous?.drivers?.length) {
    const out = {
      ...previous,
      generatedAtUtc: now,
      mode: "PREVIOUS_FILE_FALLBACK",
      source: {
        kind: "previous-file",
        url: previous?.source?.url ?? null,
        note: "Both live standings and alphabetical fallback were unavailable; reusing previous file."
      },
      lastRace: lastRace ?? previous?.lastRace ?? null
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=PREVIOUS_FILE_FALLBACK drivers=${out.drivers.length}`);
    return;
  }

  // 4) Last resort empty
  const out = {
    header: "Driver Standings",
    generatedAtUtc: now,
    season: null,
    mode: "EMPTY",
    source: {
      kind: "none",
      url: null,
      note: "No standings or fallback roster available."
    },
    lastRace: lastRace ?? null,
    drivers: []
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} mode=EMPTY drivers=0`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});