import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

type PieceCode =
  | "wK" | "wQ" | "wR" | "wB" | "wN" | "wP"
  | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";

type Headers = Record<string, string>;

type MoveNode = {
  id: string;
  parentId: string | null;
  san: string;
  color: "w" | "b";
  moveNumber: number;
  fen: string;
  comment: string;
  children: string[];
};

type Game = {
  id: string;
  headers: Headers;
  rootFen: string;
  nodes: Record<string, MoveNode>;
  rootChildren: string[];
};

type CastlingRights = {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
};

type EnPassantSide = "white" | "black" | null;
type Turn = "w" | "b" | null;

type EngineLine = {
  multipv: number;
  depth: number;
  evaluation: string;
  moves: string;
  uciMoves: string;
};

const START_FEN = new Chess().fen();
const EMPTY_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";
const STOCKFISH_PATH = "/stockfish-19-lite-single.js";

const DEFAULT_CASTLING: CastlingRights = {
  K: true,
  Q: true,
  k: true,
  q: true,
};

const uid = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const PIECES: {
  code: PieceCode;
  symbol: string;
  name: string;
}[] = [
  { code: "wK", symbol: "♔", name: "White King" },
  { code: "wQ", symbol: "♕", name: "White Queen" },
  { code: "wR", symbol: "♖", name: "White Rook" },
  { code: "wB", symbol: "♗", name: "White Bishop" },
  { code: "wN", symbol: "♘", name: "White Knight" },
  { code: "wP", symbol: "♙", name: "White Pawn" },
  { code: "bK", symbol: "♚", name: "Black King" },
  { code: "bQ", symbol: "♛", name: "Black Queen" },
  { code: "bR", symbol: "♜", name: "Black Rook" },
  { code: "bB", symbol: "♝", name: "Black Bishop" },
  { code: "bN", symbol: "♞", name: "Black Knight" },
  { code: "bP", symbol: "♟", name: "Black Pawn" },
];

function fenToBoardMap(
  fen: string,
): Record<string, PieceCode> {
  const board: Record<string, PieceCode> = {};
  const placement = fen.trim().split(/\s+/)[0];
  const ranks = placement.split("/");

  if (ranks.length !== 8) return board;

  for (let row = 0; row < 8; row++) {
    let file = 0;
    const rank = 8 - row;

    for (const char of ranks[row]) {
      if (/[1-8]/.test(char)) {
        file += Number(char);
        continue;
      }

      const color =
        char === char.toUpperCase() ? "w" : "b";
      const type = char.toUpperCase();

      if (
        file >= 0 &&
        file < 8 &&
        "KQRBNP".includes(type)
      ) {
        const square =
          `${String.fromCharCode(97 + file)}${rank}`;

        board[square] = `${color}${type}` as PieceCode;
      }

      file++;
    }
  }

  return board;
}

function boardMapToFen(
  board: Record<string, PieceCode>,
  previousFen: string,
): string {
  const fields = previousFen.trim().split(/\s+/);
  const rows: string[] = [];

  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let emptyCount = 0;

    for (let file = 0; file < 8; file++) {
      const square =
        `${String.fromCharCode(97 + file)}${rank}`;
      const piece = board[square];

      if (!piece) {
        emptyCount++;
        continue;
      }

      if (emptyCount > 0) {
        row += String(emptyCount);
        emptyCount = 0;
      }

      row += piece[0] === "w"
        ? piece[1].toUpperCase()
        : piece[1].toLowerCase();
    }

    if (emptyCount > 0) row += String(emptyCount);
    rows.push(row);
  }

  return [
    rows.join("/"),
    fields[1] || "w",
    fields[2] || "-",
    fields[3] || "-",
    fields[4] || "0",
    fields[5] || "1",
  ].join(" ");
}

/*
 * تعیین خانه هدف En Passant بر اساس محل پیاده‌ای
 * که دو خانه حرکت کرده است.
 */
function getEnPassantTarget(
  fen: string,
  side: EnPassantSide,
): string {
  if (!side) return "-";

  const board = fenToBoardMap(fen);
  const pawnColor = side === "white" ? "b" : "w";
  const pawnRank = side === "white" ? 5 : 4;
  const targetRank = side === "white" ? 6 : 3;
  const capturingColor = side === "white" ? "w" : "b";
  const candidates: string[] = [];

  for (let file = 0; file < 8; file++) {
    const fileName = String.fromCharCode(97 + file);
    const pawnSquare = `${fileName}${pawnRank}`;

    if (board[pawnSquare] !== `${pawnColor}P`) continue;

    const hasCapturingPawn =
      (file > 0 &&
        board[
          `${String.fromCharCode(96 + file)}${pawnRank}`
        ] === `${capturingColor}P`) ||
      (file < 7 &&
        board[
          `${String.fromCharCode(98 + file)}${pawnRank}`
        ] === `${capturingColor}P`);

    if (hasCapturingPawn) {
      return `${fileName}${targetRank}`;
    }

    candidates.push(fileName);
  }

  return candidates.length
    ? `${candidates[0]}${targetRank}`
    : "-";
}

function applyGameStateToFen(
  fen: string,
  castling: CastlingRights,
  enPassant: EnPassantSide,
  turn: "w" | "b",
): string {
  const fields = fen.trim().split(/\s+/);

  const castlingString = (
    ["K", "Q", "k", "q"] as const
  )
    .filter((right) => castling[right])
    .join("") || "-";

  const validEnPassantSide =
    enPassant === "white" && turn === "w"
      ? "white"
      : enPassant === "black" && turn === "b"
        ? "black"
        : null;

  const enPassantSquare = getEnPassantTarget(
    fen,
    validEnPassantSide,
  );

  return [
    fields[0] || "8/8/8/8/8/8/8/8",
    turn,
    castlingString,
    enPassantSquare,
    fields[4] || "0",
    fields[5] || "1",
  ].join(" ");
}

function preserveFen(fen: string): string {
  try {
    new Chess(fen);
    return fen;
  } catch {
    return fen;
  }
}

function createGame(
  rootFen = START_FEN,
  headers: Headers = {},
): Game {
  return {
    id: uid(),
    headers,
    rootFen: preserveFen(rootFen),
    nodes: {},
    rootChildren: [],
  };
}

function splitPgnGames(pgn: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];

  for (
    const line of pgn
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/)
  ) {
    if (
      /^\s*\[Event\s+"/i.test(line) &&
      current.some((x) => x.trim())
    ) {
      chunks.push(current.join("\n"));
      current = [];
    }

    current.push(line);
  }

  if (current.some((x) => x.trim())) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}

function parseGame(pgn: string): Game {
  const headers: Headers = {};

  const body = pgn.replace(
    /^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"])*)"\s*\]\s*$/gm,
    (_match, key: string, value: string) => {
      headers[key] = value
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");

      return "";
    },
  );

  const game = createGame(
    headers.SetUp === "1" && headers.FEN
      ? headers.FEN
      : START_FEN,
    headers,
  );

  let fen = game.rootFen;
  let parent: string | null = null;

  let last: {
    beforeFen: string;
    beforeParent: string | null;
    nodeId: string;
  } | null = null;

  const stack: Array<{
    fen: string;
    parent: string | null;
    last: typeof last;
  }> = [];

  const tokens =
    body.match(/\{[^}]*\}|;[^\r\n]*|\(|\)|\$[0-9]+|[^\s(){}]+/g) || [];

  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;

    if (token.startsWith("{") || token.startsWith(";")) {
      const comment = (
        token.startsWith("{")
          ? token.slice(1, -1)
          : token.slice(1)
      ).trim();

      if (comment && last) {
        const node = game.nodes[last.nodeId];

        if (node) {
          node.comment = node.comment
            ? `${node.comment}\n${comment}`
            : comment;
        }
      }

      continue;
    }

    if (token === "(") {
      if (last) {
        stack.push({ fen, parent, last });
        fen = last.beforeFen;
        parent = last.beforeParent;
        last = null;
      }

      continue;
    }

    if (token === ")") {
      const saved = stack.pop();

      if (saved) {
        fen = saved.fen;
        parent = saved.parent;
        last = saved.last;
      }

      continue;
    }

    if (
      /^\$\d+$/.test(token) ||
      /^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)
    ) {
      continue;
    }

    const san = token
      .replace(/^\d+\.(?:\.\.)?/, "")
      .replace(/[!?]+$/g, "");

    if (
      !san ||
      /^\.+$/.test(san) ||
      /^\d+\.(?:\.\.)?$/.test(token)
    ) {
      continue;
    }

    try {
      const chess = new Chess(fen);
      const moveColor = chess.turn();
      const moveNumber = chess.moveNumber();
      const move = chess.move(san, { strict: false });

      if (!move || !move.san) continue;

      const id = uid();

      const node: MoveNode = {
        id,
        parentId: parent,
        san: move.san,
        color: moveColor,
        moveNumber,
        fen: chess.fen(),
        comment: "",
        children: [],
      };

      game.nodes[id] = node;

      if (parent) {
        game.nodes[parent].children.push(id);
      } else {
        game.rootChildren.push(id);
      }

      last = {
        beforeFen: fen,
        beforeParent: parent,
        nodeId: id,
      };

      fen = chess.fen();
      parent = id;
    } catch {
      // توکن نامعتبر نادیده گرفته می‌شود.
    }
  }

  return game;
}

