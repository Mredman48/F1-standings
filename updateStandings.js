import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_SESSIONS_URL = `${OPENF1_BASE}/sessions`;
const OPENF1_CHAMPIONSHIP_URL = `${OPENF1_BASE}/championship_drivers`;
const OPENF1_DRIVERS_URL = `${OPENF1_BASE}/drivers`;

const HEADSHOTS = "https://mredman48.github.io/F1-standings/headshots";
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

function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function titleCaseWords(s) {
  if (!s) return null;
  return String(s)
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/* ------------------------------------------------ */
/* OPENF1 SESSION RESOLUTION */
/* ------------------------------------------------ */

function pickLatestRaceSession(sessions, now = new Date()) {
  const nowMs = now.getTime();

  const mapped = sessions
    .map((s) => {
      const start = parseDateSafe(s?.date_start);

      return {
        raw: s,
        start,
      };
    })
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
        year,
        session: race,
        sourceUrl: url,
      };
    }
  }

  return {
    ok: false,
    year: null,
    session: null,
    sourceUrl: null,
  };
}

/* ------------------------------------------------ */
/* OPENF1 DRIVER METADATA */
/* ------------------------------------------------ */

function dedupeDriversByNumber(drivers) {
  const byNumber = new Map();

  for (const d of drivers) {
    const key = driverKey(d?.driver_number);
    if (!key) continue;

    if (!byNumber.has(key)) {
      byNumber.set(key, d);
      continue;
    }

    const prev = byNumber.get(key);

    const prevScore =
      Number(Boolean(prev?.first_name)) +
      Number(Boolean(prev?.last_name)) +
      Number(Boolean(prev?.full_name)) +
      Number(Boolean(prev?.team_name)) +
      Number(Boolean(prev?.name_acronym)) +
      Number(Boolean(prev?.headshot_url));

    const nextScore =
      Number(Boolean(d?.first_name)) +
      Number(Boolean(d?.last_name)) +
      Number(Boolean(d?.full_name)) +
      Number(Boolean(d?.team_name)) +
      Number(Boolean(d?.name_acronym)) +
      Number(Boolean(d?.headshot_url));

    if (nextScore > prevScore) {
      byNumber.set(key, d);
    }
  }

  return byNumber;
}

function buildDriverIdentity(meta) {
  const firstName = meta?.first_name ?? null;
  const lastName = meta?.last_name ?? null;

  const fullName =
    meta?.full_name
      ? titleCaseWords(String(meta.full_name).replace(/\s+/g, " "))
      : firstName && lastName
        ? `${firstName} ${lastName}`
        : null;

  const split =
    firstName || lastName
      ? { firstName, lastName }
      : fullName
        ? splitFullName(fullName)
        : { firstName: null, lastName: null };

  return {
    code: meta?.name_acronym ?? null,
    firstName: split.firstName ?? null,
    lastName: split.lastName ?? null,
    fullName:
      fullName ||
      (split.firstName && split.lastName
        ? `${split.firstName} ${split.lastName}`
        : null),
    nationality: meta?.country_code ?? null,
    teamName: meta?.team_name ?? null,
    openf1HeadshotUrl: meta?.headshot_url ?? null,
  };
}

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
    const sample = bad.slice(0, 5).map((row) => ({
      driverNumber: row.driver.driverNumber,
      fullName: row.driver.fullName,
      code: row.driver.code,
      team: row.constructor.fullName,
    }));

    throw new Error(
      `OpenF1 driver metadata incomplete for ${bad.length} row(s). Sample: ${JSON.stringify(sample)}`
    );
  }
}

/* ------------------------------------------------ */
/* OPENF1 STANDINGS */
/* ------------------------------------------------ */

async function getOpenF1StandingsForLatestRace() {
  const latestRace = await getLatestRaceSession();

  if (!latestRace.ok || !latestRace.session?.session_key) {
    throw new Error("Could not resolve latest race session from OpenF1.");
  }

  const sessionKey = latestRace.session.session_key;

  const standingsUrl = buildUrl(OPENF1_CHAMPIONSHIP_URL, {
    session_key: sessionKey,
  });

  const driversUrl = buildUrl(OPENF1_DRIVERS_URL, {
    session_key: sessionKey,
  });

  const [standingsResp, driversResp] = await Promise.all([
    fetchJson(standingsUrl),
    fetchJson(driversUrl),
  ]);

  if (
    !standingsResp.ok ||
    !Array.isArray(standingsResp.json) ||
    standingsResp.json.length === 0
  ) {
    throw new Error("OpenF1 championship_drivers returned no standings rows.");
  }

  if (
    !driversResp.ok ||
    !Array.isArray(driversResp.json) ||
    driversResp.json.length === 0
  ) {
    throw new Error("OpenF1 drivers returned no driver metadata rows.");
  }

  const driverMap = dedupeDriversByNumber(driversResp.json);

  console.log(`OpenF1 standings rows: ${standingsResp.json.length}`);
  console.log(`OpenF1 driver metadata rows: ${driverMap.size}`);

  const rows = [...standingsResp.json]
    .sort((a, b) => {
      const posA = Number.isFinite(a?.position_current) ? a.position_current : 999;
      const posB = Number.isFinite(b?.position_current) ? b.position_current : 999;
      if (posA !== posB) return posA - posB;

      const ptsA = Number.isFinite(a?.points_current) ? a.points_current : -1;
      const ptsB = Number.isFinite(b?.points_current) ? b.points_current : -1;
      return ptsB - ptsA;
    })
    .map((row) => {
      const key = driverKey(row?.driver_number);
      const meta = key ? driverMap.get(key) ?? null : null;

      if (!meta) {
        throw new Error(`No OpenF1 driver metadata match for driver_number=${row?.driver_number}`);
      }

      const identity = buildDriverIdentity(meta);

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
          code: identity.code,
          firstName: identity.firstName,
          lastName: identity.lastName,
          fullName: identity.fullName,
          nationality: identity.nationality,
          driverNumber:
            row?.driver_number != null ? Number(row.driver_number) : null,
          headshotUrl:
            identity.firstName && identity.lastName
              ? headshot(identity.firstName, identity.lastName)
              : null,
          openf1HeadshotUrl: identity.openf1HeadshotUrl,
        },
        constructor: {
          name: normalizeTeamName(identity.teamName),
          fullName: identity.teamName,
          nationality: null,
        },
      };
    });

  validateMergedRows(rows);

  return {
    season: latestRace.session?.year ?? null,
    drivers: rows,
    raceSession: latestRace.session,
    sourceUrl: standingsUrl,
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();

  const live = await getOpenF1StandingsForLatestRace();
  const race = live.raceSession;

  const out = {
    header: `${live.season ?? "Current"} Driver Standings`,
    generatedAtUtc: now,
    season: live.season,
    mode: "LIVE",
    source: {
      kind: "openf1-championship_drivers",
      url: live.sourceUrl,
      note: null,
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
      : null,
    drivers: live.drivers,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} mode=LIVE drivers=${out.drivers.length}`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});