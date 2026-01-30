import fs from "node:fs";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const CHAMP_URL = "https://api.openf1.org/v1/championship_drivers?session_key=latest";
const DRIVERS_URL = "https://api.openf1.org/v1/drivers?session_key=latest";
const OUT_FILE = "f1_driver_standings.json";

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 400)}`);
  }

  return res.json();
}

function readPreviousPositions() {
  // Map driver_number -> previous position (number)
  try {
    if (!fs.existsSync(OUT_FILE)) return new Map();

    const raw = fs.readFileSync(OUT_FILE, "utf8");
    const prev = JSON.parse(raw);

    const m = new Map();
    const drivers = prev?.drivers;
    if (Array.isArray(drivers)) {
      for (const d of drivers) {
        if (typeof d?.driver_number === "number" && typeof d?.position === "number") {
          m.set(d.driver_number, d.position);
        }
      }
    }
    return m;
  } catch {
    // If file is malformed or missing, just treat as no previous data
    return new Map();
  }
}

function splitName(fullName) {
  const full = (fullName || "").trim();
  if (!full) return { first_name: null, last_name: null };

  const parts = full.split(/\s+/);
  const first_name = parts[0] ?? null;
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return { first_name, last_name };
}

function calcChange(prevPos, newPos) {
  if (typeof prevPos !== "number" || typeof newPos !== "number") {
    return { positionChange: null, positionArrow: "★" }; // new/unknown
  }

  const delta = prevPos - newPos; // positive means improved (moved up)
  if (delta > 0) return { positionChange: delta, positionArrow: "↑" };
  if (delta < 0) return { positionChange: delta, positionArrow: "↓" };
  return { positionChange: 0, positionArrow: "→" };
}

async function updateStandings() {
  const prevPositions = readPreviousPositions();

  const [champRows, driverRows] = await Promise.all([
    getJson(CHAMP_URL),
    getJson(DRIVERS_URL),
  ]);

  // driver_number -> driver info (name, team)
  const byNumber = new Map();
  for (const d of driverRows) {
    // OpenF1 uses driver_number as number
    byNumber.set(d.driver_number, d);
  }

  const session_key = champRows?.[0]?.session_key ?? "latest";
  const meeting_key = champRows?.[0]?.meeting_key ?? null;

  const drivers = champRows
    .slice()
    .sort((a, b) => (a.position_current ?? 999) - (b.position_current ?? 999))
    .map((row) => {
      const info = byNumber.get(row.driver_number) || {};
      const { first_name, last_name } = splitName(info.full_name);

      const position = Number(row.position_current);
      const prevPos = prevPositions.get(row.driver_number);
      const { positionChange, positionArrow } = calcChange(prevPos, position);

      return {
        position,
        positionLabel: `P${position}`,
        positionChange,      // +n means up, -n means down, 0 no change, null unknown
        positionArrow,       // ↑ ↓ → ★
        driver_number: row.driver_number,
        first_name,
        last_name,
        team: info.team_name ?? null,
        points: Number(row.points_current),
      };
    });

  const output = {
    header: `${new Date().getFullYear()} Driver Standings`,
    source: "openf1",
    session_key,
    meeting_key,
    updated_at: new Date().toISOString(),
    drivers,
    notes:
      "positionChange/positionArrow are computed by comparing this run to the previous f1_driver_standings.json committed in the repo. First run shows ★.",
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUT_FILE} (${drivers.length} drivers)`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});