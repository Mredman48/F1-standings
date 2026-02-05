// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// Output JSON (adjust if your repo uses a different name)
const OUT_JSON = "f1_constructors_standings.json";

// ✅ Force Mercedes logo everywhere (your exact file)
const MERCEDES_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_mercedes_color_v2.png";

// --- optional: cache busting (helps Widgy + GitHub CDN) ---
// If you want Widgy to ALWAYS refresh logos, set this true.
const CACHE_BUST = true;

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

// Best-effort mapping to high quality colored logos.
// (These can be swapped anytime; if one URL fails, you’ll just get null.)
function buildF1MediaLogoUrl(season, teamSlug) {
  // Example pattern you shared:
  // https://media.formula1.com/image/upload/c_fit,h_64/q_auto/v1740000000/common/f1/2025/alpine/2025alpinelogowhite.webp
  // We'll use colored if available; if not, these are still useful placeholders.
  // NOTE: F1 media URLs are not guaranteed stable for every team/season.
  return `https://media.formula1.com/image/upload/c_fit,h_256/q_auto/common/f1/${season}/${teamSlug}/${season}${teamSlug}logocolor.webp`;
}

// Hard map constructorId -> media folder slug (best-effort)
const TEAM_SLUG = {
  red_bull: "redbullracing",
  ferrari: "ferrari",
  mercedes: "mercedes",
  mclaren: "mclaren",
  aston_martin: "astonmartin",
  alpine: "alpine",
  williams: "williams",
  haas: "haas",
  sauber: "sauber",
  rb: "rb",
  kick_sauber: "sauber",
  alfa: "sauber",
  cadillac: "cadillac",
};

// If you already host stable PNG logos in your repo/pages, this is the best place to map them.
const TEAM_LOGO_OVERRIDES = {
  // ✅ FORCE Mercedes to your exact file name (used elsewhere)
  mercedes: MERCEDES_LOGO_PNG,
};

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

function resolveTeamLogo({ constructorId, seasonUsed }) {
  const id = String(constructorId || "").toLowerCase();

  // 1) Hard override
  if (TEAM_LOGO_OVERRIDES[id]) return withCacheBust(TEAM_LOGO_OVERRIDES[id]);

  // 2) Best-effort F1 media mapping
  const slug = TEAM_SLUG[id];
  if (slug) return withCacheBust(buildF1MediaLogoUrl(seasonUsed || "2025", slug));

  // 3) unknown -> null
  return null;
}

// ---------- season fallback logic ----------

async function loadSeasonPack(season) {
  const cs = await fetchErgastWithFallback(`/${season}/constructorstandings.json`);
  const lr = await fetchErgastWithFallback(`/${season}/last/results.json`);

  const csLists = getStandingsListsFromErgast(cs.data);
  const constructorRows = csLists?.[0]?.ConstructorStandings || [];

  const lastRace = getRacesFromErgast(lr.data)?.[0] || null;

  return {
    season,
    constructorStandings: cs.data,
    constructorStandingsUrl: cs.url,
    lastRaceResults: lr.data,
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

  // Try current first, then fallback to previous season (2025)
  let pack = await loadSeasonPack("current");

  if (!Array.isArray(pack.constructorRows) || pack.constructorRows.length === 0) {
    pack = await loadSeasonPack("2025");
  }

  const seasonUsed = pack.season === "current" ? String(pack.lastRace?.season || "current") : "2025";
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

    const teamName = c.name || "-";
    const position = row?.position ? `P${row.position}` : "-";
    const points = safeNum(row?.points);
    const wins = safeNum(row?.wins);

    const teamLogoPng = resolveTeamLogo({ constructorId, seasonUsed });

    return {
      constructorId: constructorId || "-",
      team: teamName,
      position,
      points,
      wins,
      teamLogoPng, // ✅ Mercedes will always be your provided link
    };
  });

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ergastBases: ERGAST_BASES,
      constructorStandings: pack.constructorStandingsUrl,
      lastRace: pack.lastRaceUrl,
      mercedesLogoOverride: MERCEDES_LOGO_PNG,
    },
    meta: {
      seasonUsed: String(seasonUsed),
      roundUsed: String(roundUsed),
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