/**
 * Small 5-field cron helper for the automations editor: human descriptions and a
 * client-side "next runs" preview. The server stays the source of truth for validation.
 */

interface Parsed {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function field(src: string, [lo, hi]: [number, number]): Set<number> | null {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1) return null;
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      a = Number(m[2]);
      b = m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a;
    }
    if (a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Parsed | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => field(p, RANGES[i]!));
  if (sets.some((s) => s === null)) return null;
  const [minute, hour, dom, month, dow] = sets as Set<number>[];
  if (dow!.has(7)) dow!.add(0);
  return {
    minute: minute!,
    hour: hour!,
    dom: dom!,
    month: month!,
    dow: dow!,
    domAny: parts[2] === "*",
    dowAny: parts[4] === "*",
  };
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function time(h: number, m: number) {
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "Weekdays at 9:00", "Every day at 8:00", "Every hour", or null when it's not a simple shape. */
export function describeCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || !parseCron(expr)) return null;
  const [mi, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const everyN = /^\*\/(\d+)$/;
  if (mon !== "*" || dom !== "*") {
    if (/^\d+$/.test(mi) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === "*" && dow === "*")
      return `Monthly on day ${dom} at ${time(Number(h), Number(mi))}`;
    return null;
  }
  if (h === "*" && dow === "*") {
    if (mi === "0") return "Every hour";
    const m = everyN.exec(mi);
    if (m) return `Every ${m[1]} minutes`;
    if (/^\d+$/.test(mi)) return `Every hour at :${mi.padStart(2, "0")}`;
    return null;
  }
  const hm = everyN.exec(h);
  if (hm && mi === "0" && dow === "*") return `Every ${hm[1]} hours`;
  if (!/^\d+$/.test(mi) || !/^\d+$/.test(h)) return null;
  const at = time(Number(h), Number(mi));
  if (dow === "*") return `Every day at ${at}`;
  if (dow === "1-5") return `Weekdays at ${at}`;
  if (dow === "0,6" || dow === "6,0") return `Weekends at ${at}`;
  if (/^\d$/.test(dow)) return `${DAY[Number(dow) % 7]}s at ${at}`;
  return null;
}

function wallParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "");
  return {
    minute: Number(p.minute),
    hour: Number(p.hour),
    day: Number(p.day),
    month: Number(p.month),
    dow: wd,
  };
}

function validTz(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Next `count` fire times after `from`, evaluated in `tz`. Searches up to ~5 weeks. */
export function nextRuns(expr: string, tz: string, count = 3, from = new Date()): Date[] | null {
  const c = parseCron(expr);
  if (!c || !validTz(tz)) return null;
  const out: Date[] = [];
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const end = t + 36 * 86_400_000;
  while (t < end && out.length < count) {
    const w = wallParts(new Date(t), tz);
    if (!c.month.has(w.month)) {
      t += 3_600_000;
      continue;
    }
    const domOk = c.dom.has(w.day);
    const dowOk = c.dow.has(w.dow);
    const dayOk = c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk;
    if (!dayOk || !c.hour.has(w.hour)) {
      // jump to the next whole hour
      t += (60 - w.minute) * 60_000;
      continue;
    }
    if (c.minute.has(w.minute)) out.push(new Date(t));
    t += 60_000;
  }
  return out;
}

export const SCHEDULE_PRESETS = [
  { label: "Weekdays 9:00", cron: "0 9 * * 1-5" },
  { label: "Every day 8:00", cron: "0 8 * * *" },
  { label: "Mondays 8:00", cron: "0 8 * * 1" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
];