function pathTo(
  game: Game | null,
  id: string | null,
): MoveNode[] {
  if (!game || !id) return [];

  const out: MoveNode[] = [];
  let node: MoveNode | undefined = game.nodes[id];

  while (node) {
    out.unshift(node);
    node = node.parentId
      ? game.nodes[node.parentId]
      : undefined;
  }

  return out;
}

type NotationMode = "mainline" | "variationStart";

function formatMoveNotation(
  node: MoveNode | undefined,
  mode: NotationMode = "mainline",
): string {
  if (!node) return "";

  const san =
    typeof node.san === "string"
      ? node.san.trim()
      : "";

  if (
    !san ||
    san.toLowerCase() === "undefined" ||
    san.toLowerCase() === "null"
  ) {
    return "";
  }

  const moveNumber = Number(node.moveNumber);

  if (!Number.isFinite(moveNumber) || moveNumber < 1) {
    return san;
  }

  if (mode === "variationStart") {
    return node.color === "b"
      ? `${moveNumber}... ${san}`
      : `${moveNumber}. ${san}`;
  }

  return node.color === "w"
    ? `${moveNumber}. ${san}`
    : san;
}

function getLinePreview(
  game: Game,
  startId: string,
  mode: NotationMode = "mainline",
): string {
  const moves: string[] = [];
  let currentId: string | null = startId;
  let isFirstMove = true;

  while (currentId) {
    const node = game.nodes[currentId];
    if (!node) break;

    moves.push(
      formatMoveNotation(
        node,
        isFirstMove ? mode : "mainline",
      ),
    );

    isFirstMove = false;
    currentId = node.children[0] || null;
  }

  return moves.join(" ");
}

function getOrderedMoveIds(game: Game | null): string[] {
  if (!game) return [];

  const result: string[] = [];

  const visit = (id: string) => {
    const node = game.nodes[id];
    if (!node) return;

    result.push(id);
    const children = node.children || [];

    children.slice(1).forEach(visit);

    if (children[0]) visit(children[0]);
  };

  const roots = game.rootChildren || [];

  if (roots[0]) visit(roots[0]);
  roots.slice(1).forEach(visit);

  return result;
}

/*
 * تبدیل ارزیابی UCI به دیدگاه سفید.
 */
function formatEngineEvaluation(
  scoreType: string,
  scoreValue: number,
  sideToMove: string,
): string {
  const whitePerspective =
    sideToMove === "b" ? -scoreValue : scoreValue;

  if (scoreType === "mate") {
    return whitePerspective > 0
      ? `+M${Math.abs(whitePerspective)}`
      : whitePerspective < 0
        ? `-M${Math.abs(whitePerspective)}`
        : "M0";
  }

  const pawns = whitePerspective / 100;

  if (pawns > 0) return `+${pawns.toFixed(2)}`;
  if (pawns < 0) return pawns.toFixed(2);

  return "0.00";
}

/*
 * تبدیل دنباله حرکات UCI به SAN.
 */
function uciLineToSan(
  uciMoves: string,
  positionFen: string,
): string {
  if (!uciMoves.trim()) return "—";

  try {
    const chess = new Chess(positionFen);
    const sanMoves: string[] = [];

    for (const uci of uciMoves.trim().split(/\s+/)) {
      if (
        !uci ||
        uci === "0000" ||
        uci === "(none)"
      ) {
        break;
      }

      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci.length > 4
          ? { promotion: uci[4].toLowerCase() }
          : {}),
      });

      if (!move) break;
      sanMoves.push(move.san);
    }

    return sanMoves.join(" ") || "—";
  } catch {
    return uciMoves;
  }
}

