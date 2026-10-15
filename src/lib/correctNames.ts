// Fixes player names in a speech transcript. The browser's recognizer has no
// way to take a custom vocabulary, so it writes "Acuna" or "a coon ya" for
// Acuña and "tatis" for Tatis. Before the transcript goes anywhere it is
// matched, one to three words at a time, against the known player list: exact
// matches (ignoring case and accents) and close sound-alikes are rewritten to
// the proper spelling, so the scoreboard and the model both see the real name.
//
// Baseball and everyday words are never treated as names, otherwise "single"
// could turn into Singleton and "center" into a pitcher.

export interface NameIndex {
  entries: Entry[];
  // entries grouped by the first letter of their sound key, which is all a
  // fuzzy match is ever compared against
  byHead: Map<string, Entry[]>;
  exact: Map<string, Entry>;
}

interface Entry {
  display: string;
  letters: string;
  sound: string;
}

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

// words that must never be read as part of a name
const NOT_NAMES = new Set(
  `a an the and or but to too at in on of off for from by with into onto over up down out
  is was were be been are it its his her he she they them him this that there then than
  as so if no not yes all one two three four five six seven eight nine ten zero
  first second third home plate base bases runner runners batter pitcher catcher
  short shortstop left right center centre field fielder infield outfield line gap wall
  hit hits single singles double doubles triple triples homer homers home-run run runs
  scores score scored scoring safe out outs strike strikes struck strikeout looking swinging
  ball balls walk walks walked fly flies flied flyout pop pops popped popup ground grounds
  grounded grounder groundout line lines lined liner bunt bunts bunted sac sacrifice
  error errors fielder's choice steal steals stole stolen wild pitch passed balk
  play plays tag tags tagged force forced throw throws threw thrown caught catch
  takes take took goes go went move moves moved advance advances advanced
  deep shallow hard soft sharp slow medium over back middle hole way
  inning top bottom count full fastball curve curveball slider changeup sinker cutter splitter
  rbi dp tp hbp k e f l p u g`.split(/\s+/)
);

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const toLetters = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z]/g, "");

// a rough sound key: spellings that sound alike collapse to the same string,
// and vowels after the first letter are dropped since recognizers swap them
export function soundKey(word: string): string {
  let s = toLetters(word);
  if (!s) return "";
  s = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/gh/g, "g")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/y/g, "i")
    .replace(/([^aeiou])h/g, "$1");
  const head = s[0];
  const rest = s.slice(1).replace(/[aeiouhw]/g, "");
  return (head + rest).replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// every way a scorekeeper is likely to say a name: in full, and surname only
function surfaceForms(fullName: string): string[] {
  const words = fullName.trim().split(/\s+/).filter((w) => !SUFFIX.test(w));
  if (!words.length) return [];
  const forms = [words.join(" ")];
  // leading initials ("A. J.") count as the first name
  let i = 0;
  while (i < words.length - 1 && /^[A-Z]\.?$/i.test(words[i])) i++;
  if (i === 0) i = 1;
  const surname = words.slice(i);
  if (surname.length) forms.push(surname.join(" "));
  return forms;
}

export function buildNameIndex(names: string[]): NameIndex {
  const exact = new Map<string, Entry>();
  for (const name of names) {
    for (const form of surfaceForms(name)) {
      const letters = toLetters(form);
      if (letters.length < 3 || exact.has(letters)) continue;
      if (!form.includes(" ") && NOT_NAMES.has(letters)) continue;
      exact.set(letters, { display: form, letters, sound: soundKey(form) });
    }
  }
  const entries = [...exact.values()];
  const byHead = new Map<string, Entry[]>();
  for (const e of entries) {
    const head = e.sound[0];
    if (!byHead.has(head)) byHead.set(head, []);
    byHead.get(head)!.push(e);
  }
  return { entries, byHead, exact };
}

interface Match {
  start: number;
  length: number;
  score: number;
  display: string;
}

function bestMatch(index: NameIndex, phrase: string): { display: string; score: number } | null {
  const letters = toLetters(phrase);
  if (letters.length < 3) return null;

  const hit = index.exact.get(letters);
  if (hit) return { display: hit.display, score: 1 };

  // short words are too easy to confuse with something else
  if (letters.length < 4) return null;

  const sound = soundKey(phrase);
  let best: { display: string; score: number } | null = null;
  for (const e of index.byHead.get(sound[0]) ?? []) {
    if (Math.abs(e.letters.length - letters.length) > 3) continue;
    const similarity = 1 - levenshtein(letters, e.letters) / Math.max(letters.length, e.letters.length);
    const sameSound = e.sound === sound;
    // sounds alike and is spelled roughly alike, or is spelled very nearly alike
    const accepted = (sameSound && similarity >= 0.5) || (similarity >= 0.84 && e.letters.length >= 5);
    if (!accepted) continue;
    const score = similarity + (sameSound ? 0.1 : 0);
    if (!best || score > best.score) best = { display: e.display, score };
  }
  return best;
}

export function correctNames(transcript: string, index: NameIndex | null): string {
  if (!index || !transcript.trim()) return transcript;

  const tokens = transcript.split(/\s+/).filter(Boolean);
  // a possessive is matched without its "'s" and put back afterwards
  const possessive = tokens.map((t) => /['’]s[^\p{L}]*$/iu.test(t));
  const bare = tokens.map((t, i) => toLetters(possessive[i] ? t.replace(/['’]s([^\p{L}]*)$/iu, "$1") : t));
  const matches: Match[] = [];

  for (let start = 0; start < tokens.length; start++) {
    for (let length = 1; length <= 3 && start + length <= tokens.length; length++) {
      const words = bare.slice(start, start + length);
      if (words.some((w) => !w || NOT_NAMES.has(w))) break;
      // a name can't run across a comma or full stop
      if (tokens.slice(start, start + length - 1).some((t) => /[,.;:!?]$/.test(t))) break;
      const m = bestMatch(index, words.join(""));
      if (m) matches.push({ start, length, score: m.score + length * 0.01, display: m.display });
    }
  }

  // best matches win; a longer match beats its own pieces on a tie
  matches.sort((a, b) => b.score - a.score || b.length - a.length);
  const taken = new Array(tokens.length).fill(false);
  const chosen: Match[] = [];
  for (const m of matches) {
    let free = true;
    for (let i = m.start; i < m.start + m.length; i++) if (taken[i]) free = false;
    if (!free) continue;
    for (let i = m.start; i < m.start + m.length; i++) taken[i] = true;
    chosen.push(m);
  }

  chosen.sort((a, b) => b.start - a.start);
  const out = [...tokens];
  for (const m of chosen) {
    // keep punctuation the recognizer put after the name ("acuna," -> "Acuña,")
    const last = m.start + m.length - 1;
    const trailing = out[last].match(/[^\p{L}\p{N}'’]+$/u)?.[0] ?? "";
    out.splice(m.start, m.length, m.display + (possessive[last] ? "'s" : "") + trailing);
  }
  return out.join(" ");
}

// the list is ~50KB, so it loads after the page instead of with it
let loading: Promise<string[]> | null = null;

// every known player, hand-added names first so they win any tie
export function loadPlayerNames(): Promise<string[]> {
  if (!loading) {
    loading = Promise.all([import("@/data/players.json"), import("@/data/extra-players.txt?raw")]).then(
      ([list, extra]) => {
        const extraNames = (extra.default as string)
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
        const players = (list.default as { players: string[][] }).players;
        return [...extraNames, ...players.map((p) => p[0])];
      }
    );
  }
  return loading;
}

export function loadNameIndex(): Promise<NameIndex> {
  return loadPlayerNames().then(buildNameIndex);
}
