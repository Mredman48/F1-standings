// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const BASES = ["https://api.jolpi.ca/ergast/f1"];

function cleanTeamName(name) {
  const n = (name || "").trim();

  // Your naming rules:
  if (/red bull racing/i.test(n)) return "Red Bull";
  if (/RB F1 Team/i.test(n)) return "VCARB";

  return n;
}

// Team hex colors (tweak anytime)
const TEAM_HEX = {
  "Red Bull": "#1E41FF",
  "Ferrari": "#DC0000",
  "Mercedes": "#00D2BE",
  "McLaren": "#FF8700",
  "Aston Martin": "#006F62",
  "Alpine F1 Team": "#0090FF",
  "Williams": "#005AFF",
  "Haas F1 Team": "#B6BABD",
  "Sauber": "#00E701",
  "VCARB": "#2B4562",
  "Audi": "#000000",
};

// PNG logos (transparent)
const TEAM_LOGO_PNG = {
  "Red Bull":
    "https://upload.wikimedia.org/wikipedia/en/thumb/6/6e/Red_Bull_Racing_logo.svg/512px-Red_Bull_Racing_logo.svg.png",
  "Ferrari":
    "https://upload.wikimedia.org/wikipedia/en/thumb/d/d1/Scuderia_Ferrari_Logo.svg/512px-Scuderia_Ferrari_Logo.svg.png",
  "Mercedes":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Mercedes-Benz_in_Motorsport.svg/512px-Mercedes-Benz_in_Motorsport.svg.png",
  "McLaren":
    "https://upload.wikimedia.org/wikipedia/en/thumb/6/66/McLaren_Racing_logo.svg/512px-McLaren_Racing_logo.svg.png",
  "Aston Martin":
    "https://upload.wikimedia.org/wikipedia/en/thumb/1/1a/Aston_Martin_F1_Team_logo.svg/512px-Aston_Martin_F1_Team_logo.svg.png",
  "Alpine F1 Team":
    "https://upload.wikimedia.org/wikipedia/en/thumb/2/2e/Alpine_F1_Team_Logo.svg/512px-Alpine_F1_Team_Logo.svg.png",
  "Williams":
    "https://upload.wikimedia.org/wikipedia/en/thumb/9/9c/Williams_Grand_Prix_Engineering_logo.svg/512px-Williams_Grand_Prix_Engineering_logo.svg.png",
  "Haas F1 Team":
    "https://upload.wikimedia.org/wikipedia/en/thumb/e/e4/Haas_F1_Team_logo.svg/512px-Haas_F1_Team_logo.svg.png",
  "Sauber":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Stake_F1_Team_Kick_Sauber_logo.svg/512px-Stake_F1_Team_Kick_Sauber_logo.svg.png",
  "VCARB":
    "https://upload.wikimedia.org/wikipedia/en/thumb/8/86/Racing_Bulls_logo.svg/512px-Racing_Bulls_logo.svg.png",
  "Audi":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Audi_logo_detail.svg/512px-Audi_logo_detail.svg.png",
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 120)}`);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return { data, url, status: res.status };
}

async function fetchWithFallback(paths) {
  const attempts = [];
  for (const base of BASES) {
    for (const p of paths) {
      const url = `${base}${p}`;
      try {
        const out = await fetchJson(url);
        return { ...out, attempts };
      } catch (e) {
        attempts.push({ url, error: e?.message || String(e) });
      }
    }
  }
  throw new Error(`All fetch attempts failed: ${JSON.stringify(attempts, null, 2)}`);
}

function safeGet(obj, pathArr) {
  return pathArr.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

async function getLastRace() {
  // This may also be empty preseason — that's OK.
  try {
    const { data } = await fetchWithFallback([
      "/current/last/results.json",
      "/current/last/Results.json",
    ]);
    const race = safeGet(data, ["MRData", "RaceTable", "Races", 0]) || null;
    return {
      name: race?.raceName || null,
      round: race?.round ? Number(race.round) : null,
      date: race?.date || null,
    };
  } catch {
    return { name: null, round: null, date: null };
  }
}

function mapConstructorStanding(cs) {
  const ctor = cs?.Constructor || {};
  const team = cleanTeamName(ctor?.name || ctor?.Name || "");

  return {
    position: cs.position ? Number(cs.position) : null,
    positionText: cs.position ? `P${cs.position}` : null,
    points: cs.points ? Number(cs.points) : null,
    wins: cs.wins ? Number(cs.wins) : null,
    team: team || null,
    teamHex: TEAM_HEX[team] || null,
    teamLogoPng: TEAM_LOGO_PNG[team] || null,
  };
}

async function updateConstructors() {
  const now = new Date();

  const standingsRes = await fetchWithFallback([
    "/current/constructorstandings.json",
    "/current/constructorStandings.json",
  ]);

  const mr = standingsRes.data?.MRData || {};
  const season = mr?.StandingsTable?.season || null;
  const round = mr?.StandingsTable?.round ?? null;

  const list =
    safeGet(standingsRes.data, ["MRData", "StandingsTable", "StandingsLists", 0, "ConstructorStandings"]) || [];

  const total = Number(mr.total || 0);

  const lastRace = await getLastRace();

  const constructors = Array.isArray(list) ? list.map(mapConstructorStanding) : [];

  const out = {
    header: `${now.getUTCFullYear()} constructors standings`,
    generatedAtUtc: now.toISOString(),
    source: { constructors: standingsRes.url },
    meta: {
      season,
      round,
      total, // 0 preseason / before standings exist
      note:
        total === 0
          ? "No constructor standings available yet (season not started or standings not published)."
          : null,
    },
    lastRace,
    constructors,
  };

  await fs.writeFile("f1_constructor_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log(
    total === 0
      ? "Wrote f1_constructor_standings.json (no standings yet)"
      : "Wrote f1_constructor_standings.json"
  );
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});