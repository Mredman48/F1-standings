import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const F1_RESULTS_BASE = "https://www.formula1.com/en/results";
const F1_DRIVERS_URL = "https://www.formula1.com/en/drivers";

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
    "Racing Bulls": "VCARB",
    "Haas F1 Team": "Haas",
    "Alpine F1 Team": "Alpine",
    "Kick Sauber": "Sauber"
  };

  return map[name] || name;
}

function getSeasonYear() {
  return new Date().getUTCFullYear();
}

function buildResultsUrl(year) {
  return `${F1_RESULTS_BASE}/${year}/drivers`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });

  const text = await res.text();
  return { res, text };
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

  // Break major tags into line boundaries
  text = text.replace(/<\/(p|div|section|article|header|footer|main|li|tr|td|th|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text);

  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function splitNameAndCode(str) {
  const m = String(str).match(/^(.*)\s+([A-Z]{3})$/);
  if (!m) {
    return {
      fullName: str.trim(),
      code: null
    };
  }

  return {
    fullName: m[1].trim(),
    code: m[2].trim()
  };
}

function splitFullName(fullName) {
  const parts = String(fullName).trim().split(/\s+/);

  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]
  };
}

function parseStandingsTokens(sectionLines) {
  const rows = [];
  let i = 0;

  while (i < sectionLines.length) {
    const posLine = sectionLines[i];

    if (!/^\d+$/.test(posLine)) {
      i += 1;
      continue;
    }

    const positionNumber = Number(posLine);
    const nameCodeLine = sectionLines[i + 1] ?? "";
    const nationality = sectionLines[i + 2] ?? "";
    const team = sectionLines[i + 3] ?? "";
    const pointsLine = sectionLines[i + 4] ?? "";

    if (!nameCodeLine || !team || !pointsLine) {
      i += 1;
      continue;
    }

    if (!/^[A-Z]{3}$/.test(nationality)) {
      i += 1;
      continue;
    }

    if (!/^\d+(?:\.\d+)?$/.test(pointsLine)) {
      i += 1;
      continue;
    }

    const { fullName, code } = splitNameAndCode(nameCodeLine);
    const { firstName, lastName } = splitFullName(fullName);

    rows.push({
      position: `P${positionNumber}`,
      positionNumber,
      points: Number(pointsLine),
      wins: "-",
      driver: {
        code,
        firstName,
        lastName,
        fullName,
        nationality,
        driverNumber: null,
        headshotUrl: firstName && lastName ? headshot(firstName, lastName) : null
      },
      constructor: {
        name: normalizeTeamName(team),
        fullName: team,
        nationality: null
      }
    });

    i += 5;
  }

  return rows;
}

function extractStandingsSection(lines, year) {
  const headingIndex = lines.findIndex(
    (line) =>
      line.includes(`${year} Drivers' Standings`) ||
      line.includes(`${year} Drivers’ Standings`)
  );

  if (headingIndex === -1) {
    return [];
  }

  const partnersIndex = lines.findIndex(
    (line, idx) => idx > headingIndex && /OUR PARTNERS/i.test(line)
  );

  const endIndex = partnersIndex === -1 ? lines.length : partnersIndex;

  return lines.slice(headingIndex, endIndex);
}

function parseF1ResultsStandings(html, year) {
  const lines = htmlToLines(html);
  const section = extractStandingsSection(lines, year);

  if (!section.length) {
    return { season: year, drivers: [], reason: "heading_not_found" };
  }

  const joined = section.join("\n");
  if (/No results available/i.test(joined) || /\bError\b/i.test(joined)) {
    return { season: year, drivers: [], reason: "no_results_available" };
  }

  const headerIndex = section.findIndex((line) =>
    /Pos\.?\s*Driver\s*Nationality\s*Team\s*Pts\.?/i.test(line)
  );

  const dataLines = headerIndex === -1 ? section : section.slice(headerIndex + 1);
  const drivers = parseStandingsTokens(dataLines);

  return {
    season: year,
    drivers,
    reason: drivers.length ? null : "no_rows_parsed"
  };
}

/* ------------------------------------------------ */
/* SOURCE 1: OFFICIAL F1.COM RESULTS PAGE */
/* ------------------------------------------------ */

async function getLiveStandingsFromF1() {
  const year = getSeasonYear();
  const url = buildResultsUrl(year);
  const { res, text } = await fetchText(url);

  if (!res.ok) {
    return {
      ok: false,
      season: year,
      drivers: [],
      sourceUrl: url,
      status: res.status,
      note: `HTTP ${res.status}`
    };
  }

  const parsed = parseF1ResultsStandings(text, year);

  if (parsed.drivers.length > 0) {
    return {
      ok: true,
      season: parsed.season,
      drivers: parsed.drivers,
      sourceUrl: url,
      status: res.status,
      note: null
    };
  }

  return {
    ok: false,
    season: parsed.season,
    drivers: [],
    sourceUrl: url,
    status: res.status,
    note: parsed.reason || "no_rows_parsed"
  };
}

