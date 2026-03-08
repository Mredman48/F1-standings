// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const F1_RESULTS_BASE = "https://www.formula1.com/en/results";
const OUT_JSON = "f1_constructors_standings.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";

const CACHE_BUST = true;

/* ------------------------------------------------ */
/* TEAM NAME OVERRIDES */
/* ------------------------------------------------ */

const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Racing Bulls": "VCARB",
  "Haas F1 Team": "Haas",
  "Alpine F1 Team": "Alpine",
  "Red Bull Racing": "Red Bull",
  "Kick Sauber": "Sauber",
  "Stake F1 Team Kick Sauber": "Sauber",
};

function normalizeTeamName(name) {
  return TEAM_NAME_OVERRIDES[name] || name;
}

/* ------------------------------------------------ */
/* LOCAL TEAM LOGOS */
/* ------------------------------------------------ */

const TEAM_LOGOS_LOCAL = {
  "red bull": "2025_red-bull_color_v2.png",
  "red bull racing": "2025_red-bull_color_v2.png",
  ferrari: "2025_ferrari_color_v2.png",
  mercedes: "2025_mercedes_color_v2.png",
  mclaren: "2025_mclaren_color_v2.png",
  "aston martin": "2025_aston-martin_color_v2.png",
  alpine: "2025_alpine_color_v2.png",
  williams: "2025_williams_color_v2.png",
  haas: "2025_haas_color_v2.png",
  "haas f1 team": "2025_haas_color_v2.png",
  audi: "audi_logo_colored.png",
  vcarb: "2025_vcarb_color_v2.png",
  "racing bulls": "2025_vcarb_color_v2.png",
  sauber: "audi_logo_colored.png",
  cadillac: "2025_cadillac_color_v2.png",
};

/* ------------------------------------------------ */
/* PLACEHOLDER TEAMS */
/* ------------------------------------------------ */

const PLACEHOLDER_TEAMS = [
  { team: "Alpine" },
  { team: "Aston Martin" },
  { team: "Audi" },
  { team: "Cadillac" },
  { team: "Ferrari" },
  { team: "Haas" },
  { team: "McLaren" },
  { team: "Mercedes" },
  { team: "Red Bull" },
  { team: "VCARB" },
  { team: "Williams" },
].sort((a, b) => a.team.localeCompare(b.team));

/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

function getSeasonYear() {
  return new Date().getUTCFullYear();
}

function buildResultsUrl(year, section) {
  return `${F1_RESULTS_BASE}/${year}/${section}`;
}

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

function fmtPos(pos) {
  const n = Number(pos);
  if (!Number.isFinite(n)) return "-";
  return `P${n}`;
}

function safeNumOrDash(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : "-";
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    /<\/(p|div|section|article|header|footer|main|li|tr|td|th|h1|h2|h3|h4|h5|h6|a)>/gi,
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

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });

  const text = await res.text();
  return { res, text, url };
}

function resolveTeamLogo(teamName) {
  const key = normalizeKey(teamName);
  const fileName = TEAM_LOGOS_LOCAL[key];
  if (!fileName) return null;
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

function buildAlphabeticalPlaceholders() {
  return PLACEHOLDER_TEAMS.map((t) => {
    const logo = resolveTeamLogo(t.team);
    return {
      team: t.team,
      position: "-",
      points: "-",
      wins: "-",
      teamLogoPng: logo,
      logoMissing: logo == null,
      placeholder: true,
    };
  });
}

/* ------------------------------------------------ */
/* SECTION EXTRACTION */
/* ------------------------------------------------ */

function extractSection(lines, headingPattern) {
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) return [];

  const partnersIndex = lines.findIndex(
    (line, idx) => idx > startIndex && /OUR PARTNERS/i.test(line)
  );

  const endIndex = partnersIndex === -1 ? lines.length : partnersIndex;
  return lines.slice(startIndex, endIndex);
}

/* ------------------------------------------------ */
/* TEAM STANDINGS PARSER */
/* ------------------------------------------------ */

