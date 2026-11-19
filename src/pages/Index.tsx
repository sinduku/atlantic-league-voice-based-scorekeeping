import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Download, FileSpreadsheet, FileText, Flag, Keyboard, Pencil, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChallengeDialog } from "@/components/ChallengeDialog";
import { Scorecard } from "@/components/Scorecard";
import { challengeCounts, challengeLabel } from "@/lib/challenges";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { PlayCard } from "@/components/PlayCard";
import { SprayChart } from "@/components/SprayChart";
import { Scoreboard } from "@/components/Scoreboard";
import { LineScore } from "@/components/LineScore";
import { LineupPanel } from "@/components/LineupPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { createGame, deletePlay, replacePlaysFrom, savePlay, type SaveResult } from "@/lib/persistence";
import { replayLog, withEdit, type ReplayProblem } from "@/lib/replay";
import {
  PITCH_LABELS,
  countOf,
  decided,
  formatCount,
  isStrike,
  parsePitch,
  pitchesForPlay,
  pitchesToRestore,
  type PitchCode,
} from "@/lib/pitches";
import { normalizePlay, zoneFor } from "@/lib/normalizePlay";
import { describeSpot } from "@/lib/sprayGeometry";
import { describePlay, describeSituation, isSkip, matchAnswer, openQuestions, type ClarifyOption } from "@/lib/clarify";
import { ClarifyPanel } from "@/components/ClarifyPanel";
import { parseShorthand } from "@/lib/shorthand";
import { buildNameIndex, correctNames, loadPlayerNames } from "@/lib/correctNames";
import { checkPlay } from "@/lib/checkPlay";
import { buildParseContext } from "@/lib/parseContext";
import { battingTeam, inningLabel, isPlateAppearance, type LoggedPlay, type Team } from "@/lib/boxScore";
import {
  EMPTY_LINEUPS,
  applyLineup,
  currentBatter,
  currentPitcher,
  dueUpSlot,
  hasBattingOrder,
  lineupNames,
  otherTeam,
  type Lineups,
  type TeamLineup,
} from "@/lib/lineup";
import { pitcherKey, pitchingLines } from "@/lib/pitching";
import { battingCsv, downloadCsv, fileBaseName, pitchingCsv, playByPlayCsv, type GameInfo } from "@/lib/exportCsv";
import { type Challenge, type Play, type GameState, INITIAL_GAME_STATE, REGULATION_INNINGS, applyPlayToState } from "@/types/game";

// VITE_PARSE_URL points straight at a deployed endpoint - the GitHub Pages
// build uses the Supabase edge function, since a static site cannot hold the
// AI key. Without it, local dev talks to the Express server in server/.
const PARSE_PLAY_URL =
  import.meta.env.VITE_PARSE_URL ||
  `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/parse-play`;

// past this the scorer is better off trying again than waiting
const PARSE_TIMEOUT_MS = 10000;

const DEFAULT_TEAMS: Record<Team, string> = { away: "Away", home: "Home" };

interface ParseInfo {
  source: "shorthand" | "ai";
  ms: number;
  model?: string;
}

// The game in progress is kept in the browser, so a refresh or a closed tab
// mid-game doesn't lose it. Reset clears it.
const STORAGE_KEY = "voice-scorekeeper:game";

const NOBODY_MARKED: Record<Team, number | null> = { away: null, home: null };

interface SavedGame {
  log: LoggedPlay[];
  gameState: GameState;
  teamNames: Record<Team, string>;
  gameId: string | null;
  startedAt: string;
  // missing from games saved before lineups existed
  lineups?: Lineups;
  markedUp?: Record<Team, number | null>;
  pitchCounts?: Record<string, number>;
  // scheduled innings; missing means nine
  innings?: number;
  // the pitches of the at bat in progress
  pendingPitches?: PitchCode[];
}

function loadSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedGame;
    return Array.isArray(saved.log) && saved.gameState ? saved : null;
  } catch {
    return null;
  }
}

