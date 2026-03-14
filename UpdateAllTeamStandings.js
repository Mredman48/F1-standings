import fs from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DRIVER_STANDINGS_FILE = "f1_driver_standings.json";
const CONSTRUCTOR_STANDINGS_FILE = "f1_constructors_standings.json";

const YEAR = new Date().getUTCFullYear();

const F1_RESULTS_RACES_INDEX_URL = `https://www.formula1.com/en/results/${YEAR}/races`;
const JOLPICA_LAST_RACE_URL =
  "https://api.jolpi.ca/ergast/f1/current/last/results.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

const DRIVER_FIRSTNAME_OVERRIDES = {
  alexander: "alex",
};

const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Racing Bulls": "VCARB",
  "Visa Cash App Racing Bulls": "VCARB",

  "Haas F1 Team": "Haas",
  "MoneyGram Haas F1 Team": "Haas",
  "Haas Ferrari": "Haas",

  "Alpine F1 Team": "Alpine",
  "BWT Alpine Formula One Team": "Alpine",
  "Alpine Renault": "Alpine",

  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",
  "Red Bull Racing Honda RBPT": "Red Bull",

  "Kick Sauber": "Audi",
  "Stake F1 Team Kick Sauber": "Audi",
  "Audi Formula 1 Team": "Audi",
  "Audi Formula One Team": "Audi",
  "Audi Revolut": "Audi",
  Sauber: "Audi",

  Cadillac: "Cadillac",
  "Cadillac F1 Team": "Cadillac",
  "Cadillac Formula 1 Team": "Cadillac",
  "Cadillac Formula One Team": "Cadillac",

  "McLaren Formula 1 Team": "McLaren",
  "McLaren Mercedes": "McLaren",

  "Mercedes-AMG PETRONAS Formula One Team": "Mercedes",

  "Scuderia Ferrari HP": "Ferrari",

  "Williams Racing": "Williams",
  "Williams Mercedes": "Williams",

  "Aston Martin Aramco Formula One Team": "Aston Martin",
  "Aston Martin Aramco Mercedes": "Aston Martin",
};

const TEAMS = [
  {
    key: "redbull",
    displayName: "Red Bull",
    outputFile: "f1_redbull_standings.json",
    objectKey: "redBull",
    keywords: ["red bull"],
    logoFile: "2025_red-bull_color_v2.png",
  },
  {
    key: "ferrari",
    displayName: "Ferrari",
    outputFile: "f1_ferrari_standings.json",
    objectKey: "ferrari",
    keywords: ["ferrari"],
    logoFile: "2025_ferrari_color_v2.png",
  },
  {
    key: "mercedes",
    displayName: "Mercedes",
    outputFile: "f1_mercedes_standings.json",
    objectKey: "mercedes",
    keywords: ["mercedes"],
    logoFile: "2025_mercedes_color_v2.png",
  },
  {
    key: "mclaren",
    displayName: "McLaren",
    outputFile: "f1_mclaren_standings.json",
    objectKey: "mclaren",
    keywords: ["mclaren"],
    logoFile: "2025_mclaren_color_v2.png",
  },
  {
    key: "alpine",
    displayName: "Alpine",
    outputFile: "f1_alpine_standings.json",
    objectKey: "alpine",
    keywords: ["alpine"],
    logoFile: "2025_alpine_color_v2.png",
  },
  {
    key: "astonmartin",
    displayName: "Aston Martin",
    outputFile: "f1_astonmartin_standings.json",
    objectKey: "astonMartin",
    keywords: ["aston martin"],
    logoFile: "2025_aston-martin_color_v2.png",
  },
  {
    key: "williams",
    displayName: "Williams",
    outputFile: "f1_williams_standings.json",
    objectKey: "williams",
    keywords: ["williams"],
    logoFile: "2025_williams_color_v2.png",
  },
  {
    key: "haas",
    displayName: "Haas",
    outputFile: "f1_haas_standings.json",
    objectKey: "haas",
    keywords: ["haas"],
    logoFile: "2025_haas_color_v2.png",
  },
  {
    key: "audi",
    displayName: "Audi",
    outputFile: "f1_audi_standings.json",
    objectKey: "audi",
    keywords: ["audi", "sauber"],
    logoFile: "audi_logo_colored.png",
  },
  {
    key: "cadillac",
    displayName: "Cadillac",
    outputFile: "f1_cadillac_standings.json",
    objectKey: "cadillac",
    keywords: ["cadillac"],
    logoFile: "2025_cadillac_color_v2.png",
  },
  {
    key: "vcarb",
    displayName: "VCARB",
    outputFile: "f1_vcarb_standings.json",
    objectKey: "vcarb",
    keywords: ["vcarb", "racing bulls", "visa cash app rb", "rb f1 team"],
    logoFile: "2025_vcarb_color_v2.png",
  },
];

