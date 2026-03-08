// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const OUT_JSON = "f1_constructors_standings.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const CACHE_BUST = true;

// TheSportsDB
const TSD_API_KEY = "123";
const TSD_BASE = `https://www.thesportsdb.com/api/v1/json/${TSD_API_KEY}`;
const F1_LEAGUE_ID = "4370";

/* ------------------------------------------------ */
/* TEAM NAME OVERRIDES */
/* ------------------------------------------------ */

const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Racing Bulls": "VCARB",
  "Visa Cash App Racing Bulls": "VCARB",
  "Haas F1 Team": "Haas",
  "MoneyGram Haas F1 Team": "Haas",
  "Alpine F1 Team": "Alpine",
  "BWT Alpine Formula One Team": "Alpine",
  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",
  "Kick Sauber": "Audi",
  "Stake F1 Team Kick Sauber": "Audi",
  "Audi Formula 1 Team": "Audi",
  "Cadillac Formula 1 Team": "Cadillac",
  "McLaren Formula 1 Team": "McLaren",
  "Mercedes-AMG PETRONAS Formula One Team": "Mercedes",
  "Scuderia Ferrari HP": "Ferrari",
  "Williams Racing": "Williams",
  "Aston Martin Aramco Formula One Team": "Aston Martin",
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
    throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}\n${text.slice(0, 300)}`);
  }
}

/* ------------------------------------------------ */
/* THESPORTSDB FETCHES */
/* ------------------------------------------------ */

async function fetchLeagueTable(leagueId, season) {
  // Common standings endpoint pattern for TSD
  const url = `${TSD_BASE}/lookuptable.php?l=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`;
  const data = await fetchJson(url);
  return { url, data };
}

async function fetchPastEvents(leagueId) {
  // Last events for the league
  const url = `${TSD_BASE}/eventspastleague.php?id=${encodeURIComponent(leagueId)}`;
  const data = await fetchJson(url);
  return { url, data };
}

/* ------------------------------------------------ */
/* PARSERS */
/* ------------------------------------------------ */

function parseConstructorsTable(data) {
  const rows = Array.isArray(data?.table) ? data.table : [];

  const parsed = rows
    .map((row) => {
      const rawTeam =
        row?.strTeam ||
        row?.strTeamShort ||
        row?.name ||
        row?.strConstructor ||
        null;

      const team = normalizeTeamName(rawTeam);

      if (!team) return null;

      const logo = resolveTeamLogo(team);

      return {
        team,
        position: fmtPos(
          row?.intRank ??
          row?.intPosition ??
          row?.intRankPosition ??
          row?.position
        ),
        points: safeNumOrDash(
          row?.intPoints ??
          row?.points
        ),
        wins: safeNumOrDash(
          row?.intWin ??
          row?.intWins ??
          row?.wins
        ),
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: false,
      };
    })
    .filter(Boolean);

  const seen = new Set();
  const unique = [];

  for (const row of parsed) {
    const key = normalizeKey(row.team);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return unique;
}

function parseLastRace(data, season) {
  const events = Array.isArray(data?.events) ? data.events : [];

  if (!events.length) {
    return {
      season: String(season),
      round: "-",
      raceName: "-",
      date: "-",
      timeUtc: "-",
      circuit: {
        name: "-",
        locality: "-",
        country: "-",
      },
      winner: {
        name: "-",
        team: "-",
        laps: "-",
      },
    };
  }

  const latest = events
    .filter((e) => e?.strEvent)
    .sort((a, b) => {
      const ad = new Date(`${a?.dateEvent || ""}T${a?.strTime || "00:00:00Z"}`).getTime();
      const bd = new Date(`${b?.dateEvent || ""}T${b?.strTime || "00:00:00Z"}`).getTime();
      return bd - ad;
    })[0];

  return {
    season: String(season),
    round: latest?.intRound != null ? String(latest.intRound) : "latest",
    raceName: latest?.strEvent || "-",
    date: latest?.dateEvent || "-",
    timeUtc: latest?.strTime || "-",
    circuit: {
      name: latest?.strVenue || "-",
      locality: latest?.strCity || "-",
      country: latest?.strCountry || "-",
    },
    winner: {
      name: latest?.strWinner || "-",
      team: latest?.strHomeTeam || latest?.strTeam || "-",
      laps: latest?.intLaps ?? "-",
    },
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateConstructors() {
  const now = new Date();
  const season = getSeasonYear();

  let constructors = [];
  let mode = "THESPORTSDB_EMPTY_PLACEHOLDERS_LOCAL_LOGOS";

  let tableUrl = null;
  let eventsUrl = null;
  let tableError = null;
  let eventsError = null;

  let lastRace = {
    season: String(season),
    round: "-",
    raceName: "-",
    date: "-",
    timeUtc: "-",
    circuit: {
      name: "-",
      locality: "-",
      country: "-",
    },
    winner: {
      name: "-",
      team: "-",
      laps: "-",
    },
  };

  try {
    const tablePack = await fetchLeagueTable(F1_LEAGUE_ID, String(season));
    tableUrl = tablePack.url;

    constructors = parseConstructorsTable(tablePack.data);

    if (constructors.length > 0) {
      mode = "THESPORTSDB_LIVE_LOCAL_LOGOS";
    } else {
      constructors = buildAlphabeticalPlaceholders();
    }
  } catch (err) {
    tableError = String(err?.message || err);
    constructors = buildAlphabeticalPlaceholders();
  }

  try {
    const eventsPack = await fetchPastEvents(F1_LEAGUE_ID);
    eventsUrl = eventsPack.url;
    lastRace = parseLastRace(eventsPack.data, season);
  } catch (err) {
    eventsError = String(err?.message || err);
  }

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

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      leagueTable: tableUrl || "THESPORTSDB_UNAVAILABLE",
      pastEvents: eventsUrl || "THESPORTSDB_UNAVAILABLE",
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
    },
    meta: {
      mode,
      seasonUsed: String(season),
      roundUsed: lastRace.round,
      cacheBust: CACHE_BUST,
      note:
        "Uses TheSportsDB for constructors standings and latest race. If standings are empty/unavailable, emits alphabetical placeholder teams with '-' stats. Logos are LOCAL ONLY from /teamlogos via GitHub Pages.",
      tableError,
      eventsError,
    },
    lastRace,
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

  console.log(
    `Wrote ${OUT_JSON} season=${out.meta.seasonUsed} constructors=${out.constructors.length} mode=${out.meta.mode}`
  );
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});