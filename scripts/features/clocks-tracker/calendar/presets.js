/**
 * Built-in calendar presets, expressed in Foundry's native CalendarConfig
 * schema (foundry.data.types.CalendarConfig). Each is a complete definition
 * the module can assign to CONFIG.time.worldCalendarConfig.
 *
 * Day timing is standard 24h/60m/60s across all presets so the module's
 * shift/stretch math (86,400 s/day) stays aligned.
 */

const STD_DAY = { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 };

const wk = (names) => names.map((name, i) => ({ name, ordinal: i + 1 }));
const mo = (rows) => rows.map(([name, days, abbreviation], i) => ({
  name, ordinal: i + 1, days, abbreviation: abbreviation ?? name.slice(0, 3)
}));

/** Simplified Gregorian (real-world). */
export const GREGORIAN = {
  name: "Gregorian",
  description: "The standard real-world calendar.",
  years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 0, leapInterval: 4 } },
  days: {
    values: wk(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]),
    daysPerYear: 365, ...STD_DAY
  },
  months: {
    values: mo([
      ["January", 31], ["February", 28], ["March", 31], ["April", 30],
      ["May", 31], ["June", 30], ["July", 31], ["August", 31],
      ["September", 30], ["October", 31], ["November", 30], ["December", 31]
    ]).map(m => m.ordinal === 2 ? { ...m, leapDays: 29 } : m)
  },
  seasons: {
    values: [
      { name: "Winter", monthStart: 12, monthEnd: 2 },
      { name: "Spring", monthStart: 3, monthEnd: 5 },
      { name: "Summer", monthStart: 6, monthEnd: 8 },
      { name: "Autumn", monthStart: 9, monthEnd: 11 }
    ]
  }
};

/** Golarion — Absalom Reckoning (Pathfinder). Matches the design mockup. */
export const GOLARION = {
  name: "Golarion (Absalom Reckoning)",
  description: "The calendar of Golarion, used in Pathfinder.",
  years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 0, leapInterval: 8 } },
  days: {
    values: wk(["Moonday", "Toilday", "Wealday", "Oathday", "Fireday", "Starday", "Sunday"]),
    daysPerYear: 365, ...STD_DAY
  },
  months: {
    values: mo([
      ["Abadius", 31], ["Calistril", 28], ["Pharast", 31], ["Gozran", 30],
      ["Desnus", 31], ["Sarenith", 30], ["Erastus", 31], ["Arodus", 31],
      ["Rova", 30], ["Lamashan", 31], ["Neth", 30], ["Kuthona", 31]
    ]).map(m => m.ordinal === 2 ? { ...m, leapDays: 29 } : m)
  },
  seasons: {
    values: [
      { name: "Deep Winter", monthStart: 12, monthEnd: 2 },
      { name: "Thaw", monthStart: 3, monthEnd: 5 },
      { name: "High Sun", monthStart: 6, monthEnd: 8 },
      { name: "Harvest", monthStart: 9, monthEnd: 11 }
    ]
  }
};

/**
 * Harptos — Calendar of Faerûn (Forgotten Realms / D&D).
 * 12 months of 30 days plus 5 intercalary festival days = 365.
 * Faerûn uses a ten-day "tenday" rather than named weekdays.
 */
