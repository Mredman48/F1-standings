import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_SESSIONS_URL = `${OPENF1_BASE}/sessions`;
const OPENF1_CHAMPIONSHIP_URL = `${OPENF1_BASE}/championship_drivers`;

const JOLPICA_DRIVER_STANDINGS_URL =
  "https://api.jolpi.ca/ergast/f1/current/driverStandings.json";
const JOLPICA_DRIVERS_URL =
  "https://api.jolpi.ca/ergast/f1/current/drivers.json";

const HEADSHOTS =
  "https://mredman48.github.io/F1-standings/headshots";

const UA = "f1-standings-bot";

/* ------------------------------------------------ */
/* DRIVER NAME FIXES FOR HEADSHOT FILES */
/* ------------------------------------------------ */

const DRIVER_SLUG_OVERRIDES = {
  alexander: "alex",
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
    "Racing Bulls": "VCARB",
    "Haas F1 Team": "Haas",
    "Alpine F1 Team": "Alpine",
    "Kick Sauber": "Sauber",
    "Stake F1 Team Kick Sauber": "Sauber",
  };

  return map[name] || name;
}

function getSeasonYear() {
  return new Date().getUTCFullYear();
}

function buildUrl(base, params = {}) {
  const url = new URL(base);

  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    url.searchParams.append(key, String(value));
  }

  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
    redirect: "follow",
  });

  const text = await res.text();

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      json: null,
      text,
      url,
    };
  }

  try {
    return {
      ok: true,
      status: res.status,
      json: JSON.parse(text),
      text: null,
      url,
    };
  } catch {
    return {
      ok: false,
      status: res.status,
      json: null,
      text,
      url,
    };
  }
}

