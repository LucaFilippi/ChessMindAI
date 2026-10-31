import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, DEFAULT_POSITION } from "chess.js";
import type { Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  RotateCcw,
  ScanLine,
  Upload,
  Eye,
  EyeOff,
  BrainCircuit,
} from "lucide-react";
import { api, post, pct } from "./api";
import type { Player, Prediction } from "./api";
import Arrows from "./Arrows";

export default function Board({
  player,
  opacity,
}: {
  player?: Player;
  opacity: number;
}) {
  const [initial, setInitial] = useState(DEFAULT_POSITION),
    [moves, setMoves] = useState<string[]>([]),
    [cursor, setCursor] = useState(0);
  const [flipped, setFlipped] = useState(false),
    [top, setTop] = useState(3),
    [arrows, setArrows] = useState(true),
    [selected, setSelected] = useState("");
  const [fenInput, setFenInput] = useState(""),
    [error, setError] = useState(""),
    [prediction, setPrediction] = useState<Prediction | null>(null),
    [loading, setLoading] = useState(false);
  const [evaluation, setEvaluation] = useState(""),
    [promotion, setPromotion] = useState<{ from: string; to: string } | null>(
      null,
    ),
    [clicked, setClicked] = useState("");
  const requestId = useRef(0);
  const board = useMemo(() => {
    const b = new Chess(initial);
    moves
      .slice(0, cursor)
      .forEach((m) =>
        b.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }),
      );
    return b;
  }, [initial, moves, cursor]);
  const fen = board.fen(),
    history = moves.slice(0, cursor),
    historyKey = history.join(" ");
  useEffect(() => {
    const id = ++requestId.current;
    setPrediction(null);
    setSelected("");
    setError("");
    setLoading(false);
    if (!player?.model) return;
    if (
      player.color !== "both" &&
      player.color !== (board.turn() === "w" ? "white" : "black")
    ) {
      setError(
        "É a vez do adversário. Avance o lance para analisar este jogador.",
      );
      return;
    }
    setLoading(true);
    const timer = setTimeout(
      () =>
        post<Prediction>(`/players/${player.id}/predict`, {
          fen,
          initial_fen: initial,
          history: historyKey ? historyKey.split(" ") : [],
        })
          .then((p) => {
            if (id === requestId.current) setPrediction(p);
          })
          .catch((e) => {
            if (id === requestId.current) setError(e.message);
          })
          .finally(() => {
            if (id === requestId.current) setLoading(false);
          }),
      180,
    );
    return () => {
      clearTimeout(timer);
      requestId.current++;
    };
  }, [player?.id, player?.model?.version, fen, initial, historyKey]);

  async function record(uci: string) {
    if (prediction) {
      try {
        const result = await post<{ rank: number }>(
          `/predictions/${prediction.id}/actual`,
          { uci },
        );
        setEvaluation(
          `Lance real ${uci} · posição ${result.rank} no ranking. Avaliação interativa, não teste independente.`,
        );
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }
  function makeMove(from: string, to: string, piece = "q") {
    try {
      const copy = new Chess(fen);
      const move = copy.move({ from, to, promotion: piece });
      if (!move) return false;
      const uci = move.from + move.to + (move.promotion || "");
      void record(uci);
      setMoves([...moves.slice(0, cursor), uci]);
      setCursor(cursor + 1);
      setClicked("");
      return true;
    } catch {
      return false;
    }
  }
  function drop(from: string, to: string) {
    if (
      board.get(from as Square)?.type === "p" &&
      (to[1] === "8" || to[1] === "1") &&
      board
        .moves({ square: from as Square, verbose: true })
        .some((m) => m.to === to)
    ) {
      setPromotion({ from, to });
      return false;
    }
    return makeMove(from, to);
  }
  function loadFen() {
    try {
      const b = new Chess(fenInput);
      setInitial(b.fen());
      setMoves([]);
      setCursor(0);
      setError("");
      setEvaluation("");
    } catch {
      setError(
        "FEN inválida. Inclua os dois reis, lado a jogar e demais campos.",
      );
    }
  }
  async function importPgn(file: File) {
    try {
      const b = new Chess();
      b.loadPgn(await file.text());
      const h = b.history({ verbose: true });
      setInitial(h[0]?.before || b.fen());
      setMoves(h.map((m) => m.from + m.to + (m.promotion || "")));
      setCursor(0);
      setEvaluation(
        "Partida carregada. O próximo lance fica oculto até você avançar.",
      );
    } catch (e) {
      setError("Não foi possível abrir o PGN: " + (e as Error).message);
    }
  }
  const shown = prediction?.moves.slice(0, top) || [];
  const styles: Record<string, React.CSSProperties> = {};
  const last = board.history({ verbose: true }).at(-1);
  if (last) {
    styles[last.from] = { backgroundColor: "rgba(230,235,122,.4)" };
    styles[last.to] = { backgroundColor: "rgba(230,235,122,.5)" };
  }
  if (clicked) styles[clicked] = { backgroundColor: "rgba(230,235,122,.7)" };
  if (board.isCheck())
    for (const row of board.board())
      for (const p of row)
        if (p?.type === "k" && p.color === board.turn())
          styles[p.square] = { background: "radial-gradient(#ed7777,#b94d4d)" };
  return (
    <div className="board-layout">
      <section className="board-column">
        <div className="board-top">
          <div className="avatar">{player?.name.slice(0, 1) || "♞"}</div>
          <div>
            <strong>{player?.name || "Selecione um jogador"}</strong>
            <small>
              {player
                ? `${player.color === "both" ? "Ambas as cores" : player.color === "white" ? "Peças brancas" : "Peças pretas"} · ${player.games.toLocaleString("pt-BR")} partidas`
                : "Seu próximo laboratório de comportamento"}
            </small>
          </div>
          <span className="pill">
            <i />
            {board.turn() === "w" ? "Brancas" : "Pretas"} jogam
          </span>
        </div>
        <div className="chess-wrap">
          <Chessboard
            options={{
              id: "prediction-board",
              position: fen,
              boardOrientation: flipped ? "black" : "white",
              darkSquareStyle: { backgroundColor: "#739174" },
              lightSquareStyle: { backgroundColor: "#e9e5cc" },
              squareStyles: styles,
              animationDurationInMs: 220,
              allowDrawingArrows: false,
              onPieceDrop: ({ sourceSquare, targetSquare }) =>
                targetSquare ? drop(sourceSquare, targetSquare) : false,
              onSquareClick: ({ square }) => {
                if (clicked && clicked !== square) {
                  drop(clicked, square);
                  setClicked("");
                } else setClicked(square);
              },
            }}
          />
          {arrows && (
            <Arrows
              moves={shown}
              flipped={flipped}
              opacity={opacity}
              selected={selected}
            />
          )}
        </div>
        <div className="board-controls">
          <div>
            <button
              className="icon-button"
              title="Posição inicial"
              onClick={() => setCursor(0)}
            >
              <ChevronsLeft size={18} />
            </button>
            <button
              className="icon-button"
              title="Lance anterior"
              disabled={!cursor}
              onClick={() => setCursor(cursor - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <span>
              Lance {Math.floor(cursor / 2) + 1}{" "}
              <small>· {cursor} meios-lances</small>
            </span>
            <button
              className="icon-button"
              title="Revelar próximo lance"
              disabled={cursor >= moves.length || loading}
              onClick={() => {
                void record(moves[cursor]);
                setCursor(cursor + 1);
              }}
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <div>
            <button
              className="icon-button"
              title="Inverter tabuleiro"
              onClick={() => setFlipped(!flipped)}
            >
              <ArrowLeftRight size={17} />
            </button>
            <button
              className="icon-button"
              title="Reiniciar tabuleiro"
              onClick={() => {
                setInitial(DEFAULT_POSITION);
                setMoves([]);
                setCursor(0);
                setEvaluation("");
              }}
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
        <div className="position-tools">
          <label className="button secondary">
            <Upload size={16} /> Abrir partida PGN
            <input
              type="file"
              accept=".pgn"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) void importPgn(e.target.files[0]);
              }}
            />
          </label>
          <span>
            {board.isCheckmate()
              ? "Xeque-mate"
              : board.isDraw()
                ? "Empate"
                : board.isCheck()
                  ? "Rei em xeque"
                  : "Posição legal"}
          </span>
        </div>
        <details className="panel fen">
          <summary>Carregar posição FEN</summary>
          <textarea
            aria-label="Posição FEN"
            value={fenInput}
            onChange={(e) => setFenInput(e.target.value)}
            placeholder={fen}
          />
          <button onClick={loadFen}>Carregar posição</button>
        </details>
        {evaluation && <p className="notice">{evaluation}</p>}
        <div className="moves-strip">
          {board.history().map((m, i) => (
            <button key={i} onClick={() => setCursor(i + 1)}>
              {i % 2 === 0 && <small>{Math.floor(i / 2) + 1}.</small>} {m}
            </button>
          ))}
          {cursor === 0 && (
            <span>Arraste uma peça ou abra uma partida para começar.</span>
          )}
        </div>
        {promotion && (
          <div className="modal-backdrop">
            <section className="panel modal">
              <h2>Promover peão</h2>
              <div className="button-row">
                {[
                  ["q", "Dama"],
                  ["r", "Torre"],
                  ["b", "Bispo"],
                  ["n", "Cavalo"],
                ].map(([p, label]) => (
                  <button
                    key={p}
                    onClick={() => {
                      makeMove(promotion.from, promotion.to, p);
                      setPromotion(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className="secondary"
                  onClick={() => setPromotion(null)}
                >
                  Cancelar
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
      <aside className="prediction-column">
        <section className="panel prediction-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LEITURA COMPORTAMENTAL</span>
              <h2>Próximos movimentos</h2>
            </div>
            <BrainCircuit size={23} className="accent" />
          </div>
          <p className="muted">O que este jogador provavelmente faria?</p>
          <div className="prediction-toolbar">
            <select
              aria-label="Quantidade de previsões"
              value={top}
              onChange={(e) => setTop(+e.target.value)}
            >
              {[3, 5, 10, 999].map((n) => (
                <option key={n} value={n}>
                  {n === 999 ? "Todos os legais" : `Top ${n} movimentos`}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              title={arrows ? "Ocultar setas" : "Mostrar setas"}
              onClick={() => setArrows(!arrows)}
            >
              {arrows ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
          {loading ? (
            <div className="empty">
              <div className="loader" />
              <h3>Consultando a rede neural</h3>
              <p>Calculando movimentos legais desta posição.</p>
            </div>
          ) : error ? (
            <div className="empty">
              <ScanLine size={32} />
              <p>{error}</p>
            </div>
          ) : !player?.model ? (
            <div className="empty">
              <BrainCircuit size={38} />
              <h3>Um perfil. Um jeito de jogar.</h3>
              <p>
                Importe partidas e treine o modelo para revelar as
                probabilidades reais nesta posição.
              </p>
              <span className="pill">Aguardando modelo</span>
            </div>
          ) : prediction?.moves.length === 0 ? (
            <div className="empty">
              <h3>Partida encerrada</h3>
              <p>Não há movimentos legais disponíveis.</p>
            </div>
          ) : (
            <div className="prediction-list">
              {shown.map((m, i) => (
                <button
                  key={m.uci}
                  className={
                    "prediction-row " + (selected === m.uci ? "selected" : "")
                  }
                  onMouseEnter={() => setSelected(m.uci)}
                  onMouseLeave={() => setSelected("")}
                  onFocus={() => setSelected(m.uci)}
                  onBlur={() => setSelected("")}
                  onClick={() => setSelected(m.uci)}
                >
                  <span className="rank">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{m.san}</strong>
                    <small>
                      {m.piece.toUpperCase()} · {m.origin} → {m.target}
                      {m.uci[4] ? ` · promoção ${m.uci[4].toUpperCase()}` : ""}
                    </small>
                    <div className="bar">
                      <i style={{ width: m.probability * 100 + "%" }} />
                    </div>
                  </div>
                  <b>{pct(m.probability)}</b>
                </button>
              ))}
            </div>
          )}
          {prediction && (
            <div className="distribution-note">
              {prediction.moves.length} movimentos legais · soma{" "}
              {pct(prediction.moves.reduce((s, m) => s + m.probability, 0))}
            </div>
          )}
        </section>
        <section className="panel model-card">
          <span className="eyebrow">MODELO DO JOGADOR</span>
          <div className="model-title">
            <span className="model-icon">
              <BrainCircuit size={21} />
            </span>
            <div>
              <h3>
                {player?.model
                  ? `Rede neural · v${player.model.version}`
                  : "Nenhum modelo treinado"}
              </h3>
              <p>CNN residual + Transformer</p>
            </div>
          </div>
          <div className="mini-stats">
            <div>
              <small>Partidas de treino</small>
              <strong>
                {player?.model?.games.toLocaleString("pt-BR") || "—"}
              </strong>
            </div>
            <div>
              <small>Top-1 · validação</small>
              <strong>
                {player?.model
                  ? pct(player.model.metrics.validation.top1)
                  : "—"}
              </strong>
            </div>
          </div>
          <p className="fineprint">
            Probabilidades estimadas pela rede. Acurácia não é garantia;
            consulte a calibração no Training Lab.
          </p>
        </section>
        <div className="board-tip">
          <span>✧</span>
          <p>
            <strong>Aprende com o contexto</strong>Os últimos movimentos
            acompanham cada previsão, sem alterar os pesos do modelo durante a
            análise.
          </p>
        </div>
      </aside>
    </div>
  );
}
