import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_SESSIONS_URL = `${OPENF1_BASE}/sessions`;
const OPENF1_CHAMPIONSHIP_URL = `${OPENF1_BASE}/championship_drivers`;
const OPENF1_DRIVERS_URL = `${OPENF1_BASE}/drivers`;

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

function driverKey(value) {
  if (value == null) return null;
  return String(value).trim();
}

/* ------------------------------------------------ */
/* OPENF1 SESSION RESOLUTION */
/* ------------------------------------------------ */

function pickLatestRaceSession(sessions, now = new Date()) {
  const nowMs = now.getTime();

  const mapped = sessions
    .map((s) => {
      const start = parseDateSafe(s?.date_start);
      const end = parseDateSafe(s?.date_end);

      return {
        raw: s,
        start,
        end,
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
/* OPENF1 DRIVERS + CHAMPIONSHIP */
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
      Number(Boolean(prev?.name_acronym));

    const nextScore =
      Number(Boolean(d?.first_name)) +
      Number(Boolean(d?.last_name)) +
      Number(Boolean(d?.full_name)) +
      Number(Boolean(d?.team_name)) +
      Number(Boolean(d?.name_acronym));

    if (nextScore > prevScore) {
      byNumber.set(key, d);
    }
  }

  return byNumber;
}

async function getOpenF1StandingsForLatestRace() {
  const latestRace = await getLatestRaceSession();

  if (!latestRace.ok || !latestRace.session?.session_key) {
    return {
      ok: false,
      season: null,
      drivers: [],
      raceSession: null,
      sourceUrl: null,
      note: "Could not resolve latest race session from OpenF1.",
    };
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
    return {
      ok: false,
      season: latestRace.session?.year ?? null,
      drivers: [],
      raceSession: latestRace.session,
      sourceUrl: standingsUrl,
      note: "OpenF1 championship_drivers returned no standings rows.",
    };
  }

  const driverMap = dedupeDriversByNumber(
    Array.isArray(driversResp.json) ? driversResp.json : []
  );

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

      const fullNameRaw = meta?.full_name ?? null;
      const fullName =
        fullNameRaw
          ? titleCaseWords(String(fullNameRaw).replace(/\s+/g, " "))
          : meta?.first_name && meta?.last_name
            ? `${meta.first_name} ${meta.last_name}`
            : null;

      const split =
        meta?.first_name || meta?.last_name
          ? {
              firstName: meta?.first_name ?? null,
              lastName: meta?.last_name ?? null,
            }
          : fullName
            ? splitFullName(fullName)
            : { firstName: null, lastName: null };

      if (!meta) {
        console.log(`No metadata match for driver_number=${row?.driver_number}`);
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
          code: meta?.name_acronym ?? null,
          firstName: split.firstName ?? null,
          lastName: split.lastName ?? null,
          fullName:
            fullName ||
            (split.firstName && split.lastName
              ? `${split.firstName} ${split.lastName}`
              : null),
          nationality: meta?.country_code ?? null,
          driverNumber:
            row?.driver_number != null ? Number(row.driver_number) : null,
          headshotUrl:
            split.firstName && split.lastName
              ? headshot(split.firstName, split.lastName)
              : null,
          openf1HeadshotUrl: meta?.headshot_url ?? null,
        },
        constructor: {
          name: normalizeTeamName(meta?.team_name ?? null),
          fullName: meta?.team_name ?? null,
          nationality: null,
        },
      };
    });

  return {
    ok: rows.length > 0,
    season: latestRace.session?.year ?? null,
    drivers: rows,
    raceSession: latestRace.session,
    sourceUrl: standingsUrl,
    note: rows.length > 0 ? null : "No merged standings rows built.",
  };
}

/* ------------------------------------------------ */
/* OPENF1 ROSTER FALLBACK */
/* ------------------------------------------------ */

