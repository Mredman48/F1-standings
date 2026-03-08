import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_SESSIONS_URL = `${OPENF1_BASE}/sessions`;
const OPENF1_CHAMPIONSHIP_URL = `${OPENF1_BASE}/championship_drivers`;
const OPENF1_DRIVERS_URL = `${OPENF1_BASE}/drivers`;

const F1_DRIVERS_URL = "https://www.formula1.com/en/drivers";
const F1_TEAMS_URL = "https://www.formula1.com/en/teams";

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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });

  const text = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    text,
    url,
  };
}

function parseDateSafe(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function driverKey(value) {
  if (value == null) return null;
  return String(value).trim();
}

function fullNameKey(firstName, lastName) {
  if (!firstName || !lastName) return null;
  return `${String(firstName).trim().toLowerCase()} ${String(lastName).trim().toLowerCase()}`;
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

function decodeHtmlEntities(str) {
  if (!str) return str;

  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToLines(html) {
  let text = String(html);

  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<\/(p|div|section|article|header|footer|main|li|tr|td|th|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);

  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
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
/* OPENF1: LIVE STANDINGS + NAME/NUMBER BRIDGE */
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

  const driversUrl = buildUrl(OPENF1_DRIVERS_URL, {
    session_key: sessionKey,
  });

  const [standingsResp, driversResp] = await Promise.all([
    fetchJson(standingsUrl),
    fetchJson(driversUrl),
  ]);

  if (!standingsResp.ok || !Array.isArray(standingsResp.json) || standingsResp.json.length === 0) {
    return {
      ok: false,
      season: latestRace.session?.year ?? null,
      raceSession: latestRace.session,
      rows: [],
      sourceUrl: standingsUrl,
      note: "OpenF1 championship_drivers returned no rows.",
    };
  }

  const bridgeByNumber = new Map();

  if (driversResp.ok && Array.isArray(driversResp.json)) {
    for (const d of driversResp.json) {
      const key = driverKey(d?.driver_number);
      if (!key) continue;

      const firstName = d?.first_name ?? null;
      const lastName = d?.last_name ?? null;
      const fullName =
        d?.full_name ??
        (firstName && lastName ? `${firstName} ${lastName}` : null);

      const score =
        Number(Boolean(firstName)) +
        Number(Boolean(lastName)) +
        Number(Boolean(fullName)) +
        Number(Boolean(d?.name_acronym));

      const prev = bridgeByNumber.get(key);
      if (!prev || score > prev.score) {
        bridgeByNumber.set(key, {
          firstName,
          lastName,
          fullName,
          code: d?.name_acronym ?? null,
          score,
        });
      }
    }
  }

  const rows = [...standingsResp.json].sort((a, b) => {
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
    bridgeByNumber,
    sourceUrl: standingsUrl,
    bridgeUrl: driversUrl,
    note: null,
  };
}

/* ------------------------------------------------ */
/* F1.COM: DRIVERS METADATA */
/* ------------------------------------------------ */

function parseF1DriversPage(html) {
  const lines = htmlToLines(html);

  const startIndex = lines.findIndex(
    (line) =>
      line.includes("F1 Drivers 2026") ||
      line.includes("F1 Drivers")
  );

  const endIndex = lines.findIndex(
    (line, idx) => idx > startIndex && /F1 TEAMS/i.test(line)
  );

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return new Map();
  }

  const section = lines.slice(startIndex + 1, endIndex);
  const byName = new Map();

  for (const line of section) {
    if (/^Find the current Formula 1 drivers/i.test(line)) continue;
    if (/^F1 Drivers/i.test(line)) continue;

    // Example:
    // "George Russell Mercedes Flag of Great Britain"
    const m = line.match(/^(.*?)\s+(.+?)\s+Flag of\s+(.+)$/i);
    if (!m) continue;

    const fullName = m[1].trim();
    const teamName = m[2].trim();
    const nationality = m[3].trim();

    const nameParts = fullName.split(/\s+/);
    if (nameParts.length < 2) continue;

    const firstName = nameParts.slice(0, -1).join(" ");
    const lastName = nameParts[nameParts.length - 1];
    const key = fullNameKey(firstName, lastName);

    if (!key) continue;

    byName.set(key, {
      firstName,
      lastName,
      fullName,
      nationality,
      teamName,
    });
  }

  return byName;
}

/* ------------------------------------------------ */
/* F1.COM: TEAMS METADATA */
/* ------------------------------------------------ */

function parseF1TeamsPage(html) {
  const lines = htmlToLines(html);
  const byTeam = new Map();

  for (const line of lines) {
    // Example:
    // "Mercedes George Russell Kimi Antonelli"
    const m = line.match(
      /^(Mercedes|Ferrari|McLaren|Red Bull Racing|Haas F1 Team|Racing Bulls|Audi|Alpine|Williams|Cadillac|Aston Martin)\s+(.+)$/i
    );

    if (!m) continue;

    const teamName = m[1].trim();
    byTeam.set(teamName.toLowerCase(), {
      teamName,
    });
  }

  return byTeam;
}

async function getF1ComMetadata() {
  const [driversResp, teamsResp] = await Promise.all([
    fetchText(F1_DRIVERS_URL),
    fetchText(F1_TEAMS_URL),
  ]);

  if (!driversResp.ok) {
    return {
      ok: false,
      byName: new Map(),
      byTeam: new Map(),
      sourceUrls: {
        drivers: F1_DRIVERS_URL,
        teams: F1_TEAMS_URL,
      },
      note: `Drivers page HTTP ${driversResp.status}`,
    };
  }

  if (!teamsResp.ok) {
    return {
      ok: false,
      byName: new Map(),
      byTeam: new Map(),
      sourceUrls: {
        drivers: F1_DRIVERS_URL,
        teams: F1_TEAMS_URL,
      },
      note: `Teams page HTTP ${teamsResp.status}`,
    };
  }

  const byName = parseF1DriversPage(driversResp.text);
  const byTeam = parseF1TeamsPage(teamsResp.text);

  return {
    ok: byName.size > 0,
    byName,
    byTeam,
    sourceUrls: {
      drivers: F1_DRIVERS_URL,
      teams: F1_TEAMS_URL,
    },
    note: byName.size > 0 ? null : "Parsed no driver metadata from F1.com",
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

function buildMergedStandings(openf1Rows, bridgeByNumber, f1DriversByName) {
  const rows = openf1Rows.map((row) => {
    const key = driverKey(row?.driver_number);
    const bridge = key ? bridgeByNumber.get(key) ?? null : null;

    if (!bridge?.firstName || !bridge?.lastName) {
      throw new Error(
        `No usable OpenF1 name bridge for driver_number=${row?.driver_number}`
      );
    }

    const nameKey = fullNameKey(bridge.firstName, bridge.lastName);
    const meta = nameKey ? f1DriversByName.get(nameKey) ?? null : null;

    if (!meta) {
      throw new Error(
        `No F1.com metadata match for ${bridge.firstName} ${bridge.lastName}`
      );
    }

    const code = bridge.code ?? null;

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
        code,
        firstName: meta.firstName,
        lastName: meta.lastName,
        fullName: meta.fullName,
        nationality: meta.nationality,
        driverNumber:
          row?.driver_number != null ? Number(row.driver_number) : null,
        headshotUrl:
          meta.firstName && meta.lastName
            ? headshot(meta.firstName, meta.lastName)
            : null,
      },
      constructor: {
        name: normalizeTeamName(meta.teamName),
        fullName: meta.teamName,
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

  const [liveStandings, f1Metadata] = await Promise.all([
    getOpenF1StandingsForLatestRace(),
    getF1ComMetadata(),
  ]);

  if (!liveStandings.ok || liveStandings.rows.length === 0) {
    throw new Error(liveStandings.note || "OpenF1 standings unavailable.");
  }

  if (!f1Metadata.ok || f1Metadata.byName.size === 0) {
    throw new Error(f1Metadata.note || "F1.com metadata unavailable.");
  }

  console.log(`OpenF1 standings rows: ${liveStandings.rows.length}`);
  console.log(`OpenF1 bridge rows: ${liveStandings.bridgeByNumber.size}`);
  console.log(`F1.com driver metadata rows: ${f1Metadata.byName.size}`);

  const mergedDrivers = buildMergedStandings(
    liveStandings.rows,
    liveStandings.bridgeByNumber,
    f1Metadata.byName
  );

  const race = liveStandings.raceSession;

  const out = {
    header: `${liveStandings.season ?? "Current"} Driver Standings`,
    generatedAtUtc: now,
    season: liveStandings.season,
    mode: "LIVE",
    source: {
      kind: "openf1+f1com",
      url: liveStandings.sourceUrl,
      note: "Standings from OpenF1; driver and team metadata from F1.com.",
      metadataUrls: f1Metadata.sourceUrls,
      bridgeUrl: liveStandings.bridgeUrl,
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