/* -------------------------------- */
/* HELPERS */
/* -------------------------------- */

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberImage(num) {
  if (!num) return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${num}.png`;
}

async function headshot(first, last) {
  if (!first || !last) return null;

  let firstName = String(first).toLowerCase();
  if (DRIVER_FIRSTNAME_OVERRIDES[firstName]) {
    firstName = DRIVER_FIRSTNAME_OVERRIDES[firstName];
  }

  const file = `${slug(firstName)}-${slug(last)}.png`;
  return `${PAGES_BASE}/${HEADSHOTS_DIR}/${file}`;
}

function normalizePoints(val) {
  if (val === "-" || val === "" || val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStandingPosition(pos) {
  if (!pos) return "-";

  const p = String(pos).toUpperCase().trim();

  if (p === "P0") return "-";
  if (p === "DNF") return "DNF";
  if (p === "DNS") return "DNS";
  if (p === "DSQ") return "DSQ";
  if (p === "NC") return "NC";

  const n = Number(p.replace(/^P/, ""));
  if (!Number.isFinite(n) || n <= 0) return "-";

  return `P${n}`;
}

function normalizeTeamName(name) {
  return TEAM_NAME_OVERRIDES[name] || name;
}

function normalizeLocation(input) {
  return {
    locality: input?.locality ?? input?.location?.locality ?? "-",
    country: input?.country ?? input?.location?.country ?? "-",
  };
}

function emptyBestResult(position = "-") {
  return {
    position,
    eventType: "-",
    raceName: "-",
    round: "-",
    date: "-",
    circuit: "-",
    location: {
      locality: "-",
      country: "-",
    },
    sourceUrl: null,
  };
}

function emptyLastRace() {
  return {
    raceName: "-",
    round: "-",
    date: "-",
    circuit: "-",
    location: {
      locality: "-",
      country: "-",
    },
  };
}

function normalizeRaceName(name) {
  const value = String(name || "").trim();
  return value || "-";
}

function dateOnly(value) {
  if (!value) return "-";
  const s = String(value);
  return s.includes("T") ? s.slice(0, 10) : s.slice(0, 10);
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
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
  text = text.replace(
    /<\/(p|div|section|article|header|footer|main|li|tr|td|th|h1|h2|h3|h4|h5|h6|a|ul|ol)>/gi,
    "\n"
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);

  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "-", lastName: "-" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "-" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function matchesTeamName(name, keywords) {
  const value = String(name || "").toLowerCase();
  return keywords.some((keyword) => value.includes(keyword));
}

function toAbsoluteF1Url(href) {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `https://www.formula1.com${href}`;
  return `https://www.formula1.com/${href}`;
}

function bestResultFromSeasonResult(result) {
  return {
    position: `P${result.position}`,
    eventType: result.eventType,
    raceName: result.raceName ?? "-",
    round: result.round ?? "-",
    date: result.date ?? "-",
    circuit: result.circuit ?? "-",
    location: {
      locality: result.locality ?? "-",
      country: result.country ?? "-",
    },
    sourceUrl: result.sourceUrl ?? null,
  };
}

/* -------------------------------- */
/* FETCH */
/* -------------------------------- */

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: accept,
      "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: "https://www.formula1.com/",
    },
    redirect: "follow",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return text;
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
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return JSON.parse(text);
}

/* -------------------------------- */
/* READ LOCAL JSON */
/* -------------------------------- */

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* -------------------------------- */
/* LAST RACE */
/* -------------------------------- */

async function getLastRaceMeta() {
  const data = await fetchJson(JOLPICA_LAST_RACE_URL);
  const race = data?.MRData?.RaceTable?.Races?.[0];

  if (!race) return null;

  return {
    raceName: normalizeRaceName(race?.raceName),
    round: String(race?.round ?? "-"),
    date: race?.date ?? "-",
    circuit: race?.Circuit?.circuitName ?? "-",
    location: {
      locality: race?.Circuit?.Location?.locality ?? "-",
      country: race?.Circuit?.Location?.country ?? "-",
    },
  };
}

function mergeLastRace(existingLastRace, jolpicaLastRace) {
  const base = existingLastRace
    ? {
        ...existingLastRace,
        location: normalizeLocation(existingLastRace),
      }
    : emptyLastRace();

  if (!jolpicaLastRace) return base;

  return {
    ...base,
    raceName: jolpicaLastRace.raceName ?? base.raceName ?? "-",
    round: jolpicaLastRace.round ?? base.round ?? "-",
    date: jolpicaLastRace.date ?? base.date ?? "-",
    circuit: jolpicaLastRace.circuit ?? base.circuit ?? "-",
    location: {
      locality:
        jolpicaLastRace.location?.locality ?? base.location?.locality ?? "-",
      country:
        jolpicaLastRace.location?.country ?? base.location?.country ?? "-",
    },
  };
}

