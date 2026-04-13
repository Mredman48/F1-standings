import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";
const YEAR = new Date().getUTCFullYear();

const SKY_F1_STANDINGS_URL = "https://www.skysports.com/f1/standings";
const SEASON_RESULTS_FILE = "f1_season_event_results.json";

const HEADSHOTS = "https://mredman48.github.io/F1-standings/headshots";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/* ------------------------------------------------ */
/* DRIVER NAME FIXES FOR HEADSHOT FILES / METADATA  */
/* ------------------------------------------------ */

const DRIVER_SLUG_OVERRIDES = {
  alexander: "alex",
};

const DRIVER_NUMBER_OVERRIDES = {
  "George Russell": 63,
  "Kimi Antonelli": 12,
  "Charles Leclerc": 16,
  "Lewis Hamilton": 44,
  "Lando Norris": 1,
  "Max Verstappen": 3,
  "Oliver Bearman": 87,
  "Arvid Lindblad": 41,
  "Oscar Piastri": 81,
  "Gabriel Bortoleto": 5,
  "Liam Lawson": 30,
  "Pierre Gasly": 10,
  "Esteban Ocon": 31,
  "Alexander Albon": 23,
  "Alex Albon": 23,
  "Franco Colapinto": 43,
  "Carlos Sainz": 55,
  "Sergio Perez": 11,
  "Isack Hadjar": 6,
  "Nico Hulkenberg": 27,
  "Fernando Alonso": 14,
  "Valtteri Bottas": 77,
  "Lance Stroll": 18,
};

const DRIVER_CODE_OVERRIDES = {
  "George Russell": "RUS",
  "Kimi Antonelli": "ANT",
  "Charles Leclerc": "LEC",
  "Lewis Hamilton": "HAM",
  "Lando Norris": "NOR",
  "Max Verstappen": "VER",
  "Oliver Bearman": "BEA",
  "Arvid Lindblad": "LIN",
  "Oscar Piastri": "PIA",
  "Gabriel Bortoleto": "BOR",
  "Liam Lawson": "LAW",
  "Pierre Gasly": "GAS",
  "Esteban Ocon": "OCO",
  "Alexander Albon": "ALB",
  "Alex Albon": "ALB",
  "Franco Colapinto": "COL",
  "Carlos Sainz": "SAI",
  "Sergio Perez": "PER",
  "Isack Hadjar": "HAD",
  "Nico Hulkenberg": "HUL",
  "Fernando Alonso": "ALO",
  "Valtteri Bottas": "BOT",
  "Lance Stroll": "STR",
};

const TEAM_NAME_OVERRIDES = {
  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",

  "RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Racing Bulls": "VCARB",
  "Visa Cash App Racing Bulls": "VCARB",

  "Haas F1 Team": "Haas",
  "MoneyGram Haas F1 Team": "Haas",

  "Alpine F1 Team": "Alpine",
  "BWT Alpine Formula One Team": "Alpine",

  "Kick Sauber": "Audi",
  "Stake F1 Team Kick Sauber": "Audi",
  "Audi Formula 1 Team": "Audi",
  "Audi Formula One Team": "Audi",
  Sauber: "Audi",

  "Cadillac F1 Team": "Cadillac",
  "Cadillac Formula 1 Team": "Cadillac",
  "Cadillac Formula One Team": "Cadillac",

  "Scuderia Ferrari HP": "Ferrari",
  "Mercedes-AMG PETRONAS Formula One Team": "Mercedes",
  "Williams Racing": "Williams",
  "Aston Martin Aramco Formula One Team": "Aston Martin",
};

/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  return TEAM_NAME_OVERRIDES[name] || name;
}