export const HARPTOS = {
  name: "Harptos (Calendar of Harptos)",
  description: "The calendar of Faerûn used in the Forgotten Realms.",
  years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 0, leapInterval: 4 } },
  days: {
    values: wk(["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"]),
    daysPerYear: 365, ...STD_DAY
  },
  months: {
    values: [
      { name: "Hammer", ordinal: 1, days: 30, abbreviation: "Ham" },
      { name: "Midwinter", ordinal: 2, days: 1, intercalary: true, abbreviation: "MidW" },
      { name: "Alturiak", ordinal: 3, days: 30, abbreviation: "Alt" },
      { name: "Ches", ordinal: 4, days: 30, abbreviation: "Ches" },
      { name: "Tarsakh", ordinal: 5, days: 30, abbreviation: "Tar" },
      { name: "Greengrass", ordinal: 6, days: 1, intercalary: true, abbreviation: "Grn" },
      { name: "Mirtul", ordinal: 7, days: 30, abbreviation: "Mir" },
      { name: "Kythorn", ordinal: 8, days: 30, abbreviation: "Kyt" },
      { name: "Flamerule", ordinal: 9, days: 30, abbreviation: "Fla" },
      { name: "Midsummer", ordinal: 10, days: 1, intercalary: true, abbreviation: "MidS", leapDays: 2 },
      { name: "Eleasis", ordinal: 11, days: 30, abbreviation: "Ele" },
      { name: "Eleint", ordinal: 12, days: 30, abbreviation: "Elt" },
      { name: "Highharvestide", ordinal: 13, days: 1, intercalary: true, abbreviation: "Hhv" },
      { name: "Marpenoth", ordinal: 14, days: 30, abbreviation: "Mar" },
      { name: "Uktar", ordinal: 15, days: 30, abbreviation: "Ukt" },
      { name: "Feast of the Moon", ordinal: 16, days: 1, intercalary: true, abbreviation: "Moon" },
      { name: "Nightal", ordinal: 17, days: 30, abbreviation: "Nig" }
    ]
  },
  seasons: {
    values: [
      { name: "Winter", monthStart: 1, monthEnd: 3 },
      { name: "Spring", monthStart: 4, monthEnd: 7 },
      { name: "Summer", monthStart: 8, monthEnd: 11 },
      { name: "Autumn", monthStart: 12, monthEnd: 15 }
    ]
  }
};

/**
 * Ourolyn — the homebrew calendar (era: After Sundering, "A.S.").
 *
 * 8-day weeks, 12 months ("First Shadow" … "Twelfth Shadow") of 32 days each
 * (= 4 weeks/month, 48 weeks/year). After the 12th month comes a single
 * intercalary "Day of Renewal" that sits outside the weekday cycle before the
 * year rolls back to day 1 — so every year begins on the same weekday.
 * Total: 12 × 32 + 1 = 385 days/year.
 */
const OUROLYN_MONTH_WORDS = [
  "First", "Second", "Third", "Fourth", "Fifth", "Sixth",
  "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"
];

export const OUROLYN = {
  name: "Ourolyn (After Sundering)",
  description: "The calendar of the world of Ourolyn, reckoned in years After Sundering (A.S.).",
  years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 0, leapInterval: 0 } },
  days: {
    values: [
      { name: "Earthday",  ordinal: 1 },
      { name: "Tideday",   ordinal: 2 },
      { name: "Waveday",   ordinal: 3 },
      { name: "Skyday",    ordinal: 4, isRestDay: true },
      { name: "Stormday",  ordinal: 5 },
      { name: "Starday",   ordinal: 6 },
      { name: "Sunday",    ordinal: 7, isRestDay: true },
      { name: "Flameday",  ordinal: 8, isRestDay: true }
    ],
    daysPerYear: 385, ...STD_DAY
  },
  months: {
    values: [
      ...OUROLYN_MONTH_WORDS.map((w, i) => ({
        name: `${w} Shadow`, ordinal: i + 1, days: 32, abbreviation: `${i + 1}Sh`
      })),
      { name: "Day of Renewal", ordinal: 13, days: 1, intercalary: true, abbreviation: "Ren" }
    ]
  },
  seasons: {
    // Placeholder names — rename freely in the calendar editor.
    values: [
      { name: "Spring", monthStart: 1, monthEnd: 3 },
      { name: "Summer", monthStart: 4, monthEnd: 6 },
      { name: "Autumn", monthStart: 7, monthEnd: 9 },
      { name: "Winter", monthStart: 10, monthEnd: 12 }
    ]
  }
};

export const PRESETS = {
  ourolyn: OUROLYN,
  gregorian: GREGORIAN,
  golarion: GOLARION,
  harptos: HARPTOS
};

export const DEFAULT_PRESET = "ourolyn";
