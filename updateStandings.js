import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";
const YEAR = new Date().getUTCFullYear();

const F1_RESULTS_DRIVERS_URL = `https://www.formula1.com/en/results/${YEAR}/drivers`;
const HEADSHOTS = "https://mredman48.github.io/F1-standings/headshots";
const UA = "f1-standings-bot";

/* ------------------------------------------------ */
/* DRIVER NAME FIXES FOR HEADSHOT FILES */
/* ------------------------------------------------ */

const DRIVER_SLUG_OVERRIDES = {
  alexander: "alex",
};

const DRIVER_NUMBER_OVERRIDES = {
  "George Russell": 63,
  "Kimi Antonelli": 12,
  "Charles Leclerc": 16,
  "Lewis Hamilton": 44,
  "Lando Norris": 4,
  "Max Verstappen": 1,
  "Oliver Bearman": 87,
  "Arvid Lindblad": 47,
  "Oscar Piastri": 81,
  "Gabriel Bortoleto": 5,
  "Liam Lawson": 30,
  "Pierre Gasly": 10,
  "Esteban Ocon": 31,
  "Alexander Albon": 23,
  "Franco Colapinto": 43,
  "Carlos Sainz": 55,
  "Sergio Perez": 11,
  "Isack Hadjar": 6,
  "Nico Hulkenberg": 27,
  "Fernando Alonso": 14,
  "Valtteri Bottas": 77,
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

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: accept,
    },
    redirect: "follow",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return { res, text, url };
}

/* ------------------------------------------------ */
/* PARSER */
/* ------------------------------------------------ */

function parseCompactDriverRow(line) {
  const value = cleanLine(line);

  // Example:
  // 1GBR33
  const m = value.match(
    /^(\d+)【\d+†(.+?)\s([A-Z]{3})】([A-Z]{3})【\d+†(.+?)】(\d+)$/
  );

  if (!m) return null;

  const [, posRaw, fullName, code, nationality, teamRaw, pointsRaw] = m;
  const { firstName, lastName } = splitFullName(fullName);

  return {
    position: fmtPos(posRaw),
    positionNumber: Number(posRaw),
    points: safeNumOrDash(pointsRaw),
    wins: "-",
    driver: {
      code,
      firstName,
      lastName,
      fullName,
      nationality,
      driverNumber: DRIVER_NUMBER_OVERRIDES[fullName] ?? null,
      headshotUrl: firstName && lastName ? headshot(firstName, lastName) : null,
      openf1HeadshotUrl: null,
    },
    constructor: {
      name: normalizeTeamName(teamRaw),
      fullName: teamRaw,
      nationality: null,
    },
  };
}

function parseOfficialDriverStandings(html, year) {
  const lines = htmlToLines(html);

  const heading = `# ${year} Drivers' Standings`;
  const start = lines.findIndex((line) => cleanLine(line) === heading);

  if (start === -1) {
    return {
      rows: [],
      reason: "heading_not_found",
      headingTried: heading,
      nearby: lines.filter((line) => /\bDrivers'? Standings\b/i.test(line)).slice(0, 10),
    };
  }

  const rows = [];
  const section = lines.slice(start + 1);

  for (const line of section) {
    const value = cleanLine(line);

    if (!value) continue;
    if (value === "Pos.Driver Nationality Team Pts.") continue;
    if (value.startsWith("## ")) break;
    if (/^OUR PARTNERS$/i.test(value)) break;

    const parsed = parseCompactDriverRow(value);
    if (parsed) rows.push(parsed);
  }

  return {
    rows,
    reason: rows.length ? null : "no_rows_parsed",
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateStandings() {
  const now = new Date().toISOString();

  const driversResp = await fetchText(F1_RESULTS_DRIVERS_URL);
  const parsed = parseOfficialDriverStandings(driversResp.text, YEAR);

  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    throw new Error(
      `Official F1 drivers standings parser returned no rows. reason=${parsed.reason}` +
        (parsed.headingTried ? ` heading=${parsed.headingTried}` : "") +
        (parsed.nearby ? ` nearby=${JSON.stringify(parsed.nearby)}` : "")
    );
  }

  const out = {
    header: `${YEAR} Driver Standings`,
    generatedAtUtc: now,
    season: YEAR,
    mode: "OFFICIAL_F1_RESULTS",
    source: {
      kind: "official-f1-results-scrape",
      url: F1_RESULTS_DRIVERS_URL,
      note: "Standings scraped from official Formula1.com results page.",
    },
    lastRace: null,
    drivers: parsed.rows,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");

  console.log(
    `Wrote ${OUTPUT_FILE} mode=OFFICIAL_F1_RESULTS drivers=${out.drivers.length}`
  );
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
