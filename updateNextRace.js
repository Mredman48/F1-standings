// updateNextRace.js
import fs from "fs/promises";
import fetch from "node-fetch"; // Node 18+ supports fetch natively

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Helpers
function parseDateICS(line) {
  // DTSTART;TZID=UTC:20260306T013000Z
  const match = line.match(/:(\d{8}T\d{6}Z)/);
  return match ? new Date(match[1]) : null;
}

function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function titleCase(s) {
  if (!s) return null;
  return s
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Minimal country -> ISO2 mapping
function countryToIso2(country) {
  const map = {
    australia: "au",
    bahrain: "bh",
    china: "cn",
    japan: "jp",
    "saudi arabia": "sa",
    qatar: "qa",
    singapore: "sg",
    "united arab emirates": "ae",
    uae: "ae",
    canada: "ca",
    mexico: "mx",
    brazil: "br",
    argentina: "ar",
    "united states": "us",
    usa: "us",
    "united kingdom": "gb",
    italy: "it",
    spain: "es",
    france: "fr",
    belgium: "be",
    netherlands: "nl",
    austria: "at",
    hungary: "hu",
    germany: "de",
    portugal: "pt",
  };
  return map[(country || "").toLowerCase()] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  const code = iso2.toLowerCase();
  return {
    iso2: code,
    png: `https://flagcdn.com/w160/${code}.png`,
    svg: `https://flagcdn.com/${code}.svg`,
  };
}

// Main
async function updateNextRace() {
  const now = new Date();
  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`Failed to fetch ICS: ${res.status}`);
  const icsText = await res.text();

  // Parse VEVENTS manually
  const events = icsText.split("BEGIN:VEVENT").slice(1).map((ev) => {
    const lines = ev.split("\n").map((l) => l.trim());
    const summary = lines.find((l) => l.startsWith("SUMMARY:"))?.replace("SUMMARY:", "") || "";
    const dtstart = parseDateICS(lines.find((l) => l.startsWith("DTSTART"))) || null;
    const dtend = parseDateICS(lines.find((l) => l.startsWith("DTEND"))) || null;
    const location = lines.find((l) => l.startsWith("LOCATION:"))?.replace("LOCATION:", "") || null;

    return { summary, start: dtstart, end: dtend, location };
  });

  // Filter future races
  const futureRaces = events.filter((e) => e.start && e.summary.toLowerCase().includes("race") && e.start > now);
  if (!futureRaces.length) throw new Error("No upcoming race found.");

  const nextRace = futureRaces[0];
  const weekendEvents = events.filter((e) => e.summary.includes(nextRace.summary));
  const weekendStart = weekendEvents[0]?.start;
  const weekendEnd = weekendEvents[weekendEvents.length - 1]?.end;

  const locationRaw = nextRace.location || "";
  const country = titleCase(locationRaw);
  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: nextRace.summary,
      season: String(nextRace.start.getUTCFullYear()),
      location: {
        raw: locationRaw || null,
        country: country || null,
        flag,
      },
      countdowns: { startsInDays: daysUntil(weekendStart, now) },
      weekend: { startUtc: weekendStart?.toISOString() || null, endUtc: weekendEnd?.toISOString() || null },
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Next race JSON written:", out.nextEvent.title, "in", country);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});