// scripts/isRaceWeekend.mjs
// Uses Ergast-compatible Jolpica to detect if we're in a race weekend window.
// Window definition (UTC):
// - Starts: 00:00 UTC on the Friday of race week
// - Ends:   06:00 UTC on the Monday after the race
//
// Why this window? Ergast doesn't provide session times, only race date/time,
// so this gives you "race weekend only" behavior without needing FP schedule.

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const ERGAST_FALLBACK = "https://ergast.com/api/f1";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0 (GitHub Actions)",
      Accept: "application/json",
    },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchNextRace() {
  const paths = ["/current/next.json", "/current/next.json?limit=1"];

  for (const base of [JOLPICA_BASE, ERGAST_FALLBACK]) {
    for (const p of paths) {
      const url = `${base}${p}`;
      try {
        const data = await fetchJson(url);
        const race = data?.MRData?.RaceTable?.Races?.[0];
        if (race?.date) return { race, urlUsed: url };
      } catch {
        // try next
      }
    }
  }
  return { race: null, urlUsed: null };
}

function toUtcDateTime(dateStr, timeStr) {
  // Ergast time is usually like "15:00:00Z"
  if (!dateStr) return null;
  const t = timeStr ? timeStr : "00:00:00Z";
  const iso = `${dateStr}T${t}`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}

function addUtcDays(d, days) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function addUtcHours(d, hours) {
  return new Date(d.getTime() + hours * 60 * 60 * 1000);
}

function getFridayStartUtc(raceDateUtc) {
  // raceDateUtc is the race date/time in UTC.
  // Find Friday 00:00 UTC of that week by anchoring on race day:
  // - if race is Sunday, Friday is -2 days
  // - if race is Saturday, Friday is -1 day
  // - if race is Monday (rare), Friday is -3 days, etc.
  const dow = raceDateUtc.getUTCDay(); // Sun=0, Mon=1, ... Fri=5, Sat=6
  // distance from Friday (5) to race day:
  // e.g. dow=0 (Sun) => diff = 0-5 = -5 -> Friday is race -2 days? Wait.
  // Instead compute Friday by finding the week Friday relative to race date:
  // We'll compute the date for Friday of race week as:
  // Take race date start-of-day, then subtract ((dow - 5 + 7) % 7) days to get last Friday.
  // For Sunday (0): (0 - 5 + 7) % 7 = 2 => subtract 2 days => Friday ✅
  // For Saturday (6): (6 - 5 + 7) % 7 = 1 => subtract 1 day => Friday ✅
  const raceStartDay = startOfUtcDay(raceDateUtc);
  const daysSinceFriday = (dow - 5 + 7) % 7;
  return addUtcDays(raceStartDay, -daysSinceFriday);
}

function getMondayEndUtc(fridayStartUtc) {
  // End Monday 06:00 UTC (a buffer after race weekend)
  const mondayStart = addUtcDays(fridayStartUtc, 3); // Fri + 3 = Mon
  return addUtcHours(mondayStart, 6);
}

async function main() {
  const now = new Date();
  const { race, urlUsed } = await fetchNextRace();

  const out = {
    nowUtc: now.toISOString(),
    urlUsed,
    inWindow: false,
    windowStartUtc: null,
    windowEndUtc: null,
    nextRace: null,
    reason: null,
  };

  if (!race) {
    out.reason = "No next race found (feed empty/unavailable).";
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  const raceDt = toUtcDateTime(race.date, race.time);
  if (!raceDt) {
    out.reason = "Next race date/time invalid.";
    out.nextRace = { raceName: race.raceName, date: race.date, time: race.time ?? null };
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  const windowStart = getFridayStartUtc(raceDt);
  const windowEnd = getMondayEndUtc(windowStart);

  out.windowStartUtc = windowStart.toISOString();
  out.windowEndUtc = windowEnd.toISOString();
  out.nextRace = {
    season: race.season ?? null,
    round: race.round ?? null,
    raceName: race.raceName ?? null,
    date: race.date ?? null,
    timeUtc: race.time ?? null,
  };

  out.inWindow = now >= windowStart && now <= windowEnd;
  out.reason = out.inWindow ? "Within race weekend window." : "Outside race weekend window.";

  console.log(JSON.stringify(out, null, 2));

  // GitHub Actions output
  // (If running locally, GITHUB_OUTPUT won't exist)
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs/promises");
    await fs.appendFile(process.env.GITHUB_OUTPUT, `in_window=${out.inWindow}\n`, "utf8");
    await fs.appendFile(process.env.GITHUB_OUTPUT, `window_start=${out.windowStartUtc}\n`, "utf8");
    await fs.appendFile(process.env.GITHUB_OUTPUT, `window_end=${out.windowEndUtc}\n`, "utf8");
    await fs.appendFile(process.env.GITHUB_OUTPUT, `next_race=${out.nextRace?.raceName ?? ""}\n`, "utf8");
  }
}

main().catch((e) => {
  console.error(e);
  // If the gate errors, default to NOT running updates (safe).
  if (process.env.GITHUB_OUTPUT) {
    import("node:fs/promises").then((fs) =>
      fs.appendFile(process.env.GITHUB_OUTPUT, `in_window=false\n`, "utf8")
    );
  }
  process.exit(0);
});