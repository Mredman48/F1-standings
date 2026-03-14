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

function stripF1Markers(s) {
  return cleanLine(String(s || "").replace(/【[^】]+】/g, " "));
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

function classifyPosition(pos) {
  const p = String(pos || "").toUpperCase().trim();
  if (/^P\d+$/.test(p)) return { kind: "classified", rank: Number(p.slice(1)) };
  if (["DNF", "DNS", "NC", "DSQ"].includes(p)) return { kind: "status", rank: Infinity };
  return { kind: "blank", rank: Infinity };
}

function shouldUseLatestResult(existingBest, latestResult) {
  const existing = classifyPosition(existingBest?.position || "-");
  const latest = classifyPosition(latestResult?.position || "-");

  if (latest.kind === "blank") return false;

  if (latest.kind === "classified") {
    if (existing.kind !== "classified") return true;
    return latest.rank < existing.rank;
  }

  if (latest.kind === "status") {
    return existing.kind === "blank";
  }

  return false;
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

async function readJsonIfExists(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
/* EXISTING BEST RESULT BASELINE */
/* -------------------------------- */

async function readExistingBestResults() {
  const map = new Map();

  for (const teamConfig of TEAMS) {
    const data = await readJsonIfExists(teamConfig.outputFile);
    const drivers = data?.drivers || [];

    for (const d of drivers) {
      const num = Number(d?.driverNumber);
      if (!Number.isFinite(num) || num <= 0) continue;

      if (d?.bestResult) {
        map.set(num, d.bestResult);
      }
    }
  }

  return map;
}

/* -------------------------------- */
/* LATEST COMPLETED OFFICIAL F1 EVENT */
/* -------------------------------- */

function extractOfficialResultUrls(indexHtml) {
  const urls = new Set();

  const re =
    /\/en\/results\/\d{4}\/races\/\d+\/[^"'?#\s]+\/(?:race-result|sprint-results)/gi;

  for (const match of indexHtml.matchAll(re)) {
    const abs = toAbsoluteF1Url(match[0]);
    if (abs && abs.includes(`/${YEAR}/races/`)) {
      urls.add(abs);
    }
  }

  return [...urls];
}

function parseEventMeta(lines, sourceUrl) {
  const headingIndex = lines.findIndex((line) =>
    /^#\s+FORMULA 1 /i.test(cleanLine(line))
  );
  if (headingIndex === -1) return null;

  const heading = cleanLine(lines[headingIndex]);
  const dateLine = cleanLine(lines[headingIndex + 4] || lines[headingIndex + 5] || "-");
  const circuitLine = cleanLine(lines[headingIndex + 6] || lines[headingIndex + 7] || "-");

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
  const round = roundMatch ? Number(roundMatch[1]) : 0;

  return {
    eventType,
    raceName,
    round,
    date: dateLine,
    circuit,
    locality,
    country: "-",
    sourceUrl,
  };
}

function parseOfficialResultRows(lines, meta) {
  const start = lines.findIndex((line) =>
    /^Pos\.No\.Driver Team Laps Time \/ Retired Pts\.$/i.test(cleanLine(line))
  );
  if (start === -1) return [];

  const out = [];

  for (let i = start + 1; i < lines.length; i += 1) {
    let line = cleanLine(lines[i]);
    if (!line) continue;
    if (/^\* Provisional results\./i.test(line)) continue;
    if (/^##\s+/i.test(line)) break;
    if (/^OUR PARTNERS$/i.test(line)) break;
    if (/^Download the Official F1 App$/i.test(line)) break;
    if (/^View all$/i.test(line)) continue;
    if (/^No results available$/i.test(line)) break;
    if (/^Error$/i.test(line)) break;

    line = stripF1Markers(line);

    const match = line.match(
      /^(NC|DSQ|DNS|DNF|\d+)\s+(\d+)\s+(.+?)\s+([A-Z]{3})\s+(.+?)\s+(\d+)\s+(.+?)\s+(\d+)$/
    );

    if (!match) continue;

    const [, posRaw, numRaw, fullNameRaw, code, teamRaw] = match;
    const num = Number(numRaw);
    if (!Number.isFinite(num) || num <= 0) continue;

    let positionText = "-";

    if (/^\d+$/.test(posRaw)) {
      positionText = `P${Number(posRaw)}`;
    } else if (["DNF", "DNS", "DSQ", "NC"].includes(String(posRaw).toUpperCase())) {
      positionText = String(posRaw).toUpperCase();
    }

    out.push({
      driverNumber: num,
      fullName: cleanLine(fullNameRaw),
      code: code.toUpperCase(),
      team: normalizeTeamName(cleanLine(teamRaw)),
      bestResult: {
        position: positionText,
        eventType: meta.eventType,
        raceName: meta.raceName,
        round: String(meta.round || "-"),
        date: meta.date,
        circuit: meta.circuit,
        location: {
          locality: meta.locality,
          country: meta.country,
        },
        sourceUrl: meta.sourceUrl,
      },
    });
  }

  return out;
}

function eventSortValue(meta) {
  if (!meta) return -1;
  const typeWeight = meta.eventType === "race" ? 2 : 1;
  return meta.round * 10 + typeWeight;
}

async function getLatestCompletedEventResults() {
  const indexHtml = await fetchText(F1_RESULTS_RACES_INDEX_URL);
  const urls = extractOfficialResultUrls(indexHtml);

  let bestEvent = null;

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const lines = htmlToLines(html);
      const meta = parseEventMeta(lines, url);
      if (!meta) continue;

      const rows = parseOfficialResultRows(lines, meta);
      if (rows.length === 0) continue;

      if (!bestEvent || eventSortValue(meta) > eventSortValue(bestEvent.meta)) {
        bestEvent = { meta, rows };
      }
    } catch (err) {
      console.warn(`Skipping latest-event candidate ${url}: ${err.message}`);
    }

    await sleep(100);
  }

  return bestEvent;
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

function buildLatestResultMap(latestEvent) {
  const map = new Map();
  for (const row of latestEvent?.rows || []) {
    map.set(Number(row.driverNumber), row.bestResult);
  }
  return map;
}

async function buildTeamJson(
  teamConfig,
  driverData,
  constructorData,
  existingBestMap,
  latestResultMap,
  lastRace,
  latestEventMeta
) {
  const teamDrivers = getTeamDrivers(driverData, teamConfig);
  const teamStanding = getTeamConstructor(constructorData, teamConfig);

  const drivers = [];

  for (const d of teamDrivers) {
    const drv = d.driver || {};
    const first = drv.firstName || "-";
    const last = drv.lastName || "-";
    const num = Number(drv.driverNumber) || null;

    let bestResult = existingBestMap.get(num) || emptyBestResult();
    const latestResult = latestResultMap.get(num);

    if (latestResult && shouldUseLatestResult(bestResult, latestResult)) {
      bestResult = latestResult;
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
      bestResults: latestEventMeta
        ? `Previous team JSON bestResult, overwritten only if latest official F1 ${latestEventMeta.eventType} result is better`
        : "Previous team JSON bestResult only",
      lastRace: JOLPICA_LAST_RACE_URL,
    },

    meta: {
      latestEventChecked: latestEventMeta
        ? {
            eventType: latestEventMeta.eventType,
            raceName: latestEventMeta.raceName,
            round: String(latestEventMeta.round || "-"),
            date: latestEventMeta.date,
            sourceUrl: latestEventMeta.sourceUrl,
          }
        : null,
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
  const [
    driverData,
    constructorData,
    jolpicaLastRace,
    existingBestMap,
    latestEvent,
  ] = await Promise.all([
    readJson(DRIVER_STANDINGS_FILE),
    readJson(CONSTRUCTOR_STANDINGS_FILE),
    getLastRaceMeta(),
    readExistingBestResults(),
    getLatestCompletedEventResults(),
  ]);

  const mergedLastRace = mergeLastRace(constructorData.lastRace, jolpicaLastRace);
  const latestResultMap = buildLatestResultMap(latestEvent);

  if (latestEvent?.meta) {
    console.log(
      `Latest completed event: round ${latestEvent.meta.round} ${latestEvent.meta.raceName} (${latestEvent.meta.eventType})`
    );
  } else {
    console.log("No latest completed official F1 event results found.");
  }

  for (const teamConfig of TEAMS) {
    const out = await buildTeamJson(
      teamConfig,
      driverData,
      constructorData,
      existingBestMap,
      latestResultMap,
      mergedLastRace,
      latestEvent?.meta || null
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