/* ------------------------------------------------ */
/* SOURCE 2: OFFICIAL F1.COM DRIVERS PAGE FALLBACK */
/* ------------------------------------------------ */

function parseDriversPageRoster(html, year) {
  const lines = htmlToLines(html);

  const startIndex = lines.findIndex(
    (line) =>
      line.includes(`F1 Drivers ${year}`) ||
      line.includes("F1 Drivers")
  );

  const endIndex = lines.findIndex(
    (line, idx) => idx > startIndex && /F1 TEAMS/i.test(line)
  );

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return [];
  }

  const section = lines.slice(startIndex + 1, endIndex);

  const roster = [];

  for (const line of section) {
    if (/^Find the current Formula 1 drivers/i.test(line)) continue;
    if (/^F1 Drivers/i.test(line)) continue;

    // Example:
    // "George Russell Mercedes Flag of Great Britain"
    const m = line.match(/^(.*?)\s+(.+?)\s+Flag of\s+.+$/i);
    if (!m) continue;

    const fullName = m[1].trim();
    const team = m[2].trim();

    if (!fullName || !team) continue;

    const { firstName, lastName } = splitFullName(fullName);

    roster.push({
      firstName,
      lastName,
      fullName,
      team
    });
  }

  // Deduplicate by full name
  const seen = new Set();
  const unique = [];

  for (const row of roster) {
    const key = row.fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  unique.sort((a, b) => {
    const lastCmp = (a.lastName || "").localeCompare(b.lastName || "");
    if (lastCmp !== 0) return lastCmp;
    return (a.firstName || "").localeCompare(b.firstName || "");
  });

  return unique.map((d) => ({
    position: "-",
    positionNumber: null,
    points: "-",
    wins: "-",
    driver: {
      code: null,
      firstName: d.firstName,
      lastName: d.lastName,
      fullName: d.fullName,
      nationality: null,
      driverNumber: null,
      headshotUrl: d.firstName && d.lastName ? headshot(d.firstName, d.lastName) : null
    },
    constructor: {
      name: normalizeTeamName(d.team),
      fullName: d.team,
      nationality: null
    }
  }));
}

async function getOfficialRosterFallbackFromF1() {
  const year = getSeasonYear();
  const { res, text } = await fetchText(F1_DRIVERS_URL);

  if (!res.ok) {
    return {
      ok: false,
      drivers: [],
      sourceUrl: F1_DRIVERS_URL,
      status: res.status
    };
  }

  const drivers = parseDriversPageRoster(text, year);

  return {
    ok: drivers.length > 0,
    drivers,
    sourceUrl: F1_DRIVERS_URL,
    status: res.status
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();
  const previous = await readPreviousFile();

  // 1) Official F1.com live standings
  const live = await getLiveStandingsFromF1();
  if (live.ok && live.drivers.length > 0) {
    const out = {
      header: `${live.season ?? "Current"} Driver Standings`,
      generatedAtUtc: now,
      season: live.season,
      mode: "LIVE",
      source: {
        kind: "f1com-results",
        url: live.sourceUrl,
        note: null
      },
      lastRace: previous?.lastRace ?? null,
      drivers: live.drivers
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=LIVE drivers=${out.drivers.length}`);
    return;
  }

  // 2) Official F1.com roster fallback
  const roster = await getOfficialRosterFallbackFromF1();
  if (roster.ok && roster.drivers.length > 0) {
    const out = {
      header: "Driver Standings",
      generatedAtUtc: now,
      season: live.season ?? previous?.season ?? null,
      mode: "OFFICIAL_ROSTER_FALLBACK",
      source: {
        kind: "f1com-drivers",
        url: roster.sourceUrl,
        note: "Official F1 standings were unavailable; using official F1.com drivers roster fallback."
      },
      lastRace: previous?.lastRace ?? null,
      drivers: roster.drivers
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=OFFICIAL_ROSTER_FALLBACK drivers=${out.drivers.length}`);
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
        note: "Official F1.com standings and roster fallback were unavailable; reusing previous file."
      }
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=PREVIOUS_FILE_FALLBACK drivers=${out.drivers.length}`);
    return;
  }

  // 4) Empty
  const out = {
    header: "Driver Standings",
    generatedAtUtc: now,
    season: null,
    mode: "EMPTY",
    source: {
      kind: "none",
      url: null,
      note: "No official F1.com standings or roster data available."
    },
    lastRace: null,
    drivers: []
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} mode=EMPTY drivers=0`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});