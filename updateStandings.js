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
  return `${HEADSHOTS}/${slug(normalizeFirstName(first))}-${slug(last)}.png`;
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
/* OPENF1 LIVE STANDINGS */
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

  const standingsUrl = buildUrl(OPENF1_CHAMPIONSHIP_URL, {
    session_key: latestRace.session.session_key,
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
/* OPENF1 DRIVER METADATA FROM LATEST MEETING */
/* ------------------------------------------------ */

function dedupeDriversByNumber(drivers) {
  const byNumber = new Map();

  for (const d of drivers) {
    const key = driverKey(d?.driver_number);
    if (!key) continue;

    const candidate = {
      driverNumber: d?.driver_number != null ? Number(d.driver_number) : null,
      firstName: d?.first_name ?? null,
      lastName: d?.last_name ?? null,
      fullName: d?.full_name
        ? titleCaseWords(String(d.full_name).replace(/\s+/g, " "))
        : d?.first_name && d?.last_name
          ? `${d.first_name} ${d.last_name}`
          : null,
      code: d?.name_acronym ?? null,
      nationality: d?.country_code ?? null,
      teamName: d?.team_name ?? null,
      openf1HeadshotUrl: d?.headshot_url ?? null,
    };

    const score =
      Number(Boolean(candidate.firstName)) +
      Number(Boolean(candidate.lastName)) +
      Number(Boolean(candidate.fullName)) +
      Number(Boolean(candidate.code)) +
      Number(Boolean(candidate.teamName)) +
      Number(Boolean(candidate.nationality)) +
      Number(Boolean(candidate.openf1HeadshotUrl));

    const prev = byNumber.get(key);
    if (!prev || score > prev.score) {
      byNumber.set(key, { ...candidate, score });
    }
  }

  return byNumber;
}

async function getOpenF1MetadataFromLatestMeeting() {
  const url = buildUrl(OPENF1_DRIVERS_URL, {
    meeting_key: "latest",
  });

  const resp = await fetchJson(url);

  if (!resp.ok || !Array.isArray(resp.json) || resp.json.length === 0) {
    return {
      ok: false,
      byNumber: new Map(),
      sourceUrl: url,
      note: "OpenF1 drivers?meeting_key=latest returned no rows.",
    };
  }

  const byNumber = dedupeDriversByNumber(resp.json);

  return {
    ok: byNumber.size > 0,
    byNumber,
    sourceUrl: url,
    note: byNumber.size > 0 ? null : "No metadata rows built from OpenF1 latest meeting.",
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
      `OpenF1 latest-meeting metadata incomplete for ${bad.length} row(s). Sample: ${JSON.stringify(sample)}`
    );
  }
}

function buildMergedStandings(openf1Rows, metadataByNumber) {
  const rows = openf1Rows.map((row) => {
    const key = driverKey(row?.driver_number);
    const meta = key ? metadataByNumber.get(key) ?? null : null;

    if (!meta) {
      throw new Error(
        `No OpenF1 latest-meeting metadata match for driver_number=${row?.driver_number}`
      );
    }

    let firstName = meta.firstName;
    let lastName = meta.lastName;
    let fullName = meta.fullName;

    if ((!firstName || !lastName) && fullName) {
      const split = splitFullName(fullName);
      firstName = firstName ?? split.firstName;
      lastName = lastName ?? split.lastName;
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
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        fullName:
          fullName ||
          (firstName && lastName ? `${firstName} ${lastName}` : null),
        nationality: meta.nationality ?? null,
        driverNumber:
          row?.driver_number != null ? Number(row.driver_number) : null,
        headshotUrl:
          firstName && lastName ? headshot(firstName, lastName) : null,
        openf1HeadshotUrl: meta.openf1HeadshotUrl ?? null,
      },
      constructor: {
        name: normalizeTeamName(meta.teamName ?? null),
        fullName: meta.teamName ?? null,
        nationality: null,
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
    getOpenF1MetadataFromLatestMeeting(),
  ]);

  if (!liveStandings.ok || liveStandings.rows.length === 0) {
    throw new Error(liveStandings.note || "OpenF1 standings unavailable.");
  }

  if (!metadata.ok || metadata.byNumber.size === 0) {
    throw new Error(metadata.note || "OpenF1 latest-meeting metadata unavailable.");
  }

  console.log(`OpenF1 standings rows: ${liveStandings.rows.length}`);
  console.log(`OpenF1 latest-meeting metadata rows: ${metadata.byNumber.size}`);

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
      kind: "openf1-only",
      url: liveStandings.sourceUrl,
      note: "Standings from OpenF1 championship_drivers; metadata from OpenF1 drivers?meeting_key=latest.",
      metadataUrl: metadata.sourceUrl,
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