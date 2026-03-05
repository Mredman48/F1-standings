const fs = require("fs");

const YEAR = 2026;
const OUTPUT = "f1_next_race.json";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url}`);
  return await res.json();
}

function isoToFlag(iso2) {
  if (!iso2) return null;
  return {
    iso2: iso2.toLowerCase(),
    png: `https://flagcdn.com/w160/${iso2.toLowerCase()}.png`,
    svg: `https://flagcdn.com/${iso2.toLowerCase()}.svg`
  };
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace("grand prix", "")
    .replace(/[^\w\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

async function getNextMeeting() {

  const meetings = await fetchJson(
    `https://api.openf1.org/v1/meetings?year=${YEAR}`
  );

  const now = new Date();

  const next = meetings
    .map(m => ({
      ...m,
      start: new Date(m.date_start),
      end: new Date(m.date_end)
    }))
    .filter(m => m.end > now)
    .sort((a, b) => a.start - b.start)[0];

  return next;
}

async function run() {

  const meeting = await getNextMeeting();

  if (!meeting) {
    console.log("No upcoming race weekend found.");
    return;
  }

  const slug = slugify(meeting.meeting_name);

  const weekendStart = new Date(meeting.date_start);
  const weekendEnd = new Date(meeting.date_end);

  const now = new Date();
  const diffDays = Math.floor((weekendStart - now) / (1000 * 60 * 60 * 24));

  const json = {

    header: "Next F1 event",

    generatedAtUtc: new Date().toISOString(),

    displayTimeZone: "America/Edmonton",

    source: {
      kind: "openf1",
      url: "https://api.openf1.org/v1/meetings"
    },

    nextEvent: {

      type: "RACE_WEEKEND",

      title: meeting.meeting_name,

      season: String(meeting.year),

      location: {
        raw: meeting.country_name,
        city: meeting.location,
        country: meeting.country_name,
        flag: isoToFlag(meeting.country_code)
      },

      racePage: {
        slug: slug,
        url: `https://www.formula1.com/en/racing/${meeting.year}/${slug}`
      },

      trackMap: {
        found: true,
        pageUrl: `https://www.formula1.com/en/racing/${meeting.year}/${slug}`,
        mediaUrl: null,
        pngUrl: `https://mredman48.github.io/F1-standings/trackmaps/f1_${meeting.year}_${slug}_detailed.png`,
        note: null
      },

      countdowns: {
        startsInDays: diffDays
      },

      weekend: {
        startUtc: weekendStart.toISOString(),
        endUtc: weekendEnd.toISOString()
      }

    }
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(json, null, 2));

  console.log("Generated", OUTPUT);
}

run();