// the pitches a scorer logs by hand; in play and hit by pitch come with the play
const PITCH_KEYS: PitchCode[] = ["B", "C", "S", "F", "T"];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const Index = () => {
  const [restored] = useState(loadSavedGame);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPlay, setCurrentPlay] = useState<Play | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [log, setLog] = useState<LoggedPlay[]>(restored?.log ?? []);
  const [gameState, setGameState] = useState<GameState>(restored?.gameState ?? INITIAL_GAME_STATE);
  const [teamNames, setTeamNames] = useState<Record<Team, string>>(restored?.teamNames ?? DEFAULT_TEAMS);
  const [startedAt, setStartedAt] = useState(restored?.startedAt ?? new Date().toISOString());
  const [savedCount, setSavedCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parseInfo, setParseInfo] = useState<ParseInfo | null>(null);
  const [typed, setTyped] = useState("");
  const [lineups, setLineups] = useState<Lineups>(restored?.lineups ?? EMPTY_LINEUPS);
  // a batter the scorer marked as up by hand, until that team's next plate appearance
  const [markedUp, setMarkedUp] = useState<Record<Team, number | null>>(restored?.markedUp ?? NOBODY_MARKED);
  const [pitchCounts, setPitchCounts] = useState<Record<string, number>>(restored?.pitchCounts ?? {});
  // the batting-order slot the play under review will be credited to
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);
  // the play under review as the parser and lineup left it, before any of the
  // scorer's answers, so "Start over" can go back to it
  const [reviewBase, setReviewBase] = useState<{
    play: Play;
    lineupWarnings: string[];
    transcript: string;
    resolved: string[];
  } | null>(null);
  // questions about the play under review that have been answered or skipped
  const [resolved, setResolved] = useState<string[]>([]);
  const [innings, setInnings] = useState<number>(restored?.innings ?? REGULATION_INNINGS);
  // the confirmed play being scored again, by its place in the log
  const [editing, setEditing] = useState<number | null>(null);
  // later plays that stopped adding up after an edit
  const [problems, setProblems] = useState<ReplayProblem[]>([]);
  // every pitch of the at bat in progress, until the play that ends it
  const [pendingPitches, setPendingPitches] = useState<PitchCode[]>(restored?.pendingPitches ?? []);
  const count = countOf(pendingPitches);
  // the play-by-play row the pointer is on, lit up on the spray chart
  const [hoveredPlay, setHoveredPlay] = useState<number | null>(null);
  const [fieldTab, setFieldTab] = useState<"spray" | "scorecard">("spray");
  const [logTab, setLogTab] = useState<"plays" | "lineups">("plays");

  const confirmedPlays = log.map((e) => e.play);

  const teamLabel = (team: Team) => teamNames[team].trim() || DEFAULT_TEAMS[team];
  const shownTeams = { away: teamLabel("away"), home: teamLabel("home") };

  const batting = battingTeam(gameState.half);
  const fielding = otherTeam(batting);
  const dueUp: Record<Team, number> = {
    away: dueUpSlot("away", log, markedUp.away),
    home: dueUpSlot("home", log, markedUp.home),
  };
  const pitching = useMemo(() => pitchingLines(log, pitchCounts), [log, pitchCounts]);

  // the situation a play under review happened in: now, or before the play
  // being scored again
  const editedEntry = editing != null ? log[editing] ?? null : null;
  const reviewState = editedEntry?.before ?? gameState;
  const reviewLog = editing != null ? log.slice(0, editing) : log;
  const reviewBatting = battingTeam(reviewState.half);
  const reviewDueUp = editedEntry
    ? editedEntry.slot ?? dueUpSlot(reviewBatting, reviewLog)
    : dueUp[batting];
  const atBat = hasBattingOrder(lineups[batting]) ? currentBatter(lineups[batting], dueUp[batting]) : null;
  const pitcherNow = currentPitcher(lineups[fielding]);
  // the scorecard shows the side at bat, and follows it when the side changes
  const [cardTeam, setCardTeam] = useState<Team>(batting);
  useEffect(() => setCardTeam(batting), [batting]);
  // the pitcher's count so far: confirmed plays (and taps), plus the at bat
  // in progress
  const pitchesNow = useMemo(() => {
    if (!pitcherNow) return undefined;
    const line = pitching.find((p) => p.team === fielding && p.name.toLowerCase() === pitcherNow.toLowerCase());
    const tapped = pitchCounts[pitcherKey(fielding, pitcherNow)] ?? 0;
    const strikesNow = pendingPitches.filter(isStrike).length;
    const logged = line?.strikes != null || pendingPitches.length > 0;
    return {
      pitches: (line?.pitches ?? tapped) + pendingPitches.length,
      strikes: logged ? (line?.strikes ?? 0) + strikesNow : null,
    };
  }, [pitcherNow, pitching, fielding, pitchCounts, pendingPitches]);

  // the player list loads once, after the page, and is ready long before the
  // first play is spoken. lineup names go first so a player on today's card
  // wins over a sound-alike elsewhere in the league, and so a player missing
  // from the league list still gets corrected
  const [playerNames, setPlayerNames] = useState<string[] | null>(null);
  useEffect(() => {
    loadPlayerNames()
      .then(setPlayerNames)
      .catch((e) => console.warn("Player names did not load; only lineup names will be corrected", e));
  }, []);
  const nameIndex = useMemo(() => {
    const names = [...lineupNames(lineups), ...(playerNames ?? [])];
    return names.length ? buildNameIndex(names) : null;
  }, [lineups, playerNames]);

  // holds the in-flight (or finished) game insert so rapid confirmations share
  // one game row instead of each creating their own
  const gameRequest = useRef<Promise<SaveResult<string>> | null>(
    restored?.gameId ? Promise.resolve({ ok: true, data: restored.gameId }) : null
  );
  const gameId = useRef<string | null>(restored?.gameId ?? null);

  useEffect(() => {
    if (restored?.log.length) toast(`Picked up your game where you left off (${restored.log.length} plays).`);
  }, [restored]);

  useEffect(() => {
    try {
      const saved: SavedGame = {
        log,
        gameState,
        teamNames,
        gameId: gameId.current,
        startedAt,
        lineups,
        markedUp,
        pitchCounts,
        innings,
        pendingPitches,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // private windows can refuse storage; the game still works, it just won't survive a refresh
    }
  }, [log, gameState, teamNames, startedAt, savedCount, lineups, markedUp, pitchCounts, innings, pendingPitches]);

  const ensureGame = async () => {
    if (!gameRequest.current) {
      gameRequest.current = createGame(teamNames.home, teamNames.away);
    }
    const result = await gameRequest.current;
    // a failed insert shouldn't poison the rest of the game, so let the next
    // confirmed play try again
    if ("error" in result) {
      gameRequest.current = null;
    } else {
      gameId.current = result.data;
    }
    return result;
  };

  // names to offer when nobody said who batted: this team's batters so far,
  // most recent first
  const batterSuggestions = useMemo(() => {
    const names: string[] = [];
    for (let i = reviewLog.length - 1; i >= 0; i--) {
      const { play, before } = reviewLog[i];
      const name = play.batter?.trim();
      if (battingTeam(before.half) === reviewBatting && name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    return names;
  }, [reviewLog, reviewBatting]);

  // what the words left open about the play under review, worked out again
  // after every answer since one answer can change what the next should offer
  const questions = useMemo(
    () =>
      currentPlay && reviewBase
        ? openQuestions(currentPlay, { state: reviewState, transcript: reviewBase.transcript, resolved, batterSuggestions })
        : [],
    [currentPlay, reviewBase, reviewState, resolved, batterSuggestions]
  );
  const question = questions[0] ?? null;
  const mustAnswer = questions.some((q) => q.required);

  const showPlay = (play: Play, info: ParseInfo, transcript: string, alreadyResolved: string[] = []) => {
    // the lineup fills the batter and pitcher first, so the base check sees
    // the real names
    const history = editedEntry
      ? { batter: editedEntry.play.batter, pitcher: editedEntry.play.pitcher, slot: editedEntry.slot }
      : undefined;
    const lined = applyLineup(play, reviewState, lineups, reviewDueUp, shownTeams, history);
    const checked = checkPlay(lined.play, reviewState);
    const allWarnings = [...lined.warnings, ...checked.warnings];
    setReviewBase({ play: checked.play, lineupWarnings: lined.warnings, transcript, resolved: alreadyResolved });
    setResolved(alreadyResolved);
    setCurrentPlay(checked.play);
    setWarnings(allWarnings);
    setPendingSlot(lined.slot);
    setParseInfo(info);
    console.info(
      `[parse] ${info.source}${info.model ? ` (${info.model})` : ""} in ${info.ms}ms`,
      allWarnings.length ? allWarnings : ""
    );
  };

  // the scorer's answer to the open question, picked from its options, or the
  // play parsed again when the answer changes what kind of play it was
  const handlePick = (option: ClarifyOption) => {
    if (!question || !currentPlay) return;
    if (option.reparse) {
      handleTranscript(option.reparse, { resolved: ["action"], asAnswer: false });
      return;
    }
    settle(option.play, [question.id, ...(option.resolves ?? [])]);
  };

  // takes an answered play: the base checks run again, since an answer can
  // fix or cause an outs mismatch
  const settle = (next: Play, ids: string[]) => {
    // the parser's description may state what the scorer just contradicted
    const rechecked = checkPlay({ ...next, description: describePlay(next, reviewState) }, reviewState);
    setCurrentPlay(rechecked.play);
    setWarnings([...(reviewBase?.lineupWarnings ?? []), ...rechecked.warnings]);
    setResolved((prev) => [...prev, ...ids]);
  };

  const handleSkip = () => {
    if (question && currentPlay) settle(currentPlay, [question.id]);
  };

  const handleStartOver = () => {
    if (!reviewBase) return;
    const rechecked = checkPlay(reviewBase.play, reviewState);
    setCurrentPlay(rechecked.play);
    setWarnings([...reviewBase.lineupWarnings, ...rechecked.warnings]);
    setResolved(reviewBase.resolved);
  };

  // spoken or typed words while a question is open are its answer, not a new play
  const handleAnswerText = (raw: string) => {
    if (!question || !currentPlay) return;
    const text = correctNames(raw, nameIndex);
    if (!question.required && isSkip(text)) return handleSkip();
    const option = matchAnswer(question, text);
    if (option) return handlePick(option);
    if (question.textEntry && !isSkip(text)) return settle(question.textEntry.apply(text), [question.id]);
    toast.error(`Didn't catch that. ${question.prompt} Tap an answer or say it again.`);
  };

  const handleTranscript = async (rawTranscript: string, opts: { resolved?: string[]; asAnswer?: boolean } = {}) => {
    if (opts.asAnswer !== false && currentPlay && question) {
      handleAnswerText(rawTranscript);
      return;
    }
    if (gameState.final && editing == null) {
      toast("The game is over. Undo or edit a play to change it, or start a new game.");
      return;
    }
    // a single pitch ("ball", "strike swinging", "foul") goes on the count
    const pitch = editing == null ? parsePitch(rawTranscript) : null;
    if (pitch) {
      addPitch(pitch);
      return;
    }
    const started = performance.now();
    const transcript = correctNames(rawTranscript, nameIndex);
    setLastTranscript(transcript);
    setCurrentPlay(null);
    setReviewBase(null);
    setResolved([]);
    setWarnings([]);
    setParseInfo(null);

    // plain shorthand ("6-3", "K looking") is scored right here, no network
    const local = parseShorthand(transcript, reviewState);
    if (local) {
      showPlay(local, { source: "shorthand", ms: Math.round(performance.now() - started) }, transcript, opts.resolved);
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch(PARSE_PLAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          gameState: reviewState,
          context: buildParseContext(reviewLog, reviewState, teamNames, { lineups, dueUp: reviewDueUp }),
        }),
        signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        // the request id matches this failure to its line in the server log
        const requestId = err.request_id || response.headers.get("x-request-id");
        if (requestId) console.error(`[parse] failed, request ${requestId}`);
        throw new Error(err.error || "Failed to process play");
      }

      const data = await response.json();
      const parsed = normalizePlay(data?.play);
      if (parsed.ok) {
        showPlay(
          parsed.play,
          { source: "ai", ms: Math.round(performance.now() - started), model: data?.timing?.model },
          transcript,
          opts.resolved
        );
      } else {
        toast.error("Couldn't parse that into a play. Try again.");
      }
    } catch (e) {
      console.error(e);
      const err = e as Error;
      if (err?.name === "TimeoutError") toast.error("Parsing took too long. Try again.");
      else if (err instanceof TypeError) toast.error("Can't reach the parsing server. Is `npm start` running in server/?");
      else toast.error(err?.message || "Failed to process play");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTyped = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text || isProcessing) return;
    setTyped("");
    handleTranscript(text);
  };

  const handleConfirm = async () => {
    if (!currentPlay) return;
    if (mustAnswer) {
      toast(`One more detail first: ${question?.prompt}`);
      return;
    }

    // the play is accepted locally first so the scoreboard never waits on the
    // network; persistence catches up behind it. the readings the scorer
    // already chose between aren't part of the record
    let play: Play = { ...currentPlay, alternatives: null };
    if (editing != null) {
      // the pitches were logged as they were thrown; scoring the result again
      // doesn't change them
      const original = log[editing]?.play;
      play = {
        ...play,
        pitches: original?.pitches ?? null,
        count: original?.count ?? play.count,
        challenge: original?.challenge ?? null,
      };
      applyEdit(editing, { play, slot: pendingSlot }, "Play updated");
      setCurrentPlay(null);
      setWarnings([]);
      setLastTranscript("");
      return;
    }
    const playIndex = log.length;
    const before = gameState;
    const after = applyPlayToState(before, play, innings);
    const slot = pendingSlot;

    // the at bat's pitches go onto the play that ended it, with the count it
    // ended on; a steal or a pickoff leaves the count where it is
    const halfOver = !!after.final || after.half !== before.half || after.inning !== before.inning;
    const pitches = pitchesForPlay(play, pendingPitches, { endsHalf: halfOver, said: reviewBase?.transcript });
    if (pitches.length) {
      const ended = isPlateAppearance(play.action) ? pitches.slice(0, -1) : pitches;
      play = { ...play, pitches, count: pendingPitches.length ? formatCount(countOf(ended)) : play.count ?? null };
    }
    if (isPlateAppearance(play.action) || halfOver) setPendingPitches([]);

    setLog((prev) => [...prev, { play, before, after, slot }]);
    setGameState(after);
    setPendingSlot(null);
    // a hand-marked batter only stands until that team's next plate appearance
    if (slot != null) setMarkedUp((prev) => ({ ...prev, [battingTeam(before.half)]: null }));
    toast.success(
      after.final
        ? `Ballgame. Final: ${shownTeams.away} ${after.score.away}, ${shownTeams.home} ${after.score.home}.`
        : after.inning !== before.inning || after.half !== before.half
          ? `Play confirmed. Side retired, ${inningLabel(after)}.`
          : "Play confirmed!"
    );
    setCurrentPlay(null);
    setWarnings([]);
    setLastTranscript("");

    const game = await ensureGame();
    if ("error" in game) {
      setSaveError(game.error);
      return;
    }

    const saved = await savePlay(game.data, playIndex, play);
    if ("error" in saved) {
      setSaveError(saved.error);
    } else {
      setSavedCount((prev) => prev + 1);
      setSaveError(null);
    }
  };

  const handleReject = () => {
    setCurrentPlay(null);
    setReviewBase(null);
    setResolved([]);
    setWarnings([]);
    setPendingSlot(null);
    toast(editing != null ? "Kept the play as it was. Say it again, or cancel the edit." : "Play rejected. Try recording again.");
  };

  // plays the game again with one play changed or removed, so everything
  // after it (score, outs, bases, innings) follows from the correction
  const applyEdit = async (index: number, change: { play: Play; slot: number | null } | null, message: string) => {
    const result = replayLog(withEdit(log, index, change), innings);
    setLog(result.log);
    setGameState(result.state);
    setProblems(result.problems);
    setEditing(null);
    setReviewBase(null);
    setResolved([]);
    setPendingSlot(null);
    if (result.problems.length) {
      toast.warning(`${message}. ${result.problems.length} later ${result.problems.length === 1 ? "play no longer fits" : "plays no longer fit"}; see the list above the plays.`);
    } else {
      toast.success(`${message}. The score and bases were worked out again.`);
    }

    if (gameId.current) {
      const saved = await replacePlaysFrom(gameId.current, index, result.log.slice(index).map((e) => e.play));
      if ("error" in saved) setSaveError(saved.error);
      else {
        setSavedCount(result.log.length);
        setSaveError(null);
      }
    }
  };

  const handleEdit = (index: number) => {
    setEditing(index);
    setCurrentPlay(null);
    setReviewBase(null);
    setResolved([]);
    setWarnings([]);
    setPendingSlot(null);
    setLastTranscript("");
    toast(`Say or type play #${index + 1} the way it really happened.`);
  };

  // a spray chart dot dragged to where the ball really went: the play keeps
  // the spot, and its location in the log follows. null puts it back
  const handleSprayMove = async (index: number, point: { x: number; y: number } | null) => {
    const entry = log[index];
    if (!entry) return;
    const old = entry.play;
    let play: Play;
    if (point) {
      const where = describeSpot(point);
      const was = old.spray ? old.spray.was ?? null : old.hit_location ?? null;
      play = { ...old, spray: { ...point, was }, hit_location: where, field_zone: zoneFor(where, old.fielders_involved) };
    } else {
      const was = old.spray?.was ?? old.hit_location ?? null;
      play = { ...old, spray: null, hit_location: was, field_zone: zoneFor(was, old.fielders_involved) };
    }
    const next = log.map((e, i) => (i === index ? { ...e, play } : e));
    setLog(next);
    toast(point ? `Play #${index + 1} moved to ${play.hit_location}.` : `Play #${index + 1} is back where the words put it.`);
    if (gameId.current) {
      const saved = await replacePlaysFrom(gameId.current, index, next.slice(index).map((e) => e.play));
      if ("error" in saved) setSaveError(saved.error);
    }
  };

  // a manager's challenge on a play. An overturned call goes straight on to
  // scoring the play again the way the review saw it
  const handleChallenge = async (index: number, challenge: Challenge | null) => {
    const entry = log[index];
    if (!entry) return;
    const newlyOverturned = challenge?.result === "overturned" && entry.play.challenge?.result !== "overturned";
    const next = log.map((e, i) => (i === index ? { ...e, play: { ...e.play, challenge } } : e));
    setLog(next);
    if (newlyOverturned) {
      // the edit says what to do next
      handleEdit(index);
    } else {
      toast(challenge ? `Challenge recorded on play #${index + 1}.` : `Challenge removed from play #${index + 1}.`);
    }
    if (gameId.current) {
      const saved = await replacePlaysFrom(gameId.current, index, next.slice(index).map((e) => e.play));
      if ("error" in saved) setSaveError(saved.error);
    }
  };

  const handleCancelEdit = () => {
    setEditing(null);
    setCurrentPlay(null);
    setReviewBase(null);
    setResolved([]);
    setWarnings([]);
    setPendingSlot(null);
  };

  const handleDelete = (index: number) => applyEdit(index, null, `Removed play #${index + 1}`);

  const handleInnings = (value: number) => {
    setInnings(value);
    // a game that was over may not be, or one in progress may now be over
    const result = replayLog(log, value);
    setLog(result.log);
    setGameState(result.state);
    setProblems(result.problems);
  };

  const handleUndo = async () => {
    const last = log[log.length - 1];
    if (!last) return;
    const playIndex = log.length - 1;
    setLog((prev) => prev.slice(0, -1));
    setGameState(last.before);
    // the at bat it ended is back in progress, unless the next one has begun
    if (pendingPitches.length === 0) setPendingPitches(pitchesToRestore(last.play));
    setProblems((prev) => prev.filter((p) => p.index < playIndex));
    toast(`Undid: ${last.play.description}`);

    // take it out of the database too, so the next play can reuse its slot
    if (gameId.current) {
      const removed = await deletePlay(gameId.current, playIndex);
      if ("error" in removed) setSaveError(removed.error);
      else setSavedCount((prev) => Math.max(0, prev - 1));
    }
  };

  const handleNewGame = () => {
    setGameState(INITIAL_GAME_STATE);
    setLog([]);
    setCurrentPlay(null);
    setWarnings([]);
    setLastTranscript("");
    setStartedAt(new Date().toISOString());
    // drop the old game row so the next play opens a fresh one
    gameRequest.current = null;
    gameId.current = null;
    setSavedCount(0);
    setSaveError(null);
    setLineups(EMPTY_LINEUPS);
    setMarkedUp(NOBODY_MARKED);
    setPitchCounts({});
    setPendingPitches([]);
    setPendingSlot(null);
    setReviewBase(null);
    setResolved([]);
    setEditing(null);
    setProblems([]);
    setInnings(REGULATION_INNINGS);
    toast.success("New game started!");
  };

  // one pitch on the count. ball four or strike three puts the walk or the
  // strikeout up for review, with the pitch that decided it already logged
  const addPitch = (code: PitchCode) => {
    if (gameState.final) return toast("The game is over.");
    if (editing != null) return toast("Finish or cancel the edit first.");
    if (currentPlay) return toast("Confirm or reject the play under review first.");
    const next = [...pendingPitches, code];
    setPendingPitches(next);
    const outcome = decided(next);
    if (!outcome) return;
    const words = outcome === "walk" ? "ball four" : code === "C" ? "strike three looking" : "strike three swinging";
    const play = parseShorthand(outcome === "walk" ? "walk" : code === "C" ? "K looking" : "K swinging", gameState);
    if (play) {
      setLastTranscript(words);
      showPlay(play, { source: "shorthand", ms: 0 }, words);
    }
  };

  const undoPitch = () => {
    if (currentPlay) return toast("Confirm or reject the play under review first.");
    setPendingPitches((prev) => prev.slice(0, -1));
  };

  const handleLineup = (team: Team, lineup: TeamLineup) => setLineups((prev) => ({ ...prev, [team]: lineup }));

  const handleMarkDueUp = (team: Team, slot: number) => {
    setMarkedUp((prev) => ({ ...prev, [team]: slot }));
    const name = currentBatter(lineups[team], slot);
    if (name) toast(`${name} is due up for ${shownTeams[team]}.`);
  };

  const handlePitch = (team: Team, pitcher: string, delta: number) =>
    setPitchCounts((prev) => {
      const key = pitcherKey(team, pitcher);
      return { ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) };
    });

  // Enter confirms the play under review, Escape rejects it, and while a
  // question is open the number keys pick its answers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // B, C, S, F, T log a pitch while nothing is up for review
      const key = e.key.toUpperCase();
      if (!currentPlay && editing == null && PITCH_KEYS.includes(key as PitchCode)) {
        e.preventDefault();
        addPitch(key as PitchCode);
        return;
      }
      if (!currentPlay) return;
      if (question && /^[1-9]$/.test(e.key)) {
        const option = question.options[Number(e.key) - 1];
        if (option) {
          e.preventDefault();
          handlePick(option);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        handleReject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });


  const exportPdf = async () => {
    try {
      const { exportPdf } = await import("@/lib/exportPdf");
      exportPdf(log, gameState, info());
    } catch (e) {
      console.error(e);
      toast.error("Couldn't build the PDF.");
    }
  };

  const setTeam = (team: Team, name: string) => setTeamNames((prev) => ({ ...prev, [team]: name }));
  const info = (): GameInfo => ({ teamNames: shownTeams, date: new Date(startedAt), pitchCounts, innings });

  const panelTab = "data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs";
  const challenges = challengeCounts(confirmedPlays);

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-background lg:overflow-hidden">
      {/* Header: the game's teams and the game-wide actions, on one line */}
      <header className="shrink-0 border-b bg-primary text-primary-foreground">
        <div className="px-3 py-2 lg:px-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 mr-1">
            <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-sm">⚾</div>
            <div className="leading-tight">
              <h1 className="text-base font-bold tracking-tight">Voice Scorekeeper</h1>
              <p className="text-[11px] opacity-75">Atlantic League Baseball</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-sm min-w-0">
            <Input
              aria-label="Away team"
              value={teamNames.away}
              onChange={(e) => setTeam("away", e.target.value)}
              placeholder="Away team"
              className="h-8 w-36 sm:w-40 font-semibold bg-primary-foreground text-foreground"
            />
            <span className="opacity-75">at</span>
            <Input
              aria-label="Home team"
              value={teamNames.home}
              onChange={(e) => setTeam("home", e.target.value)}
              placeholder="Home team"
              className="h-8 w-36 sm:w-40 font-semibold bg-primary-foreground text-foreground"
            />
            <label className="flex items-center gap-1.5 ml-1 opacity-90">
              Innings
              <select
                value={innings}
                onChange={(e) => handleInnings(Number(e.target.value))}
                className="h-8 rounded-md border bg-primary-foreground px-1.5 text-foreground"
                title="Scheduled innings. Seven for the second game of a doubleheader"
              >
                <option value={9}>9</option>
                <option value={7}>7</option>
              </select>
            </label>
          </div>

          <div className="flex-1" />

          {/* whether confirmed plays are reaching the database */}
          {(savedCount > 0 || saveError) && (
            <span
              className={`text-[11px] max-w-[16rem] truncate rounded px-2 py-1 ${saveError ? "bg-destructive text-destructive-foreground" : "opacity-75"}`}
              title={saveError ?? undefined}
            >
              {saveError ? `Not saving: ${saveError}` : `${savedCount} ${savedCount === 1 ? "play" : "plays"} saved`}
            </span>
          )}

          <Button size="sm" variant="secondary" onClick={handleUndo} disabled={log.length === 0 || editing != null} title="Take back the last confirmed play">
            <Undo2 className="w-4 h-4 mr-1" /> Undo
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" disabled={log.length === 0}>
                <Download className="w-4 h-4 mr-1" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export this game</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exportPdf}>
                <FileText className="w-4 h-4 mr-2" /> Game report (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadCsv(`${fileBaseName(info())}-plays.csv`, playByPlayCsv(log, info()))}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Play-by-play (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadCsv(`${fileBaseName(info())}-batting.csv`, battingCsv(log, info()))}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Batting stats (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadCsv(`${fileBaseName(info())}-pitching.csv`, pitchingCsv(log, info()))}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Pitching stats (CSV)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive">
                <RotateCcw className="w-4 h-4 mr-1" /> Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start a new game?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears the scoreboard, both lineups, the pitch counts and all {log.length} confirmed plays from
                  this screen. Export the game first if you want to keep it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep scoring</AlertDialogCancel>
                <AlertDialogAction onClick={handleNewGame}>Start new game</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {/* Everything on one screen on a laptop: scoring on the left, the field
          and the scorecard in the middle, the play-by-play and lineups on the
          right. Each column scrolls on its own if it has to, the page never
          does. Phones stack the columns in the same order */}
      <main className="flex-1 min-h-0 grid grid-cols-1 gap-3 p-3 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[minmax(22rem,1fr)_minmax(0,1.5fr)_minmax(24rem,1.25fr)]">
        {/* ------------------------------------------------ scoring */}
        <section className="min-h-0 flex flex-col gap-3 lg:overflow-y-auto lg:pr-0.5" aria-label="Score a play">
          <Scoreboard
            state={gameState}
            teamNames={shownTeams}
            atBat={atBat}
            pitcher={pitcherNow}
            pitches={pitchesNow?.pitches ?? null}
            count={count}
          />

          {editing != null && editedEntry && (
            <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3 flex items-start gap-2" role="status">
              <Pencil className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <div className="flex-1 text-sm">
                <p className="font-semibold">
                  Editing play #{editing + 1} ({inningLabel(editedEntry.before)}, {describeSituation(editedEntry.before)})
                </p>
                <p className="text-muted-foreground text-xs">
                  Was: {editedEntry.play.description}. Say or type what really happened; every play after it is worked out
                  again when you confirm.
                </p>
              </div>
              <Button size="sm" variant="ghost" className="h-7" onClick={handleCancelEdit}>
                <X className="w-4 h-4 mr-1" /> Cancel
              </Button>
            </div>
          )}

          {gameState.final && editing == null && (
            <div className="rounded-xl border bg-muted p-3 text-sm" role="status">
              <p className="font-semibold">
                Final: {shownTeams.away} {gameState.score.away}, {shownTeams.home} {gameState.score.home}
              </p>
              <p className="text-muted-foreground text-xs">The game is over. Edit or undo a play to change it, or export the game.</p>
            </div>
          )}

          {/* Voice, typing and pitches */}
          <div className="bg-card border rounded-xl p-3 space-y-3">
            <VoiceRecorder onTranscriptReady={handleTranscript} isProcessing={isProcessing} />

            {/* typing is the fallback when the mic or the room won't cooperate */}
            <form onSubmit={handleTyped} className="flex gap-2">
              <div className="relative flex-1">
                <Keyboard className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={question ? 'Answer here: "scored", "third", "held"' : 'Or type a play: "6-3", "Judge doubles to left"'}
                  className="pl-9"
                  aria-label="Type a play"
                  disabled={isProcessing}
                />
              </div>
              <Button type="submit" variant="outline" disabled={!typed.trim() || isProcessing}>
                Score
              </Button>
            </form>

            {/* pitch by pitch: every pitch of the at bat goes on the count, and
                onto the play that ends it. Out of the way while a play is up
                for review */}
            {!currentPlay && (
              <div className="space-y-1.5" aria-label="Pitches">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Count <span className="font-semibold text-foreground tabular-nums">{formatCount(count)}</span>
                    {pendingPitches.length > 0 && (
                      <span className="ml-2 font-mono tracking-wider" title={pendingPitches.map((p) => PITCH_LABELS[p]).join(", ")}>
                        {pendingPitches.join(" ")}
                      </span>
                    )}
                  </span>
                  {pendingPitches.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={undoPitch}>
                      <Undo2 className="w-3.5 h-3.5 mr-1" /> Undo pitch
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {PITCH_KEYS.map((code) => (
                    <Button
                      key={code}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto py-1.5 px-1 flex-col gap-0 text-xs whitespace-normal leading-tight"
                      onClick={() => addPitch(code)}
                      disabled={editing != null || !!gameState.final || isProcessing}
                      title={`${PITCH_LABELS[code]} (key ${code}). Or say it: "ball", "strike looking", "foul"`}
                    >
                      <span>{PITCH_LABELS[code]}</span>
                      <kbd className="text-[10px] font-mono text-muted-foreground">{code}</kbd>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Transcript shown while processing */}
          {isProcessing && lastTranscript && (
            <div className="bg-muted rounded-lg px-3 py-2 text-sm animate-pulse">
              <span className="text-xs uppercase tracking-wider text-muted-foreground mr-2">Processing</span>"{lastTranscript}"
            </div>
          )}

          {/* Current play for review */}
          {currentPlay && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Review this play</h2>
                {parseInfo && (
                  <span className="text-xs text-muted-foreground">
                    {parseInfo.source === "shorthand" ? "Shorthand" : "AI"} · {(parseInfo.ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {lastTranscript && <p className="text-xs text-muted-foreground mb-2">Heard: "{lastTranscript}"</p>}
              {warnings.length > 0 && (
                <ul className="mb-2 rounded-lg bg-warning/15 text-foreground text-sm px-3 py-2 space-y-1 list-disc list-inside">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {question && (
                <div className="mb-2">
                  <ClarifyPanel
                    key={question.id}
                    question={question}
                    remaining={questions.length}
                    answered={resolved.length - (reviewBase?.resolved.length ?? 0)}
                    onPick={handlePick}
                    onText={(text) => handleAnswerText(text)}
                    onSkip={handleSkip}
                    onStartOver={handleStartOver}
                  />
                </div>
              )}
              <PlayCard play={currentPlay} onConfirm={handleConfirm} onReject={handleReject} confirmDisabled={mustAnswer} />
              <p className="text-xs text-muted-foreground mt-1.5 text-center">
                {mustAnswer ? "Answer above to confirm · Esc to reject" : "Enter to confirm · Esc to reject"}
              </p>
            </div>
          )}
        </section>

        {/* ------------------------------------------------ the field */}
        <section className="min-h-0 flex flex-col gap-3" aria-label="The game">
          <LineScore log={log} state={gameState} teamNames={shownTeams} innings={innings} />

          <Tabs value={fieldTab} onValueChange={(v) => setFieldTab(v as "spray" | "scorecard")} className="flex-1 min-h-0 flex flex-col bg-card border rounded-xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <TabsList className="h-8">
                <TabsTrigger value="spray" className={panelTab}>
                  Spray chart
                </TabsTrigger>
                <TabsTrigger value="scorecard" className={panelTab}>
                  Scorecard
                </TabsTrigger>
              </TabsList>
              {fieldTab === "scorecard" && (
                <div className="flex rounded-md border overflow-hidden text-xs" role="group" aria-label="Scorecard for">
                  {(["away", "home"] as Team[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setCardTeam(t)}
                      className={`px-2.5 py-1 max-w-[9rem] truncate ${cardTeam === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      aria-pressed={cardTeam === t}
                    >
                      {shownTeams[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <TabsContent value="spray" className="mt-0 flex-1 min-h-0 overflow-y-auto data-[state=inactive]:hidden">
              <SprayChart
                plays={confirmedPlays}
                teamNames={shownTeams}
                batting={batting}
                highlight={hoveredPlay}
                runners={gameState.final ? undefined : gameState.runners}
                onMove={handleSprayMove}
                className="max-w-xl lg:max-h-[calc(100vh-20rem)]"
                bare
              />
            </TabsContent>
            <TabsContent value="scorecard" className="mt-0 flex-1 min-h-0 overflow-auto data-[state=inactive]:hidden">
              <Scorecard
                log={log}
                state={gameState}
                team={cardTeam}
                innings={innings}
                highlight={hoveredPlay}
                onHighlight={setHoveredPlay}
                dueUp={dueUp[cardTeam]}
              />
            </TabsContent>
          </Tabs>
        </section>

        {/* ------------------------------------------------ the game so far */}
        <section className="min-h-0 flex flex-col lg:col-span-2 xl:col-span-1" aria-label="Game so far">
          <Tabs value={logTab} onValueChange={(v) => setLogTab(v as "plays" | "lineups")} className="flex-1 min-h-0 flex flex-col bg-card border rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <TabsList className="h-8">
                <TabsTrigger value="plays" className={panelTab}>
                  Play-by-play ({log.length})
                </TabsTrigger>
                <TabsTrigger value="lineups" className={panelTab}>
                  Lineups
                </TabsTrigger>
              </TabsList>
              {logTab === "plays" && log.length > 0 && (
                <Button size="sm" variant="ghost" onClick={handleUndo} disabled={editing != null} className="h-7 text-xs">
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove last
                </Button>
              )}
            </div>

            <TabsContent value="plays" className="mt-0 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
              {(challenges.away.used > 0 || challenges.home.used > 0) && (
                <p className="text-xs text-muted-foreground mb-2">
                  Challenges: {(["away", "home"] as Team[])
                    .map((t) => `${shownTeams[t]} ${challenges[t].used} (${challenges[t].overturned} overturned)`)
                    .join(" · ")}
                </p>
              )}
              {problems.length > 0 && (
                <div className="mb-2 rounded-lg bg-warning/15 px-3 py-2 text-sm space-y-1">
                  <p className="font-semibold">After the change, these plays don't add up:</p>
                  <ul className="space-y-1">
                    {problems.map((p) => (
                      <li key={`${p.index}:${p.message}`} className="flex items-start justify-between gap-2">
                        <span>{p.message}</span>
                        <Button size="sm" variant="ghost" className="h-6 text-xs shrink-0" onClick={() => handleEdit(p.index)}>
                          Fix
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {log.length === 0 ? (
                <p className="text-sm text-muted-foreground">No plays yet.</p>
              ) : (
                <div className="space-y-1.5 flex-1 min-h-0 max-h-[32rem] lg:max-h-none overflow-y-auto pr-1">
                  {[...log].reverse().map(({ play, before, after }, i) => {
                    const index = log.length - 1 - i;
                    const team = battingTeam(before.half);
                    const runs = after.score[team] - before.score[team];
                    return (
                      <div
                        key={index}
                        onMouseEnter={() => setHoveredPlay(index)}
                        onMouseLeave={() => setHoveredPlay((h) => (h === index ? null : h))}
                        className={`group rounded-lg px-2.5 py-2 text-sm flex items-start gap-2 ${
                          editing === index ? "bg-primary/10 ring-2 ring-primary/40" : hoveredPlay === index ? "bg-amber-100" : "bg-muted"
                        }`}
                      >
                        <span className="shrink-0 w-9 text-xs text-muted-foreground tabular-nums leading-tight pt-0.5">
                          <span className="block">#{index + 1}</span>
                          {inningLabel(before)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] bg-primary text-primary-foreground rounded px-1.5 py-0.5 uppercase font-bold">{play.action}</span>
                            {runs > 0 && (
                              <span className="text-xs text-accent font-bold">
                                +{runs} {runs === 1 ? "run" : "runs"}
                              </span>
                            )}
                          </span>
                          <span className="block text-foreground leading-snug mt-0.5">
                            {play.description}
                            {play.hit_type && play.hit_location && (
                              <span className="text-muted-foreground text-xs ml-1">
                                — {play.hit_type} to {play.hit_location}
                              </span>
                            )}
                          </span>
                          {play.pitches && play.pitches.length > 0 && (
                            <span className="block text-xs text-muted-foreground font-mono tracking-wider" title="Pitches, in order">
                              {play.count ? `${play.count} · ` : ""}
                              {play.pitches.join(" ")}
                            </span>
                          )}
                          {play.challenge && (
                            <span
                              className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                play.challenge.result === "overturned" ? "bg-amber-200 text-amber-900" : "bg-slate-200 text-slate-800"
                              }`}
                            >
                              <Flag className="w-3 h-3" fill="currentColor" />
                              {challengeLabel(play.challenge, shownTeams)}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 flex">
                          <ChallengeDialog
                            index={index}
                            play={play}
                            teamNames={shownTeams}
                            fielding={team === "away" ? "home" : "away"}
                            disabled={isProcessing || (editing != null && editing !== index)}
                            onSave={handleChallenge}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleEdit(index)}
                            disabled={isProcessing}
                            title={`Edit play #${index + 1}`}
                            aria-label={`Edit play #${index + 1}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                disabled={isProcessing || editing != null}
                                title={`Remove play #${index + 1}`}
                                aria-label={`Remove play #${index + 1}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove play #{index + 1}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  "{play.description}" comes out of the game, and the score, outs and bases for every play
                                  after it are worked out again.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Keep it</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(index)}>Remove play</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* kept mounted, so a half-typed lineup survives switching tabs;
                keyed by game so a reset opens both cards for entry again */}
            <TabsContent value="lineups" forceMount className="mt-0 flex-1 min-h-0 overflow-y-auto data-[state=inactive]:hidden">
              <LineupPanel
                bare
                key={startedAt}
                lineups={lineups}
                teamNames={shownTeams}
                batting={batting}
                dueUp={dueUp}
                pitching={pitching}
                pitchCounts={pitchCounts}
                pitchesNow={pitchesNow}
                onChange={handleLineup}
                onMarkDueUp={handleMarkDueUp}
                onPitch={handlePitch}
              />
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
};

export default Index;