function parseDateSafe(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function driverKey(value) {
  if (value == null) return null;
  return String(value).trim();
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
/* OPENF1: RESOLVE LATEST RACE SESSION */
/* ------------------------------------------------ */

function pickLatestRaceSession(sessions, now = new Date()) {
  const nowMs = now.getTime();

  const mapped = sessions
    .map((s) => ({
      raw: s,
      start: parseDateSafe(s?.date_start),
    }))
    .filter((x) => x.raw && x.start && x.raw.session_name === "Race");

  if (!mapped.length) return null;

  const started = mapped
    .filter((x) => x.start.getTime() <= nowMs)
    .sort((a, b) => b.start.getTime() - a.start.getTime());

  if (started.length > 0) {
    return started[0].raw;
  }

  const upcoming = mapped.sort((a, b) => a.start.getTime() - b.start.getTime());
  return upcoming[0]?.raw ?? null;
}

async function getLatestRaceSession() {
  const currentYear = getSeasonYear();
  const yearsToTry = [currentYear, currentYear - 1];

  for (const year of yearsToTry) {
    const url = buildUrl(OPENF1_SESSIONS_URL, {
      year,
      session_name: "Race",
    });

    const resp = await fetchJson(url);

    if (!resp.ok || !Array.isArray(resp.json) || resp.json.length === 0) {
      continue;
    }

    const race = pickLatestRaceSession(resp.json);

    if (race?.session_key != null) {
      return {
        ok: true,
        session: race,
        sourceUrl: url,
      };
    }
  }

  return {
    ok: false,
    session: null,
    sourceUrl: null,
  };
}

/* ------------------------------------------------ */
/* OPENF1: LIVE STANDINGS */
/* ------------------------------------------------ */

async function getOpenF1StandingsForLatestRace() {
  const latestRace = await getLatestRaceSession();

  if (!latestRace.ok || !latestRace.session?.session_key) {
    return {
      ok: false,
      season: null,
      raceSession: null,
      rows: [],
      sourceUrl: null,
      note: "Could not resolve latest race session from OpenF1.",
    };
  }

  const sessionKey = latestRace.session.session_key;

  const standingsUrl = buildUrl(OPENF1_CHAMPIONSHIP_URL, {
    session_key: sessionKey,
  });

  const resp = await fetchJson(standingsUrl);

  if (!resp.ok || !Array.isArray(resp.json) || resp.json.length === 0) {
    return {
      ok: false,
      season: latestRace.session?.year ?? null,
      raceSession: latestRace.session,
      rows: [],
      sourceUrl: standingsUrl,
      note: "OpenF1 championship_drivers returned no rows.",
    };
  }

  const rows = [...resp.json].sort((a, b) => {
    const posA = Number.isFinite(a?.position_current) ? a.position_current : 999;
    const posB = Number.isFinite(b?.position_current) ? b.position_current : 999;
    if (posA !== posB) return posA - posB;

    const ptsA = Number.isFinite(a?.points_current) ? a.points_current : -1;
    const ptsB = Number.isFinite(b?.points_current) ? b.points_current : -1;
    return ptsB - ptsA;
  });

  return {
    ok: true,
    season: latestRace.session?.year ?? null,
    raceSession: latestRace.session,
    rows,
    sourceUrl: standingsUrl,
    note: null,
  };
}

/* ------------------------------------------------ */
/* JOLPICA: METADATA */
/* ------------------------------------------------ */

function parseJolpicaDriverStandingsMetadata(json) {
  const rows =
    json?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];

  const byNumber = new Map();

  for (const row of rows) {
    const driver = row?.Driver ?? null;
    const constructor = row?.Constructors?.[0] ?? null;
    const key = driverKey(driver?.permanentNumber);

    if (!key) continue;

    byNumber.set(key, {
      code: driver?.code ?? null,
      firstName: driver?.givenName ?? null,
      lastName: driver?.familyName ?? null,
      fullName:
        driver?.givenName && driver?.familyName
          ? `${driver.givenName} ${driver.familyName}`
          : null,
      nationality: driver?.nationality ?? null,
      driverNumber:
        driver?.permanentNumber != null
          ? Number(driver.permanentNumber)
          : null,
      constructorName: constructor?.name ?? null,
      constructorNationality: constructor?.nationality ?? null,
    });
  }

  return byNumber;
}

function parseJolpicaDriversMetadata(json) {
  const rows = json?.MRData?.DriverTable?.Drivers ?? [];
  const byNumber = new Map();

  for (const driver of rows) {
    const key = driverKey(driver?.permanentNumber);
    if (!key) continue;

    byNumber.set(key, {
      code: driver?.code ?? null,
      firstName: driver?.givenName ?? null,
      lastName: driver?.familyName ?? null,
      fullName:
        driver?.givenName && driver?.familyName
          ? `${driver.givenName} ${driver.familyName}`
          : null,
      nationality: driver?.nationality ?? null,
      driverNumber:
        driver?.permanentNumber != null
          ? Number(driver.permanentNumber)
          : null,
      constructorName: null,
      constructorNationality: null,
    });
  }

  return byNumber;
}

async function getJolpicaMetadata() {
  const [standingsResp, driversResp] = await Promise.all([
    fetchJson(JOLPICA_DRIVER_STANDINGS_URL),
    fetchJson(JOLPICA_DRIVERS_URL),
  ]);

  const standingsMap =
    standingsResp.ok && standingsResp.json
      ? parseJolpicaDriverStandingsMetadata(standingsResp.json)
      : new Map();

  const driversMap =
    driversResp.ok && driversResp.json
      ? parseJolpicaDriversMetadata(driversResp.json)
      : new Map();

  const merged = new Map();

  for (const [key, value] of driversMap.entries()) {
    merged.set(key, value);
  }

  for (const [key, value] of standingsMap.entries()) {
    const prev = merged.get(key) ?? {};
    merged.set(key, {
      ...prev,
      ...value,
      constructorName: value.constructorName ?? prev.constructorName ?? null,
      constructorNationality:
        value.constructorNationality ?? prev.constructorNationality ?? null,
    });
  }

  return {
    ok: merged.size > 0,
    byNumber: merged,
    sourceUrls: {
      standings: JOLPICA_DRIVER_STANDINGS_URL,
      drivers: JOLPICA_DRIVERS_URL,
    },
  };
}

/* ------------------------------------------------ */
/* JOIN + VALIDATION */
/* ------------------------------------------------ */

function validateMergedRows(rows) {
  const bad = rows.filter(
    (row) =>
      !row.driver.firstName ||
      !row.driver.lastName ||
      !row.driver.fullName ||
      !row.driver.code ||
      !row.constructor.fullName
  );

  if (bad.length > 0) {
    const sample = bad.slice(0, 8).map((row) => ({
      driverNumber: row.driver.driverNumber,
      fullName: row.driver.fullName,
      code: row.driver.code,
      team: row.constructor.fullName,
    }));

    throw new Error(
      `Merged standings metadata incomplete for ${bad.length} row(s). Sample: ${JSON.stringify(sample)}`
    );
  }
}

function buildMergedStandings(openf1Rows, jolpicaMap) {
  const rows = openf1Rows.map((row) => {
    const key = driverKey(row?.driver_number);
    const meta = key ? jolpicaMap.get(key) ?? null : null;

    if (!meta) {
      throw new Error(
        `No Jolpica metadata match for driver_number=${row?.driver_number}`
      );
    }

    return {
      position: Number.isFinite(row?.position_current)
        ? `P${row.position_current}`
        : "-",
      positionNumber: Number.isFinite(row?.position_current)
        ? Number(row.position_current)
        : null,
      points: Number.isFinite(row?.points_current)
        ? Number(row.points_current)
        : "-",
      wins: "-",
      driver: {
        code: meta.code ?? null,
        firstName: meta.firstName ?? null,
        lastName: meta.lastName ?? null,
        fullName: meta.fullName ?? null,
        nationality: meta.nationality ?? null,
        driverNumber:
          meta.driverNumber != null
            ? Number(meta.driverNumber)
            : row?.driver_number != null
              ? Number(row.driver_number)
              : null,
        headshotUrl:
          meta.firstName && meta.lastName
            ? headshot(meta.firstName, meta.lastName)
            : null,
      },
      constructor: {
        name: normalizeTeamName(meta.constructorName ?? null),
        fullName: meta.constructorName ?? null,
        nationality: meta.constructorNationality ?? null,
      },
    };
  });

  validateMergedRows(rows);
  return rows;
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();
  const previous = await readPreviousFile();

  const [liveStandings, metadata] = await Promise.all([
    getOpenF1StandingsForLatestRace(),
    getJolpicaMetadata(),
  ]);

  if (!liveStandings.ok || liveStandings.rows.length === 0) {
    throw new Error(liveStandings.note || "OpenF1 standings unavailable.");
  }

  if (!metadata.ok || metadata.byNumber.size === 0) {
    throw new Error("Jolpica metadata unavailable.");
  }

  console.log(`OpenF1 standings rows: ${liveStandings.rows.length}`);
  console.log(`Jolpica metadata rows: ${metadata.byNumber.size}`);

  const mergedDrivers = buildMergedStandings(
    liveStandings.rows,
    metadata.byNumber
  );

  const race = liveStandings.raceSession;

  const out = {
    header: `${liveStandings.season ?? "Current"} Driver Standings`,
    generatedAtUtc: now,
    season: liveStandings.season,
    mode: "LIVE",
    source: {
      kind: "openf1+jolpica",
      url: liveStandings.sourceUrl,
      note: "Standings from OpenF1; driver and constructor metadata from Jolpica.",
      metadataUrls: metadata.sourceUrls,
    },
    lastRace: race
      ? {
          sessionKey: race.session_key ?? null,
          meetingKey: race.meeting_key ?? null,
          sessionName: race.session_name ?? null,
          sessionType: race.session_type ?? null,
          country: race.country_name ?? null,
          location: race.location ?? null,
          circuit: race.circuit_short_name ?? null,
          dateStartUtc: race.date_start ?? null,
          dateEndUtc: race.date_end ?? null,
        }
      : previous?.lastRace ?? null,
    drivers: mergedDrivers,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} mode=LIVE drivers=${out.drivers.length}`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});