function parseOfficialTeamStandings(html, year) {
  const lines = htmlToLines(html);
  const section = extractSection(
    lines,
    new RegExp(`${year}\\s+Teams[’']\\s+Standings`, "i")
  );

  if (!section.length) {
    return { rows: [], reason: "heading_not_found" };
  }

  const joined = section.join("\n");
  if (/No results available/i.test(joined) || /\bError\b/i.test(joined)) {
    return { rows: [], reason: "no_results_available" };
  }

  const rows = [];

  // Handles:
  // "1 Mercedes 43"
  // "1Mercedes43"
  const spacedOrCompactRowRe =
    /^(\d+)\s*([A-Za-z][A-Za-z0-9 '&.\-]*?)\s*(\d+(?:\.\d+)?)$/;

  for (const rawLine of section) {
    const line = cleanLine(rawLine);

    if (/^Pos\.?Team/i.test(line)) continue;
    if (/^#\s*\d{4}\s+Teams/i.test(line)) continue;

    const m = line.match(spacedOrCompactRowRe);
    if (!m) continue;

    const [, pos, teamRaw, pts] = m;
    const teamClean = cleanLine(teamRaw);

    if (!teamClean) continue;

    rows.push({
      teamRaw: teamClean,
      team: normalizeTeamName(teamClean),
      position: fmtPos(pos),
      points: safeNumOrDash(pts),
      wins: "-",
      placeholder: false,
    });
  }

  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const key = normalizeKey(row.teamRaw);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return {
    rows: unique,
    reason: unique.length ? null : "no_rows_parsed",
  };
}

/* ------------------------------------------------ */
/* RACE RESULTS PARSER */
/* ------------------------------------------------ */

function parseOfficialRaceResults(html, year) {
  const lines = htmlToLines(html);
  const section = extractSection(lines, new RegExp(`${year}\\s+RACE RESULTS`, "i"));

  if (!section.length) {
    return { lastRace: null, reason: "heading_not_found" };
  }

  const joined = section.join("\n");
  if (/No results available/i.test(joined) || /\bError\b/i.test(joined)) {
    return { lastRace: null, reason: "no_results_available" };
  }

  // Handles:
  // "Australia 08 Mar George Russell RUS Mercedes 58 1:23:06.801"
  // and tighter variants with inconsistent spacing after HTML stripping
  const raceRowRe =
    /^([A-Za-z][A-Za-z\s'’-]+?)\s*(\d{2}\s+[A-Za-z]{3})\s*([A-Za-zÀ-ÿ\s'’-]+?)\s+([A-Z]{3})\s+([A-Za-z][A-Za-z0-9\s&'.\-]+?)\s+(\d+)\s+([0-9:.\-+]+)$/;

  for (const rawLine of section) {
    const line = cleanLine(rawLine);

    if (/^Grand Prix Date Winner Team Laps Time/i.test(line)) continue;
    if (/^#\s*\d{4}\s+RACE RESULTS/i.test(line)) continue;

    const m = line.match(raceRowRe);
    if (!m) continue;

    const [, raceName, date, winnerName, winnerCode, team, laps, timeUtc] = m;

    return {
      lastRace: {
        season: String(year),
        round: "latest",
        raceName: cleanLine(raceName),
        date: cleanLine(date),
        timeUtc: cleanLine(timeUtc),
        circuit: {
          name: "-",
          locality: "-",
          country: "-",
        },
        winner: {
          name: `${cleanLine(winnerName)} ${cleanLine(winnerCode)}`,
          team: cleanLine(team),
          laps: Number(laps),
        },
      },
      reason: null,
    };
  }

  return { lastRace: null, reason: "no_rows_parsed" };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateConstructors() {
  const now = new Date();
  const year = getSeasonYear();

  const standingsUrl = buildResultsUrl(year, "team");
  const racesUrl = buildResultsUrl(year, "races");

  const [standingsResp, racesResp] = await Promise.all([
    fetchText(standingsUrl),
    fetchText(racesUrl),
  ]);

  const standingsAttempts = [
    {
      url: standingsUrl,
      ok: standingsResp.res.ok,
      status: standingsResp.res.status,
    },
  ];

  const raceAttempts = [
    {
      url: racesUrl,
      ok: racesResp.res.ok,
      status: racesResp.res.status,
    },
  ];

  let constructors = [];
  let mode = "F1COM_CURRENT_EMPTY_PLACEHOLDERS_LOCAL_LOGOS";

  let parsedStandings = { rows: [], reason: "http_error" };
  if (standingsResp.res.ok) {
    parsedStandings = parseOfficialTeamStandings(standingsResp.text, year);
  }

  let parsedLastRace = { lastRace: null, reason: "http_error" };
  if (racesResp.res.ok) {
    parsedLastRace = parseOfficialRaceResults(racesResp.text, year);
  }

  const lastRaceOut =
    parsedLastRace.lastRace || {
      season: String(year),
      round: "-",
      raceName: "-",
      date: "-",
      timeUtc: "-",
      circuit: { name: "-", locality: "-", country: "-" },
      winner: {
        name: "-",
        team: "-",
        laps: "-",
      },
    };

  if (Array.isArray(parsedStandings.rows) && parsedStandings.rows.length > 0) {
    mode = "F1COM_CURRENT_LIVE_LOCAL_LOGOS";

    constructors = parsedStandings.rows.map((row) => {
      const logo = resolveTeamLogo(row.team);
      return {
        team: row.team,
        position: row.position,
        points: row.points,
        wins: row.wins,
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: false,
      };
    });

    const hasCadillac = constructors.some(
      (t) => normalizeKey(t.team) === "cadillac"
    );
    if (!hasCadillac) {
      const logo = resolveTeamLogo("Cadillac");
      constructors.push({
        team: "Cadillac",
        position: "-",
        points: "-",
        wins: "-",
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: true,
      });
    }

    for (const t of constructors) {
      if (
        typeof t.teamLogoPng === "string" &&
        t.teamLogoPng &&
        !t.teamLogoPng.startsWith(PAGES_BASE)
      ) {
        throw new Error(`Non-repo logo detected for ${t.team}: ${t.teamLogoPng}`);
      }
    }
  } else {
    constructors = buildAlphabeticalPlaceholders();
  }

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      standings: standingsUrl,
      standingsAttempts,
      races: racesUrl,
      raceAttempts,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
    },
    meta: {
      mode,
      seasonUsed: String(year),
      roundUsed: lastRaceOut.round,
      cacheBust: CACHE_BUST,
      note:
        "Uses official F1.com current team standings. If current standings are empty/unavailable, emits alphabetical placeholder teams with '-' stats. Logos are LOCAL ONLY from /teamlogos via GitHub Pages.",
      standingsParseReason: parsedStandings.reason,
      raceParseReason: parsedLastRace.reason,
    },
    lastRace: lastRaceOut,
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(
    `Wrote ${OUT_JSON} season=${out.meta.seasonUsed} constructors=${out.constructors.length} mode=${out.meta.mode}`
  );
  console.log(`Standings parse reason: ${parsedStandings.reason}`);
  console.log(`Race parse reason: ${parsedLastRace.reason}`);
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});