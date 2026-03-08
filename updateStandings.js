import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_SESSIONS_URL = `${OPENF1_BASE}/sessions`;
const OPENF1_CHAMPIONSHIP_URL = `${OPENF1_BASE}/championship_drivers`;

const F1_DRIVERS_URL = "https://www.formula1.com/en/drivers";

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

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
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
/* F1.COM: DRIVER PROFILE METADATA */
/* ------------------------------------------------ */

function extractDriverProfileUrls(html) {
  const matches = Array.from(
    String(html).matchAll(/\/en\/drivers\/[a-z0-9-]+/g)
  ).map((m) => m[0]);

  const unique = [...new Set(matches)]
    .filter((href) => !href.endsWith("/en/drivers"))
    .filter((href) => href !== "/en/drivers");

  return unique.map((href) => `https://www.formula1.com${href}`);
}

function parseDriverProfile(html, url) {
  const lines = htmlToLines(html);

  const nameIdx = lines.findIndex((line) => /^#\s+/.test(line));
  if (nameIdx === -1) {
    throw new Error(`Could not parse driver name from profile: ${url}`);
  }

  const fullName = cleanLine(lines[nameIdx].replace(/^#\s+/, ""));
  if (!fullName) {
    throw new Error(`Empty driver name in profile: ${url}`);
  }

  const window = lines.slice(nameIdx + 1, nameIdx + 20);

  const numberIdx = window.findIndex((line) => /^\d{1,3}$/.test(line));
  if (numberIdx === -1) {
    throw new Error(`Could not parse driver number from profile: ${url}`);
  }

  const driverNumber = Number(window[numberIdx]);

  let teamName = null;
  for (let i = numberIdx - 1; i >= 0; i -= 1) {
    const line = cleanLine(window[i]);
    if (!line) continue;
    if (/^Flag of /i.test(line)) continue;
    if (/^Shop now$/i.test(line)) continue;
    if (/^Statistics$/i.test(line)) continue;
    if (/^[A-Z0-9 .'-]+$/.test(line) && /^\d+$/.test(line)) continue;

    teamName = line;
    break;
  }

  let nationality = null;
  if (teamName) {
    const teamIdx = window.findIndex((line) => cleanLine(line) === cleanLine(teamName));
    for (let i = teamIdx - 1; i >= 0; i -= 1) {
      const line = cleanLine(window[i]);
      if (!line) continue;
      if (/^Flag of /i.test(line)) continue;
      nationality = line;
      break;
    }
  }

  const parts = fullName.split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : fullName;
  const lastName = parts.length > 1 ? parts[parts.length - 1] : null;

  const slugPart = url.split("/en/drivers/")[1] || "";

  return {
    url,
    slug: slugPart,
    driverNumber,
    firstName,
    lastName,
    fullName,
    nationality,
    teamName,
  };
}

async function getF1ComDriverMetadata() {
  const driversPage = await fetchText(F1_DRIVERS_URL);

  if (!driversPage.ok) {
    return {
      ok: false,
      byNumber: new Map(),
      sourceUrl: F1_DRIVERS_URL,
      note: `Drivers page HTTP ${driversPage.status}`,
    };
  }

  const profileUrls = extractDriverProfileUrls(driversPage.text);

  if (profileUrls.length === 0) {
    return {
      ok: false,
      byNumber: new Map(),
      sourceUrl: F1_DRIVERS_URL,
      note: "No driver profile URLs found on F1.com drivers page.",
    };
  }

  console.log(`F1.com driver profile URLs found: ${profileUrls.length}`);

  const byNumber = new Map();

  for (const url of profileUrls) {
    const resp = await fetchText(url);

    if (!resp.ok) {
      throw new Error(`Driver profile HTTP ${resp.status}: ${url}`);
    }

    const parsed = parseDriverProfile(resp.text, url);
    const key = driverKey(parsed.driverNumber);

    if (!key) {
      throw new Error(`Parsed profile missing driver number: ${url}`);
    }

    byNumber.set(key, parsed);
  }

  return {
    ok: byNumber.size > 0,
    byNumber,
    sourceUrl: F1_DRIVERS_URL,
    note: byNumber.size > 0 ? null : "Parsed no driver profile metadata from F1.com",
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
      !row.constructor.fullName
  );

  if (bad.length > 0) {
    const sample = bad.slice(0, 8).map((row) => ({
      driverNumber: row.driver.driverNumber,
      fullName: row.driver.fullName,
      team: row.constructor.fullName,
    }));

    throw new Error(
      `Merged standings metadata incomplete for ${bad.length} row(s). Sample: ${JSON.stringify(sample)}`
    );
  }
}

function buildMergedStandings(openf1Rows, f1ByNumber) {
  const rows = openf1Rows.map((row) => {
    const key = driverKey(row?.driver_number);
    const meta = key ? f1ByNumber.get(key) ?? null : null;

    if (!meta) {
      throw new Error(
        `No F1.com profile metadata match for driver_number=${row?.driver_number}`
      );
    }

    const code =
      meta.lastName && meta.lastName.length >= 3
        ? meta.lastName.slice(0, 3).toUpperCase()
        : null;

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
        firstName: meta.firstName ?? null,
        lastName: meta.lastName ?? null,
        fullName: meta.fullName ?? null,
        nationality: meta.nationality ?? null,
        driverNumber:
          row?.driver_number != null ? Number(row.driver_number) : null,
        headshotUrl:
          meta.firstName && meta.lastName
            ? headshot(meta.firstName, meta.lastName)
            : null,
        profileUrl: meta.url,
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

  const [liveStandings, f1Metadata] = await Promise.all([
    getOpenF1StandingsForLatestRace(),
    getF1ComDriverMetadata(),
  ]);

  if (!liveStandings.ok || liveStandings.rows.length === 0) {
    throw new Error(liveStandings.note || "OpenF1 standings unavailable.");
  }

  if (!f1Metadata.ok || f1Metadata.byNumber.size === 0) {
    throw new Error(f1Metadata.note || "F1.com driver metadata unavailable.");
  }

  console.log(`OpenF1 standings rows: ${liveStandings.rows.length}`);
  console.log(`F1.com driver metadata rows: ${f1Metadata.byNumber.size}`);

  const mergedDrivers = buildMergedStandings(
    liveStandings.rows,
    f1Metadata.byNumber
  );

  const race = liveStandings.raceSession;

  const out = {
    header: `${liveStandings.season ?? "Current"} Driver Standings`,
    generatedAtUtc: now,
    season: liveStandings.season,
    mode: "LIVE",
    source: {
      kind: "openf1+f1com-driver-profiles",
      url: liveStandings.sourceUrl,
      note: "Standings from OpenF1; driver and team metadata from official F1.com driver profile pages.",
      metadataUrl: f1Metadata.sourceUrl,
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