function buildAlphabeticalRoster(drivers) {
  const unique = Array.from(dedupeDriversByNumber(drivers).values())
    .filter((d) => d?.first_name && d?.last_name)
    .map((d) => ({
      firstName: d.first_name,
      lastName: d.last_name,
      fullName:
        d.full_name
          ? titleCaseWords(String(d.full_name).replace(/\s+/g, " "))
          : `${d.first_name} ${d.last_name}`,
      driverNumber: d.driver_number ?? null,
      code: d.name_acronym ?? null,
      team: d.team_name ?? null,
      nationality: d.country_code ?? null,
      openf1HeadshotUrl: d.headshot_url ?? null,
    }));

  unique.sort((a, b) => {
    const lastCmp = String(a.lastName || "").localeCompare(String(b.lastName || ""));
    if (lastCmp !== 0) return lastCmp;
    return String(a.firstName || "").localeCompare(String(b.firstName || ""));
  });

  return unique.map((d) => ({
    position: "-",
    positionNumber: null,
    points: "-",
    wins: "-",
    driver: {
      code: d.code,
      firstName: d.firstName,
      lastName: d.lastName,
      fullName: d.fullName,
      nationality: d.nationality,
      driverNumber: d.driverNumber != null ? Number(d.driverNumber) : null,
      headshotUrl: headshot(d.firstName, d.lastName),
      openf1HeadshotUrl: d.openf1HeadshotUrl,
    },
    constructor: {
      name: normalizeTeamName(d.team),
      fullName: d.team,
      nationality: null,
    },
  }));
}

async function getOpenF1RosterFallback() {
  const latestRace = await getLatestRaceSession();

  const params =
    latestRace.ok && latestRace.session?.session_key != null
      ? { session_key: latestRace.session.session_key }
      : { session_key: "latest" };

  const url = buildUrl(OPENF1_DRIVERS_URL, params);
  const resp = await fetchJson(url);

  if (!resp.ok || !Array.isArray(resp.json) || resp.json.length === 0) {
    return {
      ok: false,
      season: latestRace.session?.year ?? null,
      drivers: [],
      sourceUrl: url,
      note: "OpenF1 drivers fallback returned no rows.",
    };
  }

  const drivers = buildAlphabeticalRoster(resp.json);

  return {
    ok: drivers.length > 0,
    season: latestRace.session?.year ?? null,
    drivers,
    sourceUrl: url,
    note: drivers.length > 0
      ? "No standings available; using OpenF1 driver roster fallback."
      : "OpenF1 roster fallback produced no rows.",
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();
  const previous = await readPreviousFile();

  const live = await getOpenF1StandingsForLatestRace();
  if (live.ok && live.drivers.length > 0) {
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
        : previous?.lastRace ?? null,
      drivers: live.drivers,
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=LIVE drivers=${out.drivers.length}`);
    return;
  }

  const roster = await getOpenF1RosterFallback();
  if (roster.ok && roster.drivers.length > 0) {
    const out = {
      header: "Driver Standings",
      generatedAtUtc: now,
      season: live.season ?? roster.season ?? previous?.season ?? null,
      mode: "OPENF1_ROSTER_FALLBACK",
      source: {
        kind: "openf1-drivers",
        url: roster.sourceUrl,
        note: roster.note,
      },
      lastRace: previous?.lastRace ?? null,
      drivers: roster.drivers,
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(
      `Wrote ${OUTPUT_FILE} mode=OPENF1_ROSTER_FALLBACK drivers=${out.drivers.length}`
    );
    return;
  }

  if (previous?.drivers?.length) {
    const out = {
      ...previous,
      generatedAtUtc: now,
      mode: "PREVIOUS_FILE_FALLBACK",
      source: {
        kind: "previous-file",
        url: previous?.source?.url ?? null,
        note: "OpenF1 standings and roster fallback were unavailable; reusing previous file.",
      },
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(
      `Wrote ${OUTPUT_FILE} mode=PREVIOUS_FILE_FALLBACK drivers=${out.drivers.length}`
    );
    return;
  }

  const out = {
    header: "Driver Standings",
    generatedAtUtc: now,
    season: null,
    mode: "EMPTY",
    source: {
      kind: "none",
      url: null,
      note: "No OpenF1 standings or fallback roster data available.",
    },
    lastRace: null,
    drivers: [],
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} mode=EMPTY drivers=0`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});