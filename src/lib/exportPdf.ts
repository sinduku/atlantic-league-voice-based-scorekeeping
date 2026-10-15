import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { GameState } from "@/types/game";
import { battingLines, battingTeam, lineScore, teamOf, type LoggedPlay, type Team } from "@/lib/boxScore";
import { inningsPitched, pitchingLines } from "@/lib/pitching";
import { average, describeRunners, fileBaseName, type GameInfo } from "@/lib/exportCsv";
import { BASES, FIELD, LEGEND, isBallInPlay, isHit, markerColor, sprayPoint, toXY } from "@/lib/sprayGeometry";

// A printable game report: line score, spray charts for both teams, batting
// lines and the full play-by-play. Loaded only when someone exports, so jsPDF
// stays out of the main bundle.

const NAVY: [number, number, number] = [23, 37, 84];
const MARGIN = 40;

// the built-in PDF fonts have no ▲▼, so innings read T3 / B3
const half = (state: Pick<GameState, "half" | "inning">) => `${state.half === "top" ? "T" : "B"}${state.inning}`;

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

function hex(color: string): [number, number, number] {
  const n = parseInt(color.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// draws a closed shape from points already in page coordinates
function shape(doc: jsPDF, points: { x: number; y: number }[], style: "F" | "S" | "FD") {
  const [first, ...rest] = points;
  const segments = rest.map((p, i) => [p.x - (i ? rest[i - 1].x : first.x), p.y - (i ? rest[i - 1].y : first.y)]);
  doc.lines(segments, first.x, first.y, [1, 1], style, true);
}

function arc(angleFrom: number, angleTo: number, radius: number, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => toXY(angleFrom + ((angleTo - angleFrom) * i) / steps, radius));
}

function drawSprayChart(doc: jsPDF, log: LoggedPlay[], team: Team, title: string, left: number, top: number, width: number) {
  // the box has room above the fence for home runs; the PDF only needs some of it
  const trim = 22;
  const scale = width / FIELD.width;
  const height = (FIELD.height - trim) * scale;
  const at = (p: { x: number; y: number }) => ({ x: left + p.x * scale, y: top + 16 + (p.y - trim) * scale });

  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...NAVY);
  doc.text(title, left + width / 2, top + 8, { align: "center" });

  const home = FIELD.home;
  doc.setFillColor(220, 239, 213).setDrawColor(95, 143, 82).setLineWidth(1);
  shape(doc, [home, ...arc(-45, 45, FIELD.fence)].map(at), "FD");
  doc.setFillColor(234, 217, 191);
  shape(doc, [home, ...arc(-45, 45, FIELD.dirt)].map(at), "F");
  doc.setFillColor(207, 230, 198);
  shape(
    doc,
    [
      { x: home.x, y: home.y - 9 },
      { x: BASES.first.x - 9, y: BASES.first.y },
      { x: BASES.second.x, y: BASES.second.y + 9 },
      { x: BASES.third.x + 9, y: BASES.third.y },
    ].map(at),
    "F"
  );
  doc.setDrawColor(255, 255, 255).setLineWidth(0.8);
  shape(doc, [home, BASES.first, BASES.second, BASES.third].map(at), "S");
  for (const angle of [-45, 45]) {
    const a = at(home);
    const b = at(toXY(angle, FIELD.fence));
    doc.line(a.x, a.y, b.x, b.y);
  }

  // same order and spacing as the on-screen chart, then only this team's balls
  const balls = log
    .map((e) => e.play)
    .filter(isBallInPlay)
    .map((play, i) => ({ play, point: sprayPoint(play, i) }))
    .filter(({ play }) => teamOf(play) === team);

  for (const { play, point } of balls) {
    const p = at(point);
    const color = hex(markerColor(play));
    doc.setDrawColor(...color);
    if (isHit(play)) {
      doc.setFillColor(...color).setLineWidth(0.6);
      doc.circle(p.x, p.y, 3.2, "FD");
    } else {
      doc.setFillColor(255, 255, 255).setLineWidth(1.2);
      doc.circle(p.x, p.y, 3, "FD");
    }
  }

  const hits = balls.filter(({ play }) => isHit(play)).length;
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90);
  doc.text(
    balls.length ? `${balls.length} in play, ${hits} hit${hits === 1 ? "" : "s"}` : "No balls in play",
    left + width / 2,
    top + 16 + height + 10,
    { align: "center" }
  );
  return top + 16 + height + 22;
}

export function exportPdf(log: LoggedPlay[], state: GameState, info: GameInfo) {
  const doc: Doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const { away, home } = info.teamNames;
  const score = lineScore(log, state);

  // header
  doc.setFillColor(...NAVY).rect(0, 0, pageWidth, 64, "F");
  doc.setTextColor(255).setFont("helvetica", "bold").setFontSize(18);
  doc.text(`${away} ${score.away.runs}, ${home} ${score.home.runs}`, MARGIN, 30);
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(
    `${info.date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}  ·  ${log.length} plays  ·  through ${half(state)}`,
    MARGIN,
    48
  );
  doc.text("Voice Scorekeeper · Atlantic League", pageWidth - MARGIN, 30, { align: "right" });

  // line score
  const inningCols = Array.from({ length: score.innings }, (_, i) => String(i + 1));
  const lineRow = (name: string, line: typeof score.away) => [
    name,
    ...line.runsByInning.map((r) => (r === null ? "" : String(r))),
    String(line.runs),
    String(line.hits),
    String(line.errors),
  ];
  autoTable(doc, {
    startY: 84,
    head: [["", ...inningCols, "R", "H", "E"]],
    body: [lineRow(away, score.away), lineRow(home, score.home)],
    theme: "grid",
    styles: { fontSize: 10, halign: "center", cellPadding: 4 },
    headStyles: { fillColor: NAVY },
    columnStyles: {
      0: { halign: "left", fontStyle: "bold", cellWidth: 110 },
      [score.innings + 1]: { fontStyle: "bold", fillColor: [238, 242, 255] },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  // spray charts side by side
  const chartTop = (doc.lastAutoTable?.finalY ?? 140) + 18;
  const chartWidth = (pageWidth - MARGIN * 2 - 24) / 2;
  const chartBottom = Math.max(
    drawSprayChart(doc, log, "away", `${away} batters`, MARGIN, chartTop, chartWidth),
    drawSprayChart(doc, log, "home", `${home} batters`, MARGIN + chartWidth + 24, chartTop, chartWidth)
  );
  // legend
  doc.setFont("helvetica", "normal").setFontSize(8);
  let x = MARGIN;
  for (const item of LEGEND) {
    doc.setFillColor(...hex(item.color)).circle(x + 3, chartBottom + 4, 3, "F");
    doc.setTextColor(70).text(item.label, x + 9, chartBottom + 7);
    x += doc.getTextWidth(item.label) + 22;
  }
  doc.setDrawColor(110).setFillColor(255, 255, 255).setLineWidth(1).circle(x + 3, chartBottom + 4, 3, "FD");
  doc.text("Hollow = out, filled = hit", x + 9, chartBottom + 7);

  // batting
  const batting = battingLines(log);
  let y = chartBottom + 24;
  for (const team of ["away", "home"] as Team[]) {
    const rows = batting.filter((b) => b.team === team);
    const totals = rows.reduce(
      (t, b) => ({ pa: t.pa + b.pa, ab: t.ab + b.ab, r: t.r + b.r, h: t.h + b.h, rbi: t.rbi + b.rbi, bb: t.bb + b.bb, k: t.k + b.k, hr: t.hr + b.hr }),
      { pa: 0, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0 }
    );
    autoTable(doc, {
      startY: y,
      head: [[`${info.teamNames[team]} batting`, "PA", "AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "K", "AVG"]],
      body: rows.length
        ? rows.map((b) => [b.name, b.pa, b.ab, b.r, b.h, b.doubles, b.triples, b.hr, b.rbi, b.bb, b.k, average(b.h, b.ab)])
        : [["No plate appearances yet", "", "", "", "", "", "", "", "", "", "", ""]],
      foot: rows.length
        ? [["Totals", totals.pa, totals.ab, totals.r, totals.h, "", "", totals.hr, totals.rbi, totals.bb, totals.k, average(totals.h, totals.ab)]]
        : undefined,
      theme: "striped",
      styles: { fontSize: 9, halign: "center", cellPadding: 3 },
      headStyles: { fillColor: NAVY },
      footStyles: { fillColor: [238, 242, 255], textColor: 20 },
      columnStyles: { 0: { halign: "left", cellWidth: 150 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 14;
  }

  // pitching
  const pitching = pitchingLines(log, info.pitchCounts);
  for (const team of ["away", "home"] as Team[]) {
    const rows = pitching.filter((p) => p.team === team);
    autoTable(doc, {
      startY: y,
      head: [[`${info.teamNames[team]} pitching`, "IP", "BF", "H", "R", "BB", "HBP", "K", "HR", "Pitches"]],
      body: rows.length
        ? rows.map((p) => [p.name, inningsPitched(p.outs), p.bf, p.h, p.r, p.bb, p.hbp, p.k, p.hr, p.pitches ?? ""])
        : [["No pitching recorded yet", "", "", "", "", "", "", "", "", ""]],
      theme: "striped",
      styles: { fontSize: 9, halign: "center", cellPadding: 3 },
      headStyles: { fillColor: NAVY },
      columnStyles: { 0: { halign: "left", cellWidth: 150 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 14;
  }
  // earned runs depend on the official scorer's call on errors, which the app
  // doesn't make, so say what R means rather than let it pass for ER
  doc.setFont("helvetica", "italic").setFontSize(8).setTextColor(110);
  doc.text("R is all runs allowed, charged to the pitcher who put each runner on base. Pitches are tap-counted.", MARGIN, y);
  y += 10;

  // play-by-play
  autoTable(doc, {
    startY: y + 6,
    head: [["#", "Inn", "Batter", "Play", "Description", "Runners", "RBI", "Score"]],
    body: log.map(({ play, before, after }, i) => [
      i + 1,
      half(before),
      play.batter || "",
      play.action,
      play.description,
      describeRunners(play.runners),
      play.rbi || "",
      `${after.score.away}-${after.score.home}${after.score[battingTeam(before.half)] > before.score[battingTeam(before.half)] ? " *" : ""}`,
    ]),
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 3, valign: "top" },
    headStyles: { fillColor: NAVY },
    columnStyles: {
      0: { cellWidth: 20, halign: "right" },
      1: { cellWidth: 28 },
      2: { cellWidth: 70 },
      3: { cellWidth: 62 },
      5: { cellWidth: 110 },
      6: { cellWidth: 28, halign: "center" },
      7: { cellWidth: 40, halign: "center" },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  // page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFont("helvetica", "normal").setFontSize(8).setTextColor(130);
    doc.text(`Page ${i} of ${pages}  ·  * runs scored on the play`, pageWidth / 2, doc.internal.pageSize.getHeight() - 20, {
      align: "center",
    });
  }

  doc.save(`${fileBaseName(info)}.pdf`);
}