/* -------------------------------- */
/* OFFICIAL F1 RESULTS PARSING */
/* -------------------------------- */

function buildTeamPattern() {
  const names = new Set([
    "Mercedes",
    "Ferrari",
    "McLaren",
    "Haas F1 Team",
    "Haas",
    "Racing Bulls",
    "VCARB",
    "Red Bull Racing",
    "Red Bull",
    "Alpine",
    "Williams",
    "Audi",
    "Aston Martin",
    "Cadillac",
    ...Object.keys(TEAM_NAME_OVERRIDES),
  ]);

  return [...names]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

const TEAM_PATTERN = buildTeamPattern();

function parseEventMeta(lines, sourceUrl) {
  const headingIndex = lines.findIndex((line) => /^#\s+FORMULA 1 /i.test(line));
  if (headingIndex === -1) return null;

  const heading = cleanLine(lines[headingIndex]);
  const date = cleanLine(lines[headingIndex + 3] || "-");
  const circuitLine = cleanLine(lines[headingIndex + 4] || "-");

  const eventType = /-\s*SPRINT$/i.test(heading) ? "sprint" : "race";
  const raceName = heading
    .replace(/^#\s*/i, "")
    .replace(/\s+\d{4}\s*-\s*(SPRINT|RACE RESULT)$/i, "")
    .trim();

  let circuit = "-";
  let locality = "-";

  if (circuitLine.includes(",")) {
    const parts = circuitLine.split(",").map((s) => s.trim());
    circuit = parts[0] || "-";
    locality = parts[1] || "-";
  } else {
    circuit = circuitLine || "-";
  }

  const roundMatch = sourceUrl.match(/\/races\/(\d+)\//);
  const round = roundMatch ? roundMatch[1] : "-";

  return {
    eventType,
    raceName,
    round,
    date,
    circuit,
    locality,
  };
}

function parseResultLine(line) {
  const value = cleanLine(line);

  const rowRe = new RegExp(
    `^(NC|DSQ|DNS|DNF|\\d+)\\s+(\\d+)\\s+(.+?)\\s+([A-Z]{3})\\s+(${TEAM_PATTERN})\\s+(\\d+)\\s+(.+?)\\s+(\\d+)$`,
    "i"
  );

  const match = value.match(rowRe);
  if (!match) return null;

  const [, posRaw, driverNumberRaw, fullNameRaw, code, teamRaw, lapsRaw] = match;

  const pos = Number(posRaw);
  if (!Number.isFinite(pos) || pos <= 0) return null;

  const fullName = cleanLine(fullNameRaw);
  const { firstName, lastName } = splitFullName(fullName);

  return {
    position: pos,
    driverNumber: Number(driverNumberRaw),
    code: code.toUpperCase(),
    firstName,
    lastName,
    fullName,
    team: normalizeTeamName(teamRaw),
    laps: Number(lapsRaw),
  };
}

function extractResultRows(lines, meta, sourceUrl) {
  const start = lines.findIndex((line) =>
    /^Pos\.No\.Driver Team Laps Time \/ Retired Pts\.$/i.test(cleanLine(line))
  );

  if (start === -1) return [];

  const out = [];

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = cleanLine(lines[i]);
    if (!line) continue;
    if (/^\* Provisional results\./i.test(line)) continue;
    if (/^##\s+/i.test(line)) break;
    if (/^OUR PARTNERS$/i.test(line)) break;

    const row = parseResultLine(line);
    if (!row) continue;

    out.push({
      ...row,
      eventType: meta.eventType,
      raceName: meta.raceName,
      round: meta.round,
      date: meta.date,
      circuit: meta.circuit,
      locality: meta.locality,
      country: "-",
      sourceUrl,
    });
  }

  return out;
}

async function getOfficialF1ResultUrls() {
  const html = await fetchText(F1_RESULTS_RACES_INDEX_URL);
  const urls = new Set();

  const hrefRe =
    /href="([^"]*\/en\/results\/\d{4}\/races\/\d+\/[^"/]+\/(?:race-result|sprint-results))"/gi;

  for (const match of html.matchAll(hrefRe)) {
    const abs = toAbsoluteF1Url(match[1]);
    if (abs && abs.includes(`/${YEAR}/races/`)) {
      urls.add(abs);
    }
  }

  return [...urls].sort();
}

async function getSeasonBestResultsByDriverNumber() {
  const resultUrls = await getOfficialF1ResultUrls();

  if (resultUrls.length === 0) {
    console.warn("No official F1 race/sprint result URLs found.");
    return {
      bestByNumber: {},
      sourceCount: 0,
    };
  }

  const allRows = [];

  for (const url of resultUrls) {
    try {
      const html = await fetchText(url);
      const lines = htmlToLines(html);
      const meta = parseEventMeta(lines, url);

      if (!meta) continue;

      const rows = extractResultRows(lines, meta, url);
      allRows.push(...rows);
    } catch (err) {
      console.warn(`Skipping result page ${url}: ${err.message}`);
    }

    await sleep(120);
  }

  const bestByNumber = {};

  for (const row of allRows) {
    const num = row.driverNumber;
    if (!Number.isFinite(num) || num <= 0) continue;

    if (
      !bestByNumber[num] ||
      row.position < bestByNumber[num].position ||
      (row.position === bestByNumber[num].position &&
        String(row.date) < String(bestByNumber[num].date))
    ) {
      bestByNumber[num] = row;
    }
  }

  return {
    bestByNumber,
    sourceCount: resultUrls.length,
  };
}

/* -------------------------------- */
/* TEAM BUILDERS */
/* -------------------------------- */

function getTeamDrivers(driverData, teamConfig) {
  return (driverData.drivers || []).filter((d) => {
    const teamA = d?.constructor?.name || "";
    const teamB = d?.constructor?.fullName || "";
    return (
      matchesTeamName(teamA, teamConfig.keywords) ||
      matchesTeamName(teamB, teamConfig.keywords)
    );
  });
}

function getTeamConstructor(constructorData, teamConfig) {
  const row = (constructorData.constructors || []).find((c) =>
    matchesTeamName(c.team, teamConfig.keywords)
  );

  if (!row) {
    return {
      team: teamConfig.displayName,
      position: "-",
      points: 0,
      wins: 0,
    };
  }

  return {
    team: teamConfig.displayName,
    position: normalizeStandingPosition(row.position),
    points: normalizePoints(row.points),
    wins: normalizePoints(row.wins),
  };
}

async function buildTeamJson(
  teamConfig,
  driverData,
  constructorData,
  seasonBestPack,
  lastRace
) {
  const teamDrivers = getTeamDrivers(driverData, teamConfig);
  const teamStanding = getTeamConstructor(constructorData, teamConfig);

  const drivers = [];

  for (const d of teamDrivers) {
    const drv = d.driver || {};

    const first = drv.firstName || "-";
    const last = drv.lastName || "-";
    const num = Number(drv.driverNumber) || null;

    let bestResult = emptyBestResult();

    if (num && seasonBestPack.bestByNumber[num]) {
      bestResult = bestResultFromSeasonResult(seasonBestPack.bestByNumber[num]);
    }

    drivers.push({
      firstName: first,
      lastName: last,
      code: drv.code || "-",
      driverNumber: num,

      numberImageUrl: numberImage(num),
      headshotUrl: await headshot(first, last),

      position: normalizeStandingPosition(d.position),
      points: normalizePoints(d.points),
      wins: normalizePoints(d.wins),

      team: teamConfig.displayName,
      bestResult,
    });
  }

  return {
    header: `${teamConfig.displayName} standings`,
    generatedAtUtc: new Date().toISOString(),

    sources: {
      driverStandings: DRIVER_STANDINGS_FILE,
      constructorStandings: CONSTRUCTOR_STANDINGS_FILE,
      bestResults: `Official F1 race-result + sprint-results pages (${seasonBestPack.sourceCount} pages scanned)`,
      lastRace: JOLPICA_LAST_RACE_URL,
    },

    [teamConfig.objectKey]: {
      team: teamConfig.displayName,
      teamLogoPng: `${PAGES_BASE}/${TEAMLOGOS_DIR}/${teamConfig.logoFile}`,
      teamStanding,
    },

    lastRace,

    drivers,
  };
}

/* -------------------------------- */
/* MAIN */
/* -------------------------------- */

async function updateAllTeamStandings() {
  const [driverData, constructorData, jolpicaLastRace, seasonBestPack] =
    await Promise.all([
      readJson(DRIVER_STANDINGS_FILE),
      readJson(CONSTRUCTOR_STANDINGS_FILE),
      getLastRaceMeta(),
      getSeasonBestResultsByDriverNumber(),
    ]);

  const mergedLastRace = mergeLastRace(constructorData.lastRace, jolpicaLastRace);

  for (const teamConfig of TEAMS) {
    const out = await buildTeamJson(
      teamConfig,
      driverData,
      constructorData,
      seasonBestPack,
      mergedLastRace
    );

    await fs.writeFile(
      teamConfig.outputFile,
      JSON.stringify(out, null, 2),
      "utf8"
    );

    console.log(`Wrote ${teamConfig.outputFile}`);
  }
}

updateAllTeamStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