export default function App() {
  const [games, setGames] = useState<Game[]>(() => [
    createGame(),
  ]);

  const [activeGameId, setActiveGameId] =
    useState<string | null>(null);

  const [currentNodeId, setCurrentNodeId] =
    useState<string | null>(null);

  const [highlightedNodeId, setHighlightedNodeId] =
    useState<string | null>(null);

  const [fen, setFen] = useState(START_FEN);
  const [fileName, setFileName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [fullBoard, setFullBoard] = useState(false);

  const [selectedPiece, setSelectedPiece] =
    useState<PieceCode | null>(null);

  const [branchChoices, setBranchChoices] =
    useState<string[] | null>(null);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showGameList, setShowGameList] = useState(false);

  const [castlingRights, setCastlingRights] =
    useState<CastlingRights>(DEFAULT_CASTLING);

  const [enPassantSide, setEnPassantSide] =
    useState<EnPassantSide>(null);

  const [editTurn, setEditTurn] = useState<Turn>(null);

  // وضعیت موتور Stockfish
  const [engineOpen, setEngineOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [multiPV, setMultiPV] = useState<number>(1);
  const [engineLines, setEngineLines] = useState<EngineLine[]>([]);
  const [engineMessage, setEngineMessage] = useState("Ready");
  const [mobileTab, setMobileTab] = useState<"note" | "engine">("note");

  const workerRef = useRef<Worker | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const notePanelRef = useRef<HTMLDivElement>(null);

  const moveRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});

  const activeGame =
    games.find((g) => g.id === activeGameId) ||
    games[0] ||
    null;

  const path = useMemo(
    () => pathTo(activeGame, currentNodeId),
    [activeGame, currentNodeId],
  );

  const continuations = activeGame
    ? currentNodeId
      ? activeGame.nodes[currentNodeId]?.children || []
      : activeGame.rootChildren
    : [];

  /*
   * دریافت یک خط info از Stockfish.
   * خروجی هر multipv مستقل نگهداری می‌شود.
   */
  const handleEngineInfo = (
    line: string,
    positionFen: string,
  ) => {
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const multiPVMatch = line.match(/\bmultipv\s+(\d+)/);
    const scoreMatch = line.match(
      /\bscore\s+(cp|mate)\s+(-?\d+)/,
    );

    if (!depthMatch || !scoreMatch) return;

    const depth = Number(depthMatch[1]);
    const rank = multiPVMatch
      ? Number(multiPVMatch[1])
      : 1;

    if (
      !Number.isFinite(depth) ||
      !Number.isFinite(rank) ||
      rank < 1 ||
      rank > 5
    ) {
      return;
    }

    const scoreType = scoreMatch[1];
    const scoreValue = Number(scoreMatch[2]);

    const sideToMove =
      positionFen.trim().split(/\s+/)[1] || "w";

    const evaluation = formatEngineEvaluation(
      scoreType,
      scoreValue,
      sideToMove,
    );

    const pvMatch = line.match(/\bpv\s+(.+)$/);
    const uciMoves = pvMatch ? pvMatch[1].trim() : "";

    const moves = uciLineToSan(
      uciMoves,
      positionFen,
    );

    setEngineLines((previous) => {
      const updated = [...previous];
      const existingIndex = updated.findIndex(
        (item) => item.multipv === rank,
      );

      const nextLine: EngineLine = {
        multipv: rank,
        depth,
        evaluation,
        moves,
        uciMoves,
      };

      if (existingIndex >= 0) {
        if (depth < updated[existingIndex].depth) {
          return previous;
        }

        updated[existingIndex] = nextLine;
      } else {
        updated.push(nextLine);
      }

      return updated
        .sort((a, b) => a.multipv - b.multipv)
        .slice(0, 5);
    });
  };

  /*
   * مدیریت خودکار موتور Stockfish.
   *
   * با باز شدن پنل:
   * 1. ساخت Worker
   * 2. ارسال uci
   * 3. تنظیم MultiPV
   * 4. ارسال position fen
   * 5. شروع تحلیل با go infinite
   *
   * با تغییر FEN یا MultiPV:
   * Worker قبلی متوقف و Worker جدید ساخته می‌شود.
   *
   * با بسته شدن پنل یا ورود به Edit Board:
   * تحلیل متوقف و Worker آزاد می‌شود.
   */
  useEffect(() => {
    if (!engineOpen || isEditing) {
      setIsAnalyzing(false);
      setIsStopping(false);
      return;
    }

    const fenToAnalyze = fen;

    try {
      new Chess(fenToAnalyze);
    } catch {
      setEngineLines([]);
      setIsAnalyzing(false);
      setIsStopping(false);
      setEngineMessage("Invalid FEN position");
      return;
    }

    setEngineLines([]);
    setIsAnalyzing(true);
    setIsStopping(false);
    setEngineMessage("Loading Stockfish...");

    let worker: Worker;

    try {
      worker = new Worker(STOCKFISH_PATH);
      workerRef.current = worker;

      const isCurrentWorker = () =>
        workerRef.current === worker;

      worker.onmessage = (event: MessageEvent) => {
        if (!isCurrentWorker()) return;

        const line = String(event.data ?? "").trim();

        if (!line) return;

        if (line === "uciok") {
          worker.postMessage(
            `setoption name MultiPV value ${multiPV}`,
          );

          worker.postMessage("isready");
          return;
        }

        if (line === "readyok") {
          if (!isCurrentWorker()) return;

          worker.postMessage(
            `position fen ${fenToAnalyze}`,
          );

          worker.postMessage("go infinite");

          setEngineMessage("Analyzing...");
          return;
        }

        if (line.startsWith("info ")) {
          handleEngineInfo(line, fenToAnalyze);
          return;
        }

        if (line.startsWith("bestmove ")) {
          setIsAnalyzing(false);
          setIsStopping(false);
          setEngineMessage("Analysis stopped");
          return;
        }

        if (line.startsWith("Unknown command")) {
          console.error("Stockfish:", line);
          setEngineMessage("Engine command error");
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        if (!isCurrentWorker()) return;

        console.error("Stockfish Worker error:", event);

        setIsAnalyzing(false);
        setIsStopping(false);
        setEngineMessage(
          "Engine loading error. Check Stockfish files.",
        );

        worker.terminate();

        if (workerRef.current === worker) {
          workerRef.current = null;
        }
      };

      worker.postMessage("uci");
    } catch (error) {
      console.error("Unable to create Stockfish Worker:", error);

      setIsAnalyzing(false);
      setIsStopping(false);
      setEngineMessage(
        "Unable to load Stockfish. Check the JS file path.",
      );

      return;
    }

    /*
     * Cleanup:
     * هنگام تغییر موقعیت، تغییر MultiPV یا بسته شدن پنل،
     * ابتدا فرمان stop و سپس quit ارسال می‌شود.
     *
     * terminate باعث می‌شود Worker قبلی دیگر نتواند
     * خروجی‌هایش را وارد وضعیت جدید برنامه کند.
     */
    return () => {
      if (workerRef.current === worker) {
        workerRef.current = null;
      }

      try {
        worker.postMessage("stop");
        worker.postMessage("quit");
      } catch {
        // Worker ممکن است قبلاً متوقف شده باشد.
      }

      worker.terminate();
    };
  }, [engineOpen, fen, multiPV, isEditing]);

  /*
   * آزادسازی Worker هنگام خروج کامل از برنامه.
   */
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        try {
          workerRef.current.postMessage("stop");
          workerRef.current.postMessage("quit");
        } catch {
          // Worker ممکن است قبلاً متوقف شده باشد.
        }

        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const toggleEngine = () => {
    if (engineOpen) {
      setEngineOpen(false);
      setIsAnalyzing(false);
      setIsStopping(false);
      setEngineMessage("Engine stopped");
    } else {
      setEngineOpen(true);
    }
  };

  const chooseGame = (game: Game) => {
    setActiveGameId(game.id);
    setCurrentNodeId(null);
    setHighlightedNodeId(null);
    setFen(game.rootFen);
    setBranchChoices(null);
    setSelectedIndex(0);
    setShowGameList(false);
  };

  const goToNode = (id: string | null) => {
    if (!activeGame) return;

    setCurrentNodeId(id);
    setHighlightedNodeId(id);

    setFen(
      id
        ? activeGame.nodes[id].fen
        : activeGame.rootFen,
    );

    setBranchChoices(null);
  };

  const resetAll = () => {
    const fresh = createGame();

    setGames([fresh]);
    setActiveGameId(fresh.id);
    setCurrentNodeId(null);
    setHighlightedNodeId(null);
    setFen(fresh.rootFen);
    setFileName("");
    setIsEditing(false);
    setSelectedPiece(null);
    setBranchChoices(null);
    setSelectedIndex(0);
    setShowGameList(false);

    setEngineOpen(false);
    setIsAnalyzing(false);
    setIsStopping(false);
    setEngineLines([]);
    setEngineMessage("Ready");

    setCastlingRights(DEFAULT_CASTLING);
    setEnPassantSide(null);
    setEditTurn(null);
  };

  const advance = () => {
    if (continuations.length === 1) {
      goToNode(continuations[0]);
    } else if (continuations.length > 1) {
      setSelectedIndex(0);
      setBranchChoices([...continuations]);
    }
  };

  const previous = () => {
    if (currentNodeId && activeGame) {
      goToNode(activeGame.nodes[currentNodeId].parentId);
    }
  };

  /*
   * اسکرول خودکار در صورت کلیک روی یک حرکت
   * در پنل Note حفظ شده است.
   */
  useEffect(() => {
    if (!highlightedNodeId) return;

    const panel = notePanelRef.current;
    const moveElement = moveRefs.current[highlightedNodeId];

    if (!panel || !moveElement) return;

    const panelRect = panel.getBoundingClientRect();
    const moveRect = moveElement.getBoundingClientRect();

    if (moveRect.top < panelRect.top) {
      panel.scrollBy({
        top: moveRect.top - panelRect.top - 12,
        behavior: "smooth",
      });
    } else if (moveRect.bottom > panelRect.bottom) {
      panel.scrollBy({
        top: moveRect.bottom - panelRect.bottom + 12,
        behavior: "smooth",
      });
    }
  }, [highlightedNodeId, activeGameId]);

  /*
   * کنترل کلیدهای جهت‌دار.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isEditing ||
        showGameList ||
        branchChoices ||
        !activeGame
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target &&
        (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable
        )
      ) {
        return;
      }

      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        const panel = notePanelRef.current;
        if (!panel) return;

        event.preventDefault();

        panel.scrollBy({
          top: event.key === "ArrowUp" ? -27 : 27,
          behavior: "auto",
        });

        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        advance();
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        previous();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isEditing,
    showGameList,
    branchChoices,
    activeGame,
    currentNodeId,
    continuations,
  ]);

  /*
   * کلیدهای پنجره Choose a variation.
   */
  useEffect(() => {
    if (!branchChoices || !activeGame) return;

    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();

        setSelectedIndex((previous) =>
          Math.max(0, previous - 1),
        );
      } else if (event.key === "ArrowDown") {
        event.preventDefault();

        setSelectedIndex((previous) =>
          Math.min(branchChoices.length - 1, previous + 1),
        );
      } else if (event.key === "ArrowRight") {
        event.preventDefault();

        const selectedId = branchChoices[selectedIndex];

        if (selectedId) goToNode(selectedId);
      }
    };

    window.addEventListener("keydown", handleModalKeyDown);

    return () => {
      window.removeEventListener(
        "keydown",
        handleModalKeyDown,
      );
    };
  }, [branchChoices, activeGame, selectedIndex]);

  const handleFileUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const raw = e.target?.result;

        if (typeof raw !== "string" || !raw.trim()) {
          throw new Error("Empty PGN");
        }

        const parsed = splitPgnGames(raw).map(parseGame);

        if (!parsed.length) {
          throw new Error("No games found");
        }

        setGames(parsed);
        setFileName(file.name);
        setIsEditing(false);
        setSelectedPiece(null);
        setBranchChoices(null);
        setSelectedIndex(0);
        setHighlightedNodeId(null);

        if (parsed.length > 1) {
          setActiveGameId(null);
          setCurrentNodeId(null);
          setFen(START_FEN);
          setShowGameList(true);
        } else {
          chooseGame(parsed[0]);
        }
      } catch (err) {
        console.error(err);

        alert(
          "Unable to read this PGN file. Check that it contains valid PGN games.",
        );
      }
    };

    reader.onerror = () => {
      alert("Unable to read the selected file.");
    };

    reader.readAsText(file);
  };

  const addManualMove = (
    from: string,
    to: string,
  ): boolean => {
    if (!activeGame || isEditing) return false;

    try {
      const chess = new Chess(fen);
      const moveColor = chess.turn();
      const moveNumber = chess.moveNumber();

      const move = chess.move({
        from,
        to,
        promotion: "q",
      });

      if (!move) return false;

      const nextFen = chess.fen();
      const existing = [...continuations];

      const match = existing.find(
        (id) => activeGame.nodes[id].fen === nextFen,
      );

      if (match) {
        goToNode(match);
        return true;
      }

      const id = uid();

      const node: MoveNode = {
        id,
        parentId: currentNodeId,
        san: move.san,
        color: moveColor,
        moveNumber,
        fen: nextFen,
        comment: "",
        children: [],
      };

      setGames((old) =>
        old.map((g) => {
          if (g.id !== activeGame.id) return g;

          const updated: Game = {
            ...g,
            nodes: {
              ...g.nodes,
              [id]: node,
            },
            rootChildren: [...g.rootChildren],
          };

          if (currentNodeId) {
            updated.nodes[currentNodeId] = {
              ...updated.nodes[currentNodeId],
              children: [
                ...updated.nodes[currentNodeId].children,
                id,
              ],
            };
          } else {
            updated.rootChildren.push(id);
          }

          return updated;
        }),
      );

      if (existing.length) {
        setSelectedIndex(0);
        setBranchChoices([...existing, id]);
      } else {
        setCurrentNodeId(id);
        setHighlightedNodeId(id);
        setFen(nextFen);
      }

      return true;
    } catch {
      return false;
    }
  };

  const handlePieceDrop = (...args: any[]): boolean => {
    const first = args[0];

    const sourceSquare =
      typeof first === "string"
        ? first
        : first?.sourceSquare;

    const targetSquare =
      typeof first === "string"
        ? args[1]
        : first?.targetSquare;

    if (
      typeof sourceSquare !== "string" ||
      typeof targetSquare !== "string"
    ) {
      return false;
    }

    return addManualMove(sourceSquare, targetSquare);
  };

  /*
   * ویرایش صفحه:
   * کلیک روی مهره = حذف مهره
   * کلیک روی خانه خالی با مهره انتخاب‌شده = قرار دادن مهره
   */
  const handleSquareClick = (...args: any[]) => {
    if (!isEditing) return;

    const first = args[0];

    const square =
      typeof first === "string"
        ? first
        : first?.square;

    if (typeof square !== "string") return;

    setFen((oldFen) => {
      const board = fenToBoardMap(oldFen);

      if (board[square]) {
        delete board[square];
        return boardMapToFen(board, oldFen);
      }

      if (selectedPiece) {
        board[square] = selectedPiece;
        return boardMapToFen(board, oldFen);
      }

      return oldFen;
    });
  };

  /*
   * ورود به Edit Board.
   */
  const startEditing = () => {
    // در صورت باز بودن پنل موتور، آن را می‌بندیم.
    setEngineOpen(false);
    setIsAnalyzing(false);
    setIsStopping(false);

    const fields = fen.trim().split(/\s+/);
    const currentCastling = fields[2] || "-";
    const currentEnPassant = fields[3] || "-";

    const initialCastling: CastlingRights =
      currentCastling === "-"
        ? { ...DEFAULT_CASTLING }
        : {
            K: currentCastling.includes("K"),
            Q: currentCastling.includes("Q"),
            k: currentCastling.includes("k"),
            q: currentCastling.includes("q"),
          };

    let initialEnPassant: EnPassantSide = null;

    if (currentEnPassant !== "-") {
      initialEnPassant =
        currentEnPassant.endsWith("6")
          ? "white"
          : currentEnPassant.endsWith("3")
            ? "black"
            : null;
    }

    setCastlingRights(initialCastling);
    setEnPassantSide(initialEnPassant);
    setEditTurn(null);
    setSelectedPiece(null);
    setIsEditing(true);

    setFen(
      applyGameStateToFen(
        fen,
        initialCastling,
        initialEnPassant,
        fields[1] === "b" ? "b" : "w",
      ),
    );
  };

  const updateCastlingRight = (
    right: keyof CastlingRights,
    checked: boolean,
  ) => {
    const nextRights = {
      ...castlingRights,
      [right]: checked,
    };

    setCastlingRights(nextRights);

    const currentTurn =
      editTurn ||
      (fen.trim().split(/\s+/)[1] === "b" ? "b" : "w");

    setFen((oldFen) =>
      applyGameStateToFen(
        oldFen,
        nextRights,
        enPassantSide,
        currentTurn,
      ),
    );
  };

  const updateEnPassant = (
    side: Exclude<EnPassantSide, null>,
    checked: boolean,
  ) => {
    const nextSide: EnPassantSide = checked
      ? side
      : null;

    setEnPassantSide(nextSide);

    const nextTurn: "w" | "b" =
      checked
        ? side === "white" ? "w" : "b"
        : editTurn ||
          (fen.trim().split(/\s+/)[1] === "b" ? "b" : "w");

    if (checked) setEditTurn(nextTurn);

    setFen((oldFen) =>
      applyGameStateToFen(
        oldFen,
        castlingRights,
        nextSide,
        nextTurn,
      ),
    );
  };

  const updateEditTurn = (turn: "w" | "b") => {
    setEditTurn(turn);

    const nextEnPassant =
      (enPassantSide === "white" && turn !== "w") ||
      (enPassantSide === "black" && turn !== "b")
        ? null
        : enPassantSide;

    if (nextEnPassant !== enPassantSide) {
      setEnPassantSide(nextEnPassant);
    }

    setFen((oldFen) =>
      applyGameStateToFen(
        oldFen,
        castlingRights,
        nextEnPassant,
        turn,
      ),
    );
  };

  const finishEditing = () => {
    if (!editTurn) return;

    const finalFen = applyGameStateToFen(
      fen,
      castlingRights,
      enPassantSide,
      editTurn,
    );

    const fresh = createGame(finalFen);

    setGames((old) => [
      ...old.filter((g) => g.id !== activeGame?.id),
      fresh,
    ]);

    setActiveGameId(fresh.id);
    setCurrentNodeId(null);
    setHighlightedNodeId(null);
    setFen(fresh.rootFen);
    setIsEditing(false);
    setSelectedPiece(null);
    setBranchChoices(null);
    setSelectedIndex(0);
  };

  const gameLabel = (g: Game) =>
    g.headers.Event ||
    `${g.headers.White || "White"} vs ${
      g.headers.Black || "Black"
    }`;

  const event =
    activeGame?.headers.Event || "Game analysis";

  const white =
    activeGame?.headers.White || "White";

  const black =
    activeGame?.headers.Black || "Black";

  const result =
    activeGame?.headers.Result || "*";

  const renderMoveTree = (
    nodeId: string,
    isVariationStart = false,
  ): React.ReactNode => {
    if (!activeGame) return null;

    const node = activeGame.nodes[nodeId];
    if (!node) return null;

    const hasComment =
      typeof node.comment === "string" &&
      node.comment.trim().length > 0;

    const children = node.children || [];
    const mainChild = children[0];
    const variations = children.slice(1);

    return (
      <React.Fragment key={node.id}>
        <button
          ref={(element) => {
            moveRefs.current[node.id] = element;
          }}
          type="button"
          onClick={() => goToNode(node.id)}
          style={{
            ...s.move,
            ...(highlightedNodeId === node.id
              ? s.activeMove
              : {}),
          }}
        >
          {formatMoveNotation(
            node,
            isVariationStart ? "variationStart" : "mainline",
          )}

          {children.length > 1 ? " ▾" : ""}
        </button>

        {hasComment && (
          <span style={s.comment}>
            {" "}
            {node.comment.trim()}{" "}
          </span>
        )}

        {variations.map((variationId) => (
          <React.Fragment key={variationId}>
            {" "}
            <span style={s.variationBracket}>(</span>
            {renderMoveTree(variationId, true)}
            <span style={s.variationBracket}>)</span>
            {" "}
          </React.Fragment>
        ))}

        {mainChild && (
          <>
            {" "}
            {renderMoveTree(mainChild)}
          </>
        )}
      </React.Fragment>
    );
  };

  const renderAllMoves = () => {
    if (!activeGame) return null;

    const roots = activeGame.rootChildren || [];

    if (!roots.length) {
      return (
        <p style={s.empty}>
          No moves yet. Make a move on the board
          to start an analysis.
        </p>
      );
    }

    const mainLine = roots[0];
    const variations = roots.slice(1);

    return (
      <div>
        {renderMoveTree(mainLine)}

        {variations.map((variationId) => (
          <React.Fragment key={variationId}>
            {" "}
            <span style={s.variationBracket}>(</span>
            {renderMoveTree(variationId, true)}
            <span style={s.variationBracket}>)</span>
            {" "}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const currentPositionLabel = path.length
    ? formatMoveNotation(path[path.length - 1])
    : "Starting position";

  const castlingCheckbox = (
    right: keyof CastlingRights,
    label: string,
  ) => (
    <label style={s.checkLabel}>
      <input
        type="checkbox"
        checked={castlingRights[right]}
        onChange={(event) =>
          updateCastlingRight(right, event.target.checked)
        }
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="chess-app" style={s.container} dir="ltr">
      <style>{`
        * { box-sizing: border-box; }
        .chess-app { width:100%; max-width:1500px !important; margin:0 auto; padding:20px clamp(12px,2vw,28px) 32px !important; color:#172033; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important; text-align:left !important; }
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
        .toolbar-group { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
        .toolbar-button { border:1px solid #dbe2ee; background:#fff; color:#263247; border-radius:11px; padding:10px 15px; min-height:42px; font-weight:650; font-size:13px; cursor:pointer; box-shadow:0 2px 7px rgba(20,35,60,.05); transition:background .18s ease,transform .18s ease,box-shadow .18s ease; }
        .toolbar-button:hover { background:#f1f5fb; transform:translateY(-1px); box-shadow:0 5px 12px rgba(20,35,60,.09); }
        .toolbar-button.primary { background:#315fca; border-color:#315fca; color:#fff; }
        .toolbar-button.active { background:#e8efff; border-color:#9bb7f5; color:#234eaa; }
        .main-grid { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr); align-items:stretch; gap:20px; min-width:0; }
        .board-column { min-width:0; display:flex; flex-direction:column; }
        .board-frame { width:100%; max-width:none !important; margin:0 !important; padding:12px; background:#fff; border:1px solid #e3e8f1; border-radius:18px; box-shadow:0 8px 28px rgba(24,39,75,.07); }
        .right-column { min-width:0; display:flex; flex-direction:column; gap:14px; min-height:0; }
        .note-card { flex:1 1 auto !important; width:100%; max-width:none !important; min-width:0 !important; min-height:420px !important; display:flex; flex-direction:column; border:1px solid #e1e7f0 !important; border-radius:16px !important; background:#fff !important; box-shadow:0 8px 26px rgba(24,39,75,.06) !important; }
        .note-card .notation { flex:1 1 auto; min-height:260px !important; max-height:none !important; overflow:auto; }
        .engine-card { width:100% !important; max-width:none !important; margin:0 !important; border:1px solid #dce5f3 !important; border-radius:16px !important; background:#f8faff !important; box-shadow:0 6px 20px rgba(24,39,75,.05); }
        .edit-column { display:flex; flex-direction:column; gap:14px; min-width:0; }
        .edit-column > div { width:100%; max-width:none !important; min-width:0 !important; margin:0 !important; border-radius:16px !important; box-shadow:0 6px 20px rgba(24,39,75,.05); }
        .edit-column > div > div { max-width:none !important; }
        .mobile-tabs { display:none; }
        .game-list-card { width:100%; max-width:none !important; min-width:0 !important; border-radius:16px !important; }
        button:disabled { opacity:.45; cursor:not-allowed !important; transform:none !important; }
        @media(max-width:767px) {
          .chess-app { padding:12px 10px 24px !important; }
          .topbar { align-items:stretch; gap:8px; }
          .toolbar-group { width:100%; justify-content:space-between; }
          .toolbar-button { flex:1 1 auto; padding:9px 8px; font-size:12px; min-width:0; }
          .main-grid { display:flex; flex-direction:column; gap:12px; }
          .board-frame { padding:6px; border-radius:13px; }
          .right-column { width:100%; }
          .note-card { min-height:360px !important; }
          .mobile-tabs { display:flex; gap:8px; padding:4px; border:1px solid #e2e8f0; background:#f1f5f9; border-radius:12px; }
          .mobile-tabs button { flex:1; border:0; border-radius:9px; background:transparent; padding:10px; color:#475569; font-weight:700; cursor:pointer; }
          .mobile-tabs button.selected { color:#1e40af; background:#fff; box-shadow:0 2px 7px rgba(20,35,60,.08); }
          .mobile-panel { display:none !important; }
          .mobile-panel.visible { display:block !important; }
          .engine-card { margin:0 !important; }
          .edit-column { gap:10px; }
        }
   
/* ================================
   Chessboard: Figma Layout
================================ */

.main-grid {
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 1fr);
  align-items: stretch;
  gap: 20px;
}

.board-column {
  min-width: 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: 0;
  margin: 0;
}


.board-frame {
  width: min(100%, calc(100vh - 150px));
  max-width: 100% !important;
  height: auto;
  aspect-ratio: 1 / 1;
  flex: 0 0 auto;
  box-sizing: border-box;
  padding: 12px;
  margin: 0 !important;
  overflow: hidden;
}


/* Mobile */
@media (max-width: 767px) {
  .board-column {
    align-items: stretch;
  }

  .board-frame {
    width: 100%;
    max-width: 100% !important;
    height: auto;
    aspect-ratio: 1 / 1;
    padding: 6px;
    margin: 0 !important;
  }
}



/* ================================
   Right Column: ساختار اصلی
================================ */

.right-column {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
  align-self: stretch;
}

.mobile-tabs {
  display: none;
}

.right-column > .mobile-panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}


/* ================================
   حالت عادی: فقط Note باز است
================================ */

/* مخفی کردن پنل خالی Engine */
.right-column > .mobile-panel + .mobile-panel:not(:has(.engine-card)) {
  display: none;
}

/* Note تمام ارتفاع ستون را می‌گیرد */
.right-column > .mobile-tabs + .mobile-panel {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.note-card {
  display: flex;
  flex-direction: column;
  flex: 1 1 0 !important;
  width: 100%;
  height: 100%;
  min-height: 0 !important;
  max-width: none !important;
  overflow: hidden;
}

.note-card .notation {
  flex: 1 1 0;
  min-height: 0 !important;
  max-height: none !important;
  overflow-y: auto;
}


/* ================================
   حالت Engine باز: تقسیم 50-50
================================ */

.right-column:has(.engine-card) {
  gap: 0;
}

/* نیمه بالایی: Note */
.right-column:has(.engine-card) > .mobile-tabs + .mobile-panel {
  flex: 0 0 50%;
  min-height: 0;
  overflow-y: auto;
}

.right-column:has(.engine-card) > .mobile-tabs + .mobile-panel .note-card {
  flex: 1 1 0 !important;
  height: 100%;
  min-height: 0 !important;
}

.right-column:has(.engine-card) > .mobile-tabs + .mobile-panel .notation {
  min-height: 0 !important;
  overflow-y: auto;
}

/* نیمه پایینی: Engine */
.right-column:has(.engine-card) > .mobile-tabs + .mobile-panel + .mobile-panel {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.engine-card {
  flex: 1 1 0;
  width: 100% !important;
  height: 100%;
  min-height: 0;
  max-width: none !important;
  margin: 0 !important;
  overflow-y: auto;
}


/* ================================
   Edit Board
================================ */

.edit-column {
  min-width: 0;
  width: 100%;
}


/* ================================
   Mobile Layout
================================ */

@media (max-width: 767px) {
  

  .right-column {
    width: 100%;
    height: auto;
    min-height: 0;
    gap: 12px;
  }

  .mobile-tabs {
    display: flex;
  }

  .right-column > .mobile-panel {
    display: none !important;
    flex: 1 1 auto;
    min-height: 0;
    overflow: visible;
  }

  .right-column > .mobile-panel.visible {
    display: flex !important;
    flex-direction: column;
  }

  .right-column:has(.engine-card) > .mobile-tabs + .mobile-panel,
  .right-column:has(.engine-card) > .mobile-tabs + .mobile-panel + .mobile-panel {
    flex: 1 1 auto;
    min-height: 0;
    overflow: visible;
  }

  .note-card {
    min-height: 360px !important;
    height: auto;
  }

  .engine-card {
    height: auto;
    min-height: 0;
  }
}
    
/* ================================
   Full Board Mode
================================ */

.main-grid.full-board-mode {
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  width: 100%;
}

.main-grid.full-board-mode .board-column {
  width: 100%;
  align-items: center;
}

.main-grid.full-board-mode .board-frame {
  width: min(100%, calc(100vh - 170px), 900px);
  max-width: 100% !important;
  aspect-ratio: 1 / 1;
  height: auto;
  margin: 0 auto !important;
}

.main-grid.full-board-mode .right-column {
  display: none !important;
}

/* Full Board - Mobile */
@media (max-width: 767px) {
  .main-grid.full-board-mode .board-frame {
    width: min(100%, calc(100vh - 150px));
    max-width: 100% !important;
    aspect-ratio: 1 / 1;
  }
}
 

/* ================================
   Edit Board: Three Column Layout
================================ */

.main-grid:has(.edit-column) {
  grid-template-columns:
    minmax(0, 1.25fr)
    minmax(220px, 0.7fr)
    minmax(280px, 0.9fr);
  gap: 16px;
}

.main-grid:has(.edit-column) .right-column {
  grid-column: 2 / 4;
  min-width: 0;
}

.main-grid:has(.edit-column) .edit-column > div {
  display: grid !important;
  grid-template-columns:
    minmax(220px, 0.78fr)
    minmax(280px, 1fr);
  gap: 16px;
  align-items: start;
}

/* Game State in the middle */
.main-grid:has(.edit-column) .edit-column > div > div:first-child {
  order: 2;
}

.main-grid:has(.edit-column) .edit-column > div > div:nth-child(2) {
  order: 1;
}

/* Keep the original stacked layout on mobile */
@media (max-width: 767px) {
  .main-grid:has(.edit-column) {
    display: flex;
    flex-direction: column;
  }

  .main-grid:has(.edit-column) .edit-column > div {
    display: flex !important;
    flex-direction: column !important;
  }

  .main-grid:has(.edit-column) .edit-column > div > div {
    order: initial;
  }
}

/* ================================
   Choose a Game: Internal Scroll
================================ */

.game-list-card {
  max-height: calc(100vh - 250px) !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #b8b8b8 transparent;
}

/* Scrollbar appearance */
.game-list-card::-webkit-scrollbar {
  width: 7px;
}

.game-list-card::-webkit-scrollbar-thumb {
  background: #b8b8b8;
  border-radius: 10px;
}

.game-list-card::-webkit-scrollbar-track {
  background: transparent;
}

/* Mobile */
@media (max-width: 767px) {
  .game-list-card {
    max-height: calc(100vh - 220px) !important;
  }
}


     `}</style>

      <div className="topbar">
        <div className="toolbar-group">
          <input ref={fileInputRef} type="file" accept=".pgn" onChange={handleFileUpload} style={{ display:"none" }} />
          <button className="toolbar-button primary" onClick={() => fileInputRef.current?.click()}>Open PGN</button>
          <button className="toolbar-button" onClick={resetAll}>Close PGN</button>
        </div>
        <div className="toolbar-group">
          {!isEditing && <>
            <button className="toolbar-button" onClick={previous} disabled={!currentNodeId}>Previous</button>
            <button className="toolbar-button" onClick={advance} disabled={!continuations.length}>Next</button>
          </>}
        </div>
        <div className="toolbar-group">
          {!isEditing && <button className="toolbar-button" onClick={startEditing}>Edit Board</button>}
          {!isEditing && <button className={`toolbar-button ${engineOpen ? "active" : ""}`} onClick={toggleEngine}>{engineOpen ? "Close Engine" : "Engine"}</button>}
          {!isEditing && (
  <button
    className={`toolbar-button ${fullBoard ? "active" : ""}`}
    onClick={() => setFullBoard((prev) => !prev)}
  >
    {fullBoard ? "Notation" : "Full Board"}
  </button>
)}
        </div>
      </div>

      {fileName && <div style={s.fileName}>Selected file: {fileName}</div>}

      <div className={`main-grid ${fullBoard ? "full-board-mode" : ""}`}>
        <section className="board-column">
          <div className="board-frame">
            <Chessboard options={{
              position:fen, boardOrientation:"white", allowDragging:!isEditing,
              onPieceDrop:handlePieceDrop, onSquareClick:handleSquareClick,
              darkSquareStyle:{backgroundColor:"#769656"},
              lightSquareStyle:{backgroundColor:"#eeeed2"},
            }} />
          </div>
        </section>

        <section className="right-column">
          {isEditing ? (
            <div className="edit-column">
            <div style={{ ...s.editLayout, flexDirection: "column", width: "100%", maxWidth: "none" }}>
              <div style={s.editPanel}>
                <h2>Edit Board</h2>

                <p>
                  Select a piece and click an empty square to place it.
                  Click an existing piece to remove it.
                </p>

                {selectedPiece && (
                  <p style={s.selectedInfo}>
                    Selected piece:{" "}
                    <strong>
                      {PIECES.find(
                        (p) => p.code === selectedPiece,
                      )?.name}
                    </strong>
                  </p>
                )}

                <h3>White Pieces</h3>

                <div style={s.pieces}>
                  {PIECES.filter(
                    (p) => p.code[0] === "w",
                  ).map((p) => (
                    <button
                      key={p.code}
                      type="button"
                      title={p.name}
                      onClick={() => setSelectedPiece(p.code)}
                      style={{
                        ...s.piece,
                        background:
                          selectedPiece === p.code
                            ? "#dbeafe"
                            : "white",
                        border:
                          selectedPiece === p.code
                            ? "2px solid #2563eb"
                            : "1px solid #ccc",
                      }}
                    >
                      {p.symbol}
                    </button>
                  ))}
                </div>

                <h3>Black Pieces</h3>

                <div style={s.pieces}>
                  {PIECES.filter(
                    (p) => p.code[0] === "b",
                  ).map((p) => (
                    <button
                      key={p.code}
                      type="button"
                      title={p.name}
                      onClick={() => setSelectedPiece(p.code)}
                      style={{
                        ...s.piece,
                        background:
                          selectedPiece === p.code
                            ? "#dbeafe"
                            : "white",
                        border:
                          selectedPiece === p.code
                            ? "2px solid #2563eb"
                            : "1px solid #ccc",
                      }}
                    >
                      {p.symbol}
                    </button>
                  ))}
                </div>

                <div style={s.editActions}>
                  <button
                    type="button"
                    onClick={() => {
                      setFen((oldFen) => {
                        const fields = oldFen.trim().split(/\s+/);

                        return [
                          EMPTY_FEN.split(/\s+/)[0],
                          fields[1] || "w",
                          fields[2] || "-",
                          fields[3] || "-",
                          fields[4] || "0",
                          fields[5] || "1",
                        ].join(" ");
                      });

                      setSelectedPiece(null);
                    }}
                    style={s.clearButton}
                  >
                    Clear Board
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const nextTurn = editTurn || "w";

                      setFen(
                        applyGameStateToFen(
                          START_FEN,
                          castlingRights,
                          enPassantSide,
                          nextTurn,
                        ),
                      );

                      setSelectedPiece(null);
                    }}
                    style={s.small}
                  >
                    Reset Board
                  </button>
                </div>
              </div>

              <div style={s.gameStatePanel}>
                <h2>Game State</h2>

                <div style={s.stateSection}>
                  <h3>Castling Rights</h3>

                  <div style={s.stateRow}>
                    <strong style={s.stateColor}>White</strong>
                    {castlingCheckbox("Q", "0-0-0")}
                    {castlingCheckbox("K", "0-0")}
                  </div>

                  <div style={s.stateRow}>
                    <strong style={s.stateColor}>Black</strong>
                    {castlingCheckbox("q", "0-0-0")}
                    {castlingCheckbox("k", "0-0")}
                  </div>
                </div>

                <div style={s.stateSection}>
                  <h3>En Passant</h3>

                  <div style={s.stateRow}>
                    <strong style={s.stateColor}>White</strong>

                    <label style={s.checkLabel}>
                      <input
                        type="checkbox"
                        checked={enPassantSide === "white"}
                        onChange={(event) =>
                          updateEnPassant(
                            "white",
                            event.target.checked,
                          )
                        }
                      />
                      <span>En Passant</span>
                    </label>
                  </div>

                  <div style={s.stateRow}>
                    <strong style={s.stateColor}>Black</strong>

                    <label style={s.checkLabel}>
                      <input
                        type="checkbox"
                        checked={enPassantSide === "black"}
                        onChange={(event) =>
                          updateEnPassant(
                            "black",
                            event.target.checked,
                          )
                        }
                      />
                      <span>En Passant</span>
                    </label>
                  </div>
                </div>

                <div style={s.stateSection}>
                  <h3>Turn</h3>

                  <div style={s.turnOptions}>
                    <label style={s.radioLabel}>
                      <input
                        type="radio"
                        name="edit-turn"
                        checked={editTurn === "w"}
                        onChange={() => updateEditTurn("w")}
                      />
                      <span>White move</span>
                    </label>

                    <label style={s.radioLabel}>
                      <input
                        type="radio"
                        name="edit-turn"
                        checked={editTurn === "b"}
                        onChange={() => updateEditTurn("b")}
                      />
                      <span>Black move</span>
                    </label>
                  </div>

                  {!editTurn && (
                    <p style={s.turnWarning}>
                      Please select whose turn it is.
                    </p>
                  )}
                </div>

                <div style={s.gameStateActions}>
                  <button
                    type="button"
                    onClick={finishEditing}
                    disabled={!editTurn}
                    style={{
                      ...s.doneButton,
                      ...(!editTurn
                        ? s.doneButtonDisabled
                        : {}),
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
            </div>
          ) : (
            <>
              <div className="mobile-tabs">
                <button className={mobileTab === "note" ? "selected" : ""} onClick={() => setMobileTab("note")}>Note</button>
                <button className={mobileTab === "engine" ? "selected" : ""} onClick={() => { setMobileTab("engine"); if (!engineOpen) setEngineOpen(true); }}>Engine</button>
              </div>
              <div className={`mobile-panel ${mobileTab === "note" ? "visible" : ""}`}>
        {showGameList ? (
          <section className="game-list-card" style={s.gamePanel}>
            <h2>Choose a game</h2>

            <p style={s.hint}>
              This PGN file contains multiple games.
            </p>

            {games.map((g, index) => (
              <button
                key={g.id}
                onClick={() => chooseGame(g)}
                style={s.gameChoice}
              >
                <strong>{index + 1}.</strong>
                <span>{gameLabel(g)}</span>
              </button>
            ))}
          </section>
        ) : (
          activeGame && (
            <aside className="note-card" style={s.note}>
              <header style={s.noteHeader}>
                <div style={s.event}>{event}</div>

                <div>
                  {white} – {black}
                  <span style={s.result}>{result}</span>
                </div>

                {(activeGame.headers.Date || activeGame.headers.Site) && (
                  <small>
                    {[
                      activeGame.headers.Date,
                      activeGame.headers.Site,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                )}
              </header>

              <div style={s.noteBar}>
                <strong>Notation</strong>
                <span>{fileName || "Analysis"}</span>

                {games.length > 1 && (
                  <button
                    onClick={() => setShowGameList(true)}
                    style={s.back}
                  >
                    All games
                  </button>
                )}
              </div>

              <div
                ref={notePanelRef}
                style={s.notation}
              >
                {renderAllMoves()}
              </div>

              <div style={s.status}>
                <span>Current position</span>
                <strong>{currentPositionLabel}</strong>
              </div>
            </aside>
          )
        )}
              </div>
              <div className={`mobile-panel ${mobileTab === "engine" ? "visible" : ""}`}>
          {/* پنل تحلیل Stockfish فقط در صورت باز بودن نمایش داده می‌شود */}
          {!isEditing && engineOpen && (
            <div className="engine-card" style={s.enginePanel}>
              <div style={s.engineHeader}>
                <strong>Stockfish Analysis</strong>

                <span
                  style={{
                    ...s.engineStatus,
                    color: isAnalyzing
                      ? isStopping
                        ? "#b45309"
                        : "#15803d"
                      : "#64748b",
                  }}
                >
                  {engineMessage}
                </span>
              </div>

              {/* انتخاب تعداد لاین‌ها */}
              <div style={s.multiPVRow}>
                <label
                  htmlFor="multipv-select"
                  style={s.multiPVLabel}
                >
                  Number of lines (MultiPV)
                </label>

                <select
                  id="multipv-select"
                  value={multiPV}
                  onChange={(event) =>
                    setMultiPV(Number(event.target.value))
                  }
                  style={s.multiPVSelect}
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>

              {/* نمایش لاین‌های تحلیل */}
              <div style={s.engineLines}>
                {engineLines.length === 0 ? (
                  <div style={s.noEngineLines}>
                    {isAnalyzing
                      ? "Waiting for engine analysis..."
                      : "Waiting for engine..."}
                  </div>
                ) : (
                  engineLines.map((line) => (
                    <div
                      key={line.multipv}
                      style={s.engineLine}
                    >
                      <div style={s.engineLineHeader}>
                        <strong>
                          Line {line.multipv}
                        </strong>

                        <span style={s.engineLineDepth}>
                          Depth {line.depth}
                        </span>

                        <strong style={s.engineLineScore}>
                          {line.evaluation}
                        </strong>
                      </div>

                      <div style={s.engineLineMoves}>
                        {line.moves}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <p style={s.engineHint}>
                Continuous analysis using go infinite.
                Positive evaluation favors White.
              </p>
            </div>
          )}
              </div>
            </>
          )}
        </section>
      </div>

      {branchChoices && activeGame && (
        <div
          style={s.overlay}
          role="dialog"
          aria-modal="true"
        >
          <div style={s.modal}>
            <h2>Choose a variation</h2>

            <p style={s.hint}>
              This position has multiple continuations.
              Choose which line to follow.
            </p>

            <div style={s.variationList}>
              {branchChoices.map((id, index) => {
                const node = activeGame.nodes[id];
                if (!node) return null;

                const isMainLine = index === 0;

                const preview = getLinePreview(
                  activeGame,
                  id,
                  isMainLine ? "mainline" : "variationStart",
                );

                return (
                  <button
                    key={id}
                    onClick={() => goToNode(id)}
                    style={{
                      ...s.variation,
                      ...(isMainLine
                        ? s.mainVariation
                        : s.secondaryVariation),
                      ...(selectedIndex === index
                        ? s.selectedVariation
                        : {}),
                    }}
                  >
                    <div style={s.variationContent}>
                      <div style={s.variationHeading}>
                        <strong>
                          {isMainLine
                            ? "Main line"
                            : `Variation ${index}`}
                        </strong>

                        {isMainLine && (
                          <span style={s.mainBadge}>
                            MAIN
                          </span>
                        )}
                      </div>

                      <div style={s.variationPreview}>
                        {preview ||
                          formatMoveNotation(
                            node,
                            isMainLine
                              ? "mainline"
                              : "variationStart",
                          )}
                      </div>
                    </div>

                    <small style={s.variationMeta}>
                      {node.children.length
                        ? `${node.children.length} continuation(s)`
                        : "End of line"}
                    </small>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setBranchChoices(null)}
              style={s.small}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 1350,
    margin: "0 auto",
    padding: "24px 18px",
    textAlign: "center",
    fontFamily: "Arial,sans-serif",
    color: "#222",
  },
  title: {
    fontSize: 30,
    margin: "0 0 8px",
  },
  subtitle: {
    color: "#666",
    marginBottom: 22,
  },
  actions: {
    display: "flex",
    justifyContent: "center",
    gap: 10,
  },
  upload: {
    background: "#2563eb",
    color: "white",
    border: 0,
    padding: "11px 22px",
    borderRadius: 4,
    cursor: "pointer",
  },
  close: {
    background: "#b91c1c",
    color: "white",
    border: 0,
    padding: "11px 22px",
    borderRadius: 4,
    cursor: "pointer",
  },
  fileName: {
    color: "#666",
    fontSize: 13,
  },
  layout: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "flex-start",
    gap: 22,
    marginTop: 24,
  },
  boardSection: {
    flex: "1 1 460px",
    maxWidth: 560,
    minWidth: 280,
  },
  board: {
    width: "100%",
    maxWidth: 530,
    margin: "0 auto 16px",
  },

  // دکمه باز و بسته کردن موتور
  engineToggle: {
    display: "block",
    width: "100%",
    maxWidth: 530,
    margin: "0 auto 14px",
    padding: "11px 18px",
    background: "#2563eb",
    color: "white",
    border: 0,
    borderRadius: 4,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
  },
  engineToggleActive: {
    background: "#475569",
  },

  // استایل‌های پنل Stockfish
  enginePanel: {
    width: "100%",
    maxWidth: 530,
    boxSizing: "border-box",
    margin: "0 auto 16px",
    padding: 14,
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    textAlign: "left",
  },
  engineHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 10,
    borderBottom: "1px solid #e2e8f0",
    fontSize: 14,
  },
  engineStatus: {
    fontSize: 11,
    fontWeight: 600,
  },
  multiPVRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    margin: "12px 0",
  },
  multiPVLabel: {
    fontSize: 12,
    color: "#475569",
    fontWeight: 600,
  },
  multiPVSelect: {
    minWidth: 75,
    padding: "6px 9px",
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    background: "white",
    color: "#1e293b",
    cursor: "pointer",
  },
  engineLines: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: "10px 0 14px",
    width: "100%",
    minWidth: 0,
  },
  noEngineLines: {
    padding: 16,
    textAlign: "center",
    background: "white",
    border: "1px dashed #cbd5e1",
    borderRadius: 4,
    color: "#64748b",
    fontSize: 12,
  },
  engineLine: {
    padding: 10,
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  },
  engineLineHeader: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 7,
    fontSize: 12,
    color: "#334155",
  },
  engineLineDepth: {
    color: "#64748b",
    fontSize: 11,
  },
  engineLineScore: {
    marginLeft: "auto",
    color: "#1d4ed8",
    fontSize: 14,
  },
  engineLineMoves: {
    display: "block",
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    color: "#1e293b",
    fontFamily: 'Georgia,"Times New Roman",serif',
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  engineHint: {
    color: "#64748b",
    fontSize: 11,
    margin: "10px 0 0",
    lineHeight: 1.5,
  },

  edit: {
    background: "#6d28d9",
    color: "white",
    border: 0,
    padding: "10px 25px",
    borderRadius: 4,
    cursor: "pointer",
  },
  editLayout: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 14,
    width: "100%",
    margin: "15px auto",
  },
  editPanel: {
    flex: "1 1 240px",
    minWidth: 230,
    maxWidth: 330,
    padding: 16,
    background: "#f3f4f6",
    border: "1px solid #ddd",
    borderRadius: 4,
    textAlign: "center",
  },
  gameStatePanel: {
    flex: "1 1 240px",
    minWidth: 230,
    maxWidth: 330,
    padding: 16,
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    textAlign: "left",
  },
  stateSection: {
    padding: "10px 0",
    borderTop: "1px solid #e2e8f0",
  },
  stateRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    minHeight: 32,
    margin: "5px 0",
    fontSize: 13,
  },
  stateColor: {
    width: 55,
    color: "#334155",
  },
  checkLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    cursor: "pointer",
    fontSize: 13,
  },
  turnOptions: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "4px 0",
  },
  radioLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    cursor: "pointer",
    fontSize: 13,
  },
  turnWarning: {
    margin: "8px 0 0",
    fontSize: 11,
    color: "#b91c1c",
  },
  gameStateActions: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid #e2e8f0",
  },
  selectedInfo: {
    padding: "7px 10px",
    background: "#eaf2fc",
    borderRadius: 4,
    fontSize: 13,
    color: "#1e40af",
  },
  pieces: {
    display: "flex",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
    margin: "10px 0 18px",
  },
  piece: {
    width: 48,
    height: 48,
    fontSize: 32,
    background: "white",
    border: "1px solid #ccc",
    borderRadius: 4,
    cursor: "pointer",
  },
  editActions: {
    display: "flex",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 12,
  },
  clearButton: {
    margin: 4,
    padding: "7px 11px",
    border: "1px solid #dc2626",
    background: "#fef2f2",
    color: "#b91c1c",
    borderRadius: 3,
    cursor: "pointer",
  },
  doneButton: {
    padding: "8px 18px",
    border: 0,
    background: "#15803d",
    color: "white",
    borderRadius: 3,
    cursor: "pointer",
  },
  doneButtonDisabled: {
    background: "#9ca3af",
    cursor: "not-allowed",
    opacity: 0.7,
  },
  small: {
    margin: 4,
    padding: "7px 11px",
    border: "1px solid #b8bec6",
    background: "white",
    borderRadius: 3,
    cursor: "pointer",
  },
  nav: {
    display: "flex",
    justifyContent: "center",
    gap: 12,
    margin: "18px 0",
  },
  navBtn: {
    background: "#475569",
    color: "white",
    border: 0,
    padding: "10px 20px",
    borderRadius: 4,
    cursor: "pointer",
  },
  note: {
    flex: "1 1 420px",
    maxWidth: 650,
    minWidth: 290,
    minHeight: 390,
    textAlign: "left",
    border: "1px solid #aeb5bf",
    background: "#fbfbfc",
    borderRadius: 2,
    boxShadow: "0 1px 3px rgba(0,0,0,.08)",
    overflow: "hidden",
  },
  noteHeader: {
    textAlign: "center",
    padding: "12px 14px 9px",
    background: "#f0f2f5",
    borderBottom: "1px solid #c9ced6",
    lineHeight: 1.6,
    fontSize: 13,
  },
  event: {
    fontSize: 14,
    fontWeight: 700,
    color: "#303844",
  },
  result: {
    display: "inline-block",
    marginLeft: 9,
    padding: "1px 7px",
    background: "#e2e7ed",
    border: "1px solid #c7cdd5",
    borderRadius: 2,
  },
  noteBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "7px 11px",
    background: "#e8edf3",
    borderBottom: "1px solid #c9ced6",
    fontSize: 12,
    color: "#374151",
  },
  back: {
    marginLeft: "auto",
    border: "1px solid #b8bec6",
    background: "white",
    padding: "3px 7px",
    cursor: "pointer",
    fontSize: 11,
  },
  notation: {
    minHeight: 300,
    maxHeight: 510,
    overflowY: "auto",
    padding: "13px 14px",
    background: "white",
    fontFamily: 'Georgia,"Times New Roman",serif',
    fontSize: 14,
    lineHeight: 1.9,
    textAlign: "left",
  },
  move: {
    display: "inline",
    border: 0,
    borderRadius: 2,
    padding: "1px 3px",
    margin: "0 1px",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    cursor: "pointer",
    background: "transparent",
    color: "#20252b",
  },
  activeMove: {
    background: "#c9def4",
    color: "#123d68",
    fontWeight: 700,
  },
  comment: {
    display: "inline",
    color: "#344e72",
    fontFamily: "Arial,sans-serif",
    fontSize: 12,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    background: "#f7f9fc",
  },
  variationBracket: {
    color: "#64748b",
    fontWeight: 600,
  },
  empty: {
    color: "#888",
    fontSize: 13,
    padding: 12,
    textAlign: "center",
  },
  status: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 13px",
    borderTop: "1px solid #c9ced6",
    background: "#f1f3f6",
    fontSize: 11,
    color: "#596273",
  },
  gamePanel: {
    flex: "1 1 320px",
    maxWidth: 440,
    minWidth: 290,
    textAlign: "left",
    border: "1px solid #ccc",
    background: "white",
    padding: 16,
    borderRadius: 3,
  },
  hint: {
    color: "#777",
    fontSize: 12,
  },
  gameChoice: {
    display: "flex",
    gap: 12,
    width: "100%",
    textAlign: "left",
    padding: "10px 8px",
    background: "white",
    border: 0,
    borderBottom: "1px solid #eee",
    cursor: "pointer",
    color: "#222",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.42)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  modal: {
    width: "min(520px, 100%)",
    maxHeight: "85vh",
    overflowY: "auto",
    background: "white",
    borderRadius: 6,
    padding: 20,
    boxShadow: "0 10px 35px rgba(0,0,0,.2)",
    textAlign: "left",
  },
  variationList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: "14px 0",
  },
  variation: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    width: "100%",
    textAlign: "left",
    padding: 12,
    border: "1px solid #ddd",
    borderRadius: 5,
    cursor: "pointer",
    color: "#222",
  },
  mainVariation: {
    background: "#eaf2fc",
    border: "1px solid #9bbce5",
  },
  secondaryVariation: {
    background: "#fafafa",
    border: "1px solid #dedede",
  },
  selectedVariation: {
    background: "#dbeafe",
    border: "2px solid #2563eb",
    boxShadow: "0 0 0 2px rgba(37,99,235,.12)",
  },
  variationContent: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    minWidth: 0,
    flex: 1,
  },
  variationHeading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
  },
  mainBadge: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "#1d4f91",
    background: "#d2e4fb",
    borderRadius: 3,
    padding: "2px 5px",
  },
  variationPreview: {
    fontFamily: 'Georgia,"Times New Roman",serif',
    fontSize: 14,
    lineHeight: 1.6,
    color: "#303844",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
    width: "100%",
  },
};