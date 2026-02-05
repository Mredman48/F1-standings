// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Data sources (Jolpi first, Ergast fallback)
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// Output
const OUT_JSON = "f1_constructors_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";

// Turn on if Widgy/GitHub CDN is stubborn
const CACHE_BUST = false;

// ✅ Mercedes logo (single source of truth — same filename used elsewhere)
const MERCEDES_LOGO_FILE = "2025_mercedes_color_v2.png";
const MERCEDES_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/${MERCEDES_LOGO_FILE}`;

// Map Ergast constructorId -> filename in /teamlogos
// Update filenames here to match what you actually have in your repo.
const TEAM_LOGOS_LOCAL = {
  red_bull: "2025_red-bull_color_v2.png",
  ferrari: "2025_ferrari_color_v2.png",
  mercedes: MERCEDES_LOGO_FILE, // ✅ points to same file
  mclaren: "2025_mclaren_color_v2.png",
  aston_martin: "2025_astonmartin_color_v2.png",
  alpine: "2025_alpine_color_v2.png",
  williams: "2025_williams_color_v2.png",
  haas: "2025_haas_color_v2.png",
  sauber: "2025_sauber_color_v2.png",
  rb: "2025_vcarb_color_v2.png", // if you renamed RB to VCARB logo
  // cadillac: "2025_cadillac_color_v2.png", // add when you have it
};

// ---------- fetch helpers ----------

async function fetchText(url, accept = "application/json") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(url) {
  const { res, text } = await fetchText(url, "application/json");
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchErgastWithFallback(pathPart) {
  const attempts = [];
  for (const base of ERGAST_BASES) {
    const url = `${base}${pathPart}`;
    try {
      const data = await fetchJson(url);
      attempts.push({ url, status: 200, ok: true });
      return { data, url, attempts };
    } catch (e) {
      attempts.push({ url, status: "ERR", ok: false, err: String(e?.message || e) });
    }
  }
  const err = new Error(
    `Failed Ergast fetch for ${pathPart}. Attempts: ${JSON.stringify(attempts)}`
  );
  err.attempts = attempts;
  throw err;
}

// ---------- Ergast parsers ----------

function getStandingsListsFromErgast(data) {
  return data?.MRData?.StandingsTable?.StandingsLists || [];
}

function getRacesFromErgast(data) {
  return data?.MRData?.RaceTable?.Races || [];
}

// ---------- logo helpers ----------

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

function resolveTeamLogo(constructorId) {
  const id = String(constructorId || "").toLowerCase();

  const file = TEAM_LOGOS_LOCAL[id];
  if (!file) return null;

  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${file}`);
}

// ---------- season fallback ----------

async function loadSeasonPack(season) {
  const cs = await fetchErgastWithFallback(`/${season}/constructorstandings.json`);
  const lr = await fetchErgastWithFallback(`/${season}/last/results.json`);

  const csLists = getStandingsListsFromErgast(cs.data);
  const constructorRows = csLists?.[0]?.ConstructorStandings || [];

  const lastRace = getRacesFromErgast(lr.data)?.[0] || null;

  return {
    season,
    constructorStandingsUrl: cs.url,
    lastRaceUrl: lr.url,
    constructorRows,
    lastRace,
  };
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : "-";
}

// ---------- main ----------

async function updateConstructors() {
  const now = new Date();

  // Try current first, then fallback to 2025 if empty
  let pack = await loadSeasonPack("current");
  if (!Array.isArray(pack.constructorRows) || pack.constructorRows.length === 0) {
    pack = await loadSeasonPack("2025");
  }

  const seasonUsed =
    pack.season === "current" ? String(pack.lastRace?.season || "current") : "2025";
  const roundUsed = String(pack.lastRace?.round || "-");

  const lastRaceOut = pack.lastRace
    ? {
        season: String(pack.lastRace.season || seasonUsed),
        round: String(pack.lastRace.round || "-"),
        raceName: pack.lastRace.raceName || "-",
        date: pack.lastRace.date || "-",
        timeUtc: pack.lastRace.time || "-",
        circuit: {
          name: pack.lastRace?.Circuit?.circuitName || "-",
          locality: pack.lastRace?.Circuit?.Location?.locality || "-",
          country: pack.lastRace?.Circuit?.Location?.country || "-",
        },
      }
    : {
        season: String(seasonUsed),
        round: "-",
        raceName: "-",
        date: "-",
        timeUtc: "-",
        circuit: { name: "-", locality: "-", country: "-" },
      };

  const constructors = pack.constructorRows.map((row) => {
    const c = row?.Constructor || {};
    const constructorId = (c.constructorId || "").toLowerCase();

    return {
      constructorId: constructorId || "-",
      team: c.name || "-",
      position: row?.position ? `P${row.position}` : "-",
      points: safeNum(row?.points),
      wins: safeNum(row?.wins),
      teamLogoPng: resolveTeamLogo(constructorId), // ✅ now always from /teamlogos
    };
  });

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ergastBases: ERGAST_BASES,
      constructorStandings: pack.constructorStandingsUrl,
      lastRace: pack.lastRaceUrl,
      teamLogosFolder: `${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
    },
    meta: {
      seasonUsed: String(seasonUsed),
      roundUsed: String(roundUsed),
      cacheBust: CACHE_BUST,
      note:
        pack.season === "current"
          ? "Pulled current constructor standings."
          : "Current season standings unavailable; fell back to 2025.",
    },
    lastRace: lastRaceOut,
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});