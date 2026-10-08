import { battingLines, battingTeam, type LoggedPlay, type Team } from "@/lib/boxScore";

// Game exports as spreadsheets: one row per play, and one row per batter.

export interface GameInfo {
  teamNames: Record<Team, string>;
  date: Date;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // quote anything that would break a row, and double any quotes inside
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function describeRunners(runners: LoggedPlay["play"]["runners"]): string {
  return runners.map((r) => `${r.runner ? `${r.runner} ` : ""}${r.from} to ${r.to}`).join("; ");
}

export function playByPlayCsv(log: LoggedPlay[], info: GameInfo): string {
  const header = [
    "#", "Inning", "Half", "Batting", "Batter", "Pitcher", "Play", "Description", "Runners",
    "RBI", "Outs on play", "Runs", "Outs after", `${info.teamNames.away} score`, `${info.teamNames.home} score`,
    "Fielders", "Hit type", "Hit location", "Contact", "Pitch", "Pitch location", "Count", "Confidence",
  ];
  const rows = log.map(({ play, before, after }, i) => {
    const team = battingTeam(before.half);
    return [
      i + 1,
      before.inning,
      before.half,
      info.teamNames[team],
      play.batter,
      play.pitcher,
      play.action,
      play.description,
      describeRunners(play.runners),
      play.rbi,
      play.outs_recorded,
      after.score[team] - before.score[team],
      // the inning rolls over on the third out, so read it from the play
      Math.min(3, before.outs + play.outs_recorded),
      after.score.away,
      after.score.home,
      play.fielders_involved.join("-"),
      play.hit_type,
      play.hit_location,
      play.hit_hardness,
      play.pitch_type,
      play.pitch_location,
      play.count,
      play.confidence,
    ];
  });
  return toCsv([header, ...rows]);
}

export const average = (h: number, ab: number) => (ab ? (h / ab).toFixed(3).replace(/^0/, "") : "---");

export function battingCsv(log: LoggedPlay[], info: GameInfo): string {
  const header = ["Team", "Batter", "PA", "AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "K", "AVG"];
  const rows = battingLines(log).map((b) => [
    info.teamNames[b.team], b.name, b.pa, b.ab, b.r, b.h, b.doubles, b.triples, b.hr, b.rbi, b.bb, b.k, average(b.h, b.ab),
  ]);
  return toCsv([header, ...rows]);
}

export function fileBaseName(info: GameInfo): string {
  const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
  const day = info.date.toISOString().slice(0, 10);
  return `${slug(info.teamNames.away)}-at-${slug(info.teamNames.home)}-${day}`;
}

export function downloadFile(name: string, contents: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(name: string, csv: string) {
  // the byte order mark makes Excel read accented names (Acuña) correctly
  downloadFile(name, "﻿" + csv, "text/csv;charset=utf-8");
}