function canonicalDriverName(name) {
  const cleaned = cleanText(name);

  const aliases = {
    "Alex Albon": "Alexander Albon",
    "Alexander Albon": "Alexander Albon",
  };

  return aliases[cleaned] || cleaned;
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

function htmlToText(html) {
  let text = String(html);
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(
    /<\/(p|div|section|article|header|footer|main|li|tr|td|th|h1|h2|h3|h4|h5|h6|a|ul|ol)>/gi,
    "\n"
  );
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  return text.replace(/\r/g, "");
}

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function fmtPos(pos) {
  const n = Number(pos);
  return Number.isFinite(n) && n > 0 ? `P${n}` : "-";
}

function safeNumOrDash(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : "-";
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

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

function formatEventRaceName(event) {
  const eventType = cleanText(event?.eventType).toLowerCase();
  const meetingName = cleanText(event?.meetingName);
  const raceName = cleanText(event?.raceName);
  const sessionName = cleanText(event?.sessionName).toLowerCase();

  const baseName =
    meetingName &&
    meetingName.toLowerCase() !== "race" &&
    meetingName.toLowerCase() !== "sprint"
      ? meetingName
      : raceName &&
          raceName.toLowerCase() !== "race" &&
          raceName.toLowerCase() !== "sprint"
        ? raceName
        : "-";

  if (eventType === "sprint" || sessionName === "sprint") {
    if (baseName === "-") return "Sprint";
    return baseName.toLowerCase().endsWith(" sprint")
      ? baseName
      : `${baseName} Sprint`;
  }

  return baseName;
}

function parseLastRaceFromSeasonResults(data) {
  const events = Array.isArray(data?.events) ? data.events : [];

  if (events.length === 0) {
    return {
      season: String(YEAR),
      round: "-",
      raceName: "-",
      date: "-",
      circuit: {
        name: "-",
        locality: "-",
        country: "-",
      },
      winner: {
        firstName: "-",
        lastName: "-",
        fullName: "-",
        code: null,
        team: "-",
      },
    };
  }

  const sorted = [...events].sort((a, b) => {
    const aTime = Date.parse(a?.dateEndUtc || a?.dateStartUtc || a?.date || 0);
    const bTime = Date.parse(b?.dateEndUtc || b?.dateStartUtc || b?.date || 0);

    const aSafe = Number.isFinite(aTime) ? aTime : 0;
    const bSafe = Number.isFinite(bTime) ? bTime : 0;

    return bSafe - aSafe;
  });

  const latest = sorted[0];
  const winnerRow = Array.isArray(latest?.drivers)
    ? latest.drivers.find((d) => cleanText(d?.position) === "P1")
    : null;

  const winnerFullName = cleanText(winnerRow?.fullName);
  const winnerNames = splitFullName(winnerFullName);

  return {
    season: String(data?.season ?? YEAR),
    round: latest?.round != null ? String(latest.round) : "-",
    raceName: formatEventRaceName(latest),
    date: latest?.date ?? "-",
    circuit: {
      name: latest?.circuit ?? "-",
      locality: latest?.location?.locality ?? "-",
      country: latest?.location?.country ?? "-",
    },
    winner: {
      firstName: winnerNames.firstName || "-",
      lastName: winnerNames.lastName || "-",
      fullName: winnerFullName || "-",
      code:
        DRIVER_CODE_OVERRIDES[canonicalDriverName(winnerFullName)] ||
        DRIVER_CODE_OVERRIDES[winnerFullName] ||
        cleanText(winnerRow?.code) ||
        null,
      team: normalizeTeamName(winnerRow?.team ?? "-"),
    },
  };
}

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: accept,
      "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: "https://www.skysports.com/f1",
    },
    redirect: "follow",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return { res, text, url };
}

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* ------------------------------------------------ */
/* SKY DRIVER STANDINGS PARSER */
/* ------------------------------------------------ */

function extractDriverStandingsBlock(text) {
  const compact = text.replace(/\s+/g, " ");

  const patterns = [
    /#\s*Driver\s+Nat\s+Team\s+Pts\s+((?:\d+\s+[A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+)+\s+[A-Z]{3}\s+[A-Za-z][A-Za-z0-9 &'.\-]+?\s+\d+\s*){5,})/i,
    /Driver\s+Nat\s+Team\s+Pts\s+((?:\d+\s+[A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+)+\s+[A-Z]{3}\s+[A-Za-z][A-Za-z0-9 &'.\-]+?\s+\d+\s*){5,})/i,
  ];

  for (const re of patterns) {
    const match = compact.match(re);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function parseDriverRowsFromBlock(block) {
  const rowRe =
    /(\d+)\s+([A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+)+)\s+([A-Z]{3})\s+([A-Za-z][A-Za-z0-9 &'.\-]+?)\s+(\d+)(?=\s+\d+\s+[A-Z]|\s*$)/g;

  const rows = [];
  for (const match of block.matchAll(rowRe)) {
    const [, posRaw, fullNameRaw, nationality, teamRaw, pointsRaw] = match;

    const fullName = cleanLine(fullNameRaw);
    const canonicalFullName = canonicalDriverName(fullName);
    const team = cleanLine(teamRaw);
    const { firstName, lastName } = splitFullName(fullName);

    rows.push({
      position: fmtPos(posRaw),
      positionNumber: Number(posRaw),
      points: safeNumOrDash(pointsRaw),
      wins: "-",
      driver: {
        code: DRIVER_CODE_OVERRIDES[canonicalFullName] ?? "-",
        firstName,
        lastName,
        fullName,
        nationality,
        driverNumber: DRIVER_NUMBER_OVERRIDES[canonicalFullName] ?? null,
        headshotUrl:
          firstName && lastName ? headshot(firstName, lastName) : null,
        openf1HeadshotUrl: null,
      },
      constructor: {
        name: normalizeTeamName(team),
        fullName: team,
        nationality: null,
      },
    });
  }

  return rows;
}

function parseSkyDriverStandings(html) {
  const text = htmlToText(html);
  const block = extractDriverStandingsBlock(text);

  if (!block) {
    return {
      rows: [],
      reason: "driver_block_not_found",
      sample: cleanLine(text).slice(0, 700),
    };
  }

  const rows = parseDriverRowsFromBlock(block);

  return {
    rows,
    reason: rows.length ? null : "driver_rows_not_parsed",
    blockSample: block.slice(0, 500),
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();

  const [skyResp, seasonResults] = await Promise.all([
    fetchText(SKY_F1_STANDINGS_URL),
    readJson(SEASON_RESULTS_FILE),
  ]);

  const parsed = parseSkyDriverStandings(skyResp.text);

  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    throw new Error(
      `Sky Sports drivers standings parser returned no rows. reason=${parsed.reason}` +
        (parsed.blockSample
          ? ` blockSample=${JSON.stringify(parsed.blockSample)}`
          : "") +
        (parsed.sample ? ` sample=${JSON.stringify(parsed.sample)}` : "")
    );
  }

  const out = {
    header: `${YEAR} Driver Standings`,
    generatedAtUtc: now,
    season: YEAR,
    lastRace: parseLastRaceFromSeasonResults(seasonResults),
    drivers: parsed.rows,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");

  console.log(
    `Wrote ${OUTPUT_FILE} drivers=${out.drivers.length} lastRace=${out.lastRace.raceName}`
  );
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
