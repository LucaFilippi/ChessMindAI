import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronRight,
  Cpu,
  Database,
  Dna,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import Board from "./Board";
import { api, post, pct } from "./api";
import type { Player, Job, Prediction, Epoch } from "./api";
const navigation = [
  ["board", "Prediction Board", BrainCircuit],
  ["dashboard", "Dashboard", LayoutDashboard],
  ["players", "Players", Users],
  ["import", "Import PGN", Upload],
  ["training", "Training Lab", FlaskConical],
  ["dna", "Player DNA", Dna],
  ["compare", "Compare Players", GitCompareArrows],
  ["settings", "Settings", Settings],
] as const;
const titles: Record<string, [string, string]> = {
  board: [
    "Prediction Board",
    "Cada jogador tem um padrão. Descubra o próximo movimento.",
  ],
  dashboard: ["Visão geral", "Do histórico de partidas à próxima decisão."],
  players: ["Seus jogadores", "Histórias diferentes. Modelos individuais."],
  import: [
    "Importar partidas",
    "Transforme o histórico de um jogador em dados de aprendizado.",
  ],
  training: ["Training Lab", "Treine, acompanhe e avalie a rede neural."],
  dna: ["Player DNA", "As escolhas que definem um jeito de jogar."],
  compare: [
    "Comparar jogadores",
    "Uma posição. Duas formas de enxergar o tabuleiro.",
  ],
  settings: ["Configurações", "Seu ambiente local, do seu jeito."],
};
const colors = { white: "Brancas", black: "Pretas", both: "Ambas as cores" };
export default function App() {
  const [page, setPage] = useState("board"),
    [players, setPlayers] = useState<Player[]>([]),
    [playerId, setPlayerId] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState("");
  const [health, setHealth] = useState<{
    cuda: boolean;
    storage: string;
    torch: string;
  } | null>(null);
  const [opacity, setOpacity] = useState(() =>
    Number(localStorage.getItem("arrow-opacity") || ".86"),
  );
  const player = players.find((p) => p.id === playerId);
  async function refresh() {
    try {
      const [p, j] = await Promise.all([
        api<Player[]>("/players"),
        api<Job[]>("/jobs"),
      ]);
      setPlayers(p);
      setJobs(j);
      setPlayerId((id) => (p.some((x) => x.id === id) ? id : p[0]?.id || ""));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    api<typeof health>("/health")
      .then(setHealth)
      .catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, []);
  const active = jobs.filter((j) =>
    ["running", "queued", "pausing"].includes(j.status),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("board");
          }}
        >
          <span className="brand-mark">♞</span>
          <span>
            chess<span className="brand-light">mind</span>
            <small>HUMAN MOVES. MACHINE INSIGHT.</small>
          </span>
          <b>AI</b>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>LOCAL</span>
        </div>
        <nav>
          {navigation.map(([id, label, Icon], i) => (
            <button
              key={id}
              className={
                (page === id ? "active " : "") + (i === 7 ? "settings-nav" : "")
              }
              onClick={() => {
                setPage(id);
                setError("");
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {page === id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            <strong>
              {health ? "Ambiente conectado" : "Conectando ao backend"}
            </strong>
            <small>
              Processamento local · {health?.cuda ? "CUDA disponível" : "CPU"}
            </small>
          </div>
          <div className="privacy">
            <ShieldCheck size={17} />
            <span>Suas partidas ficam com você.</span>
          </div>
          <span className="version">
            CHESS MIND AI <b>v0.1</b>
          </span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <span>{navigation.find((n) => n[0] === page)?.[1]}</span>
          </div>
          <div className="topbar-right">
            <span className="status-dot" />
            <span>
              {active.length
                ? `${active.length} tarefa(s) em andamento`
                : "Sistema local"}
            </span>
            <span className="user-badge">CM</span>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <span className="eyebrow">INTELIGÊNCIA COMPORTAMENTAL</span>
              <h1>{titles[page][0]}</h1>
              <p>{titles[page][1]}</p>
            </div>
            <div className="profile-select">
              <label htmlFor="profile">JOGADOR EM ANÁLISE</label>
              <select
                id="profile"
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
              >
                <option value="" disabled>
                  Selecione um perfil
                </option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {page === "board" && <Board player={player} opacity={opacity} />}
          {page === "dashboard" && (
            <>
              <div className="stats-grid">
                {[
                  [Users, "Jogadores", players.length],
                  [
                    Database,
                    "Partidas importadas",
                    players.reduce((s, p) => s + p.games, 0),
                  ],
                  [
                    BrainCircuit,
                    "Modelos treinados",
                    players.filter((p) => p.model).length,
                  ],
                  [
                    Activity,
                    "Posições disponíveis",
                    players.reduce((s, p) => s + p.positions, 0),
                  ],
                ].map(([Icon, label, value]) => {
                  const I = Icon as typeof Users;
                  return (
                    <section className="panel stat" key={String(label)}>
                      <I size={20} />
                      <small>{String(label)}</small>
                      <strong>{Number(value).toLocaleString("pt-BR")}</strong>
                    </section>
                  );
                })}
              </div>
              <section className="panel welcome">
                <span className="eyebrow">SEU LABORATÓRIO DE XADREZ</span>
                <h2>
                  Entenda a pessoa
                  <br />
                  por trás de cada lance.
                </h2>
                <p>
                  Crie um perfil, importe seu histórico e ensine a rede a
                  reconhecer suas decisões.
                </p>
                <button onClick={() => setPage("players")}>
                  Começar com um jogador <ArrowUpRight size={17} />
                </button>
                <span className="welcome-knight">♞</span>
              </section>
              <JobList jobs={jobs.slice(0, 8)} onError={setError} />
            </>
          )}
          {page === "players" && (
            <Players
              players={players}
              refresh={refresh}
              onError={setError}
              select={(id) => {
                setPlayerId(id);
                setPage("board");
              }}
            />
          )}
          {page === "import" && (
            <Import
              player={player}
              jobs={jobs}
              refresh={refresh}
              onError={setError}
            />
          )}
          {page === "training" && (
            <Training
              player={player}
              jobs={jobs}
              refresh={refresh}
              onError={setError}
              cuda={health?.cuda || false}
            />
          )}
          {page === "dna" && <DNA player={player} />}
          {page === "compare" && (
            <Compare players={players} onError={setError} />
          )}
          {page === "settings" && (
            <section className="panel settings-panel">
              <h2>Interface e ambiente</h2>
              <label>
                Transparência das setas <strong>{pct(opacity)}</strong>
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step=".05"
                  value={opacity}
                  onChange={(e) => {
                    setOpacity(+e.target.value);
                    localStorage.setItem("arrow-opacity", e.target.value);
                  }}
                />
              </label>
              <div className="setting-row">
                <div>
                  <h3>Dispositivo de treinamento</h3>
                  <p>
                    CPU como padrão. CUDA pode ser selecionada por treinamento.
                  </p>
                </div>
                <span className="pill">
                  <Cpu size={15} />
                  {health?.cuda ? "CPU + CUDA" : "CPU"}
                </span>
              </div>
              <div className="setting-row">
                <div>
                  <h3>Armazenamento local</h3>
                  <p className="storage-path">
                    {health?.storage || "Conectando…"}
                  </p>
                  <p>
                    Para alterar a pasta, defina CHESSMIND_DATA antes de iniciar
                    o servidor.
                  </p>
                </div>
                <Database size={22} />
              </div>
              <div className="setting-row">
                <div>
                  <h3>Aprendizado incremental</h3>
                  <p>
                    Ative “Fine-tuning com replay” no Training Lab após importar
                    novas partidas. O treino reutiliza o histórico de treino com
                    taxa reduzida.
                  </p>
                </div>
              </div>
              <p className="notice">
                PyTorch {health?.torch || "—"} · Nenhuma API comercial é
                necessária. Consulte o README para instalação e integração de
                dados.
              </p>
            </section>
          )}
          <footer>
            <span>Projetado para entender decisões humanas.</span>
            <span>
              CHESS MIND AI <i /> LOCAL FIRST
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function Players({
  players,
  refresh,
  onError,
  select,
}: {
  players: Player[];
  refresh: () => Promise<void>;
  onError: (s: string) => void;
  select: (id: string) => void;
}) {
  const [name, setName] = useState(""),
    [color, setColor] = useState("both"),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<Player | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/players", { name, color });
      setName("");
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="panel create-player" onSubmit={create}>
        <div>
          <h2>Novo perfil</h2>
          <p>Um modelo independente para cada jogador.</p>
        </div>
        <label>
          Nome do perfil
          <input
            required
            maxLength={120}
            placeholder="Ex.: Meu repertório"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Cor analisada
          <select value={color} onChange={(e) => setColor(e.target.value)}>
            {Object.entries(colors).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>
          <Plus size={17} />
          Criar jogador
        </button>
      </form>
      <div className="player-grid">
        {players.map((p) => (
          <section className="panel player-card" key={p.id}>
            <div className="section-heading">
              <div className="avatar large">{p.name[0]}</div>
              <button
                className="icon-button"
                title={`Excluir ${p.name}`}
                onClick={() => setDeleting(p)}
              >
                <Trash2 size={17} />
              </button>
            </div>
            <h2>{p.name}</h2>
            <p>{colors[p.color]}</p>
            <div className="mini-stats">
              <div>
                <small>Partidas</small>
                <strong>{p.games}</strong>
              </div>
              <div>
                <small>Posições</small>
                <strong>{p.positions}</strong>
              </div>
            </div>
            <span className="pill">
              {p.model
                ? `Modelo v${p.model.version}`
                : "Aguardando treinamento"}
            </span>
            <button className="secondary full" onClick={() => select(p.id)}>
              Abrir no tabuleiro <ArrowUpRight size={16} />
            </button>
          </section>
        ))}
      </div>
      {!players.length && (
        <Empty
          title="Seu primeiro jogador começa aqui"
          text="Crie um perfil acima. Nenhum dado de demonstração será adicionado ao seu histórico."
        />
      )}
      {deleting && (
        <div className="modal-backdrop">
          <section className="panel modal">
            <h2>Excluir {deleting.name}?</h2>
            <p>
              O perfil, as partidas e os modelos locais serão removidos
              permanentemente.
            </p>
            <div className="button-row">
              <button
                className="danger"
                onClick={async () => {
                  try {
                    await api("/players/" + deleting.id, { method: "DELETE" });
                    setDeleting(null);
                    await refresh();
                  } catch (e) {
                    onError((e as Error).message);
                  }
                }}
              >
                Excluir perfil e dados
              </button>
              <button className="secondary" onClick={() => setDeleting(null)}>
                Cancelar
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function Import({
  player,
  jobs,
  refresh,
  onError,
}: {
  player?: Player;
  jobs: Job[];
  refresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [pgnText, setPgnText] = useState(""),
    [color, setColor] = useState("both"),
    [auto, setAuto] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!player) return;
    setBusy(true);
    setProgress(0);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (pgnText.trim()) form.append("pgn_text", pgnText);
    form.append("color", color);
    form.append("auto_train", String(auto));
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/players/${player.id}/import`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(e.loaded / e.total);
        };
        xhr.onerror = () =>
          reject(new Error("Falha na conexão durante o envio."));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              reject(new Error(JSON.parse(xhr.responseText).detail));
            } catch {
              reject(new Error("Falha no envio."));
            }
          }
        };
        xhr.send(form);
      });
      setFiles([]);
      setPgnText("");
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="panel import-form" onSubmit={send}>
        <div className="section-heading">
          <h2>Biblioteca de partidas</h2>
          <span className="pill">PGN · processamento em streaming</span>
        </div>
        <label className="dropzone">
          <Upload size={34} />
          <strong>
            {files.length
              ? `${files.length} arquivo(s) selecionado(s)`
              : "Selecione seus arquivos PGN"}
          </strong>
          <span>
            Um ou vários arquivos · sem limite de partidas configurado
          </span>
          <input
            type="file"
            multiple
            accept=".pgn"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
        </label>
        <label>
          Ou cole o conteúdo PGN
          <textarea
            rows={8}
            placeholder={
              '[White "Nome do perfil"]\n[Black "Adversário"]\n\n1. e4 e5 *'
            }
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Cor a considerar
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              {Object.entries(colors).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          O nome <strong>{player?.name || "do perfil selecionado"}</strong> será
          localizado automaticamente em White ou Black. Apenas as jogadas desse
          jogador na cor escolhida entram no treinamento; as respostas do
          adversário permanecem no histórico da posição.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          Iniciar treinamento após a importação
        </label>
        <button
          disabled={!player || (!files.length && !pgnText.trim()) || busy}
        >
          <Upload size={17} />
          {busy ? `Enviando ${pct(progress)}` : "Importar partidas"}
        </button>
        {busy && <progress value={progress} max={1} />}
      </form>
      <JobList
        jobs={jobs.filter(
          (j) => j.player_id === player?.id && j.kind === "import",
        )}
        onError={onError}
      />
    </>
  );
}
function Training({
  player,
  jobs,
  refresh,
  onError,
  cuda,
}: {
  player?: Player;
  jobs: Job[];
  refresh: () => Promise<void>;
  onError: (s: string) => void;
  cuda: boolean;
}) {
  const [config, setConfig] = useState({
      epochs: 5,
      batch_size: 32,
      width: 32,
      blocks: 2,
      history: 16,
      lr: 0.001,
      device: "cpu",
      resume: false,
      incremental: false,
    }),
    [busy, setBusy] = useState(false);
  const mine = jobs.filter(
    (j) => j.player_id === player?.id && j.kind === "training",
  );
  const history: Epoch[] =
    mine.find((j) => j.detail.history?.length)?.detail.history ||
    player?.model?.metrics.history ||
    [];
  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!player) return;
    setBusy(true);
    try {
      await post(`/players/${player.id}/train`, config);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="training-grid">
        <form className="panel" onSubmit={start}>
          <h2>Configurar treinamento</h2>
          <p className="muted">
            Modelo independente · {player?.name || "Selecione um jogador"}
          </p>
          <div className="form-grid">
            {[
              ["epochs", "Épocas", 1, 1000],
              ["batch_size", "Batch size", 1, 256],
              ["blocks", "Blocos residuais", 1, 6],
            ].map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  value={config[key as "epochs"]}
                  onChange={(e) =>
                    setConfig({ ...config, [key]: +e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              Taxa de aprendizado
              <input
                required
                type="number"
                min="0.000001"
                max="0.01"
                step="0.000001"
                value={config.lr}
                onChange={(e) => setConfig({ ...config, lr: +e.target.value })}
              />
            </label>
            <label>
              Canais CNN
              <select
                value={config.width}
                onChange={(e) =>
                  setConfig({ ...config, width: +e.target.value })
                }
              >
                {[16, 32, 64].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Histórico recente
              <select
                value={config.history}
                onChange={(e) =>
                  setConfig({ ...config, history: +e.target.value })
                }
              >
                {[8, 16, 32].map((n) => (
                  <option key={n} value={n}>
                    {n} meios-lances
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dispositivo
              <select
                value={config.device}
                onChange={(e) =>
                  setConfig({ ...config, device: e.target.value })
                }
              >
                <option value="cpu">CPU</option>
                <option value="cuda" disabled={!cuda}>
                  CUDA{!cuda ? " · indisponível" : ""}
                </option>
              </select>
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.resume}
              onChange={(e) =>
                setConfig({
                  ...config,
                  resume: e.target.checked,
                  incremental: false,
                })
              }
            />
            Continuar checkpoint (épocas adicionais)
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.incremental}
              onChange={(e) =>
                setConfig({
                  ...config,
                  incremental: e.target.checked,
                  resume: false,
                })
              }
            />
            Fine-tuning com replay histórico
          </label>
          <p className="fineprint">
            Fine-tuning usa todos os dados de treino e taxa de aprendizado de no
            máximo 0,0001. Validação e teste permanecem separados.
          </p>
          <button
            disabled={
              !player ||
              busy ||
              mine.some((j) =>
                ["queued", "running", "pausing"].includes(j.status),
              )
            }
          >
            <FlaskConical size={17} />
            Iniciar treinamento
          </button>
        </form>
        <section className="panel">
          <div className="section-heading">
            <h2>Evolução do aprendizado</h2>
            <span className="pill">Cross-Entropy</span>
          </div>
          {history.length ? (
            <div className="chart">
              <ResponsiveContainer>
                <LineChart
                  data={history.map((e) => ({
                    epoch: e.epoch,
                    Treino: e.train.loss,
                    Validação: e.validation.loss,
                  }))}
                >
                  <CartesianGrid stroke="#303a34" strokeDasharray="3 3" />
                  <XAxis dataKey="epoch" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Treino" stroke="#c4e994" />
                  <Line type="monotone" dataKey="Validação" stroke="#8bbbe5" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty
              title="O aprendizado deixa rastros"
              text="As curvas aparecem ao concluir a primeira época de treinamento."
            />
          )}
          <h3>Separação por partidas</h3>
          <div className="split-grid">
            {[
              ["train", "Treino"],
              ["validation", "Validação"],
              ["test", "Teste"],
            ].map(([k, v]) => (
              <div key={k}>
                <strong>{player?.splits[k] || 0}</strong>
                <small>{v}</small>
              </div>
            ))}
          </div>
          <p className="fineprint">
            Distribuição estável por hash: 80% / 10% / 10% em expectativa. A
            mesma partida nunca aparece em conjuntos diferentes.
          </p>
        </section>
      </div>
      {player?.model && (
        <section className="panel">
          <div className="section-heading">
            <h2>Avaliação independente · modelo v{player.model.version}</h2>
            <span className="pill">
              Teste · {player.model.metrics.test.positions} posições
            </span>
          </div>
          <div className="metric-grid">
            {(["top1", "top3", "top5", "nll", "brier", "ece"] as const).map(
              (key) => (
                <div key={key}>
                  <small>{key.toUpperCase()}</small>
                  <strong>
                    {key.startsWith("top")
                      ? pct(player.model!.metrics.test[key])
                      : player.model!.metrics.test[key].toFixed(3)}
                  </strong>
                </div>
              ),
            )}
          </div>
          <p className="notice">
            Temperatura ajustada somente na validação. ECE e Brier abaixo são
            medidos no teste independente; confiança não é garantia de acerto.
          </p>
          <div className="chart small-chart">
            <ResponsiveContainer>
              <BarChart
                data={player.model.metrics.test.calibration.filter(
                  (b) => b.count,
                )}
              >
                <XAxis dataKey="confidence" tickFormatter={pct} />
                <YAxis domain={[0, 1]} tickFormatter={pct} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="confidence"
                  name="Confiança média"
                  fill="#91a89a"
                />
                <Bar
                  dataKey="accuracy"
                  name="Acerto observado"
                  fill="#c4e994"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
      <JobList jobs={mine} onError={onError} />
    </>
  );
}
function JobList({
  jobs,
  onError,
}: {
  jobs: Job[];
  onError: (s: string) => void;
}) {
  const labels: Record<string, string> = {
    queued: "Na fila",
    running: "Em execução",
    pausing: "Salvando ao fim da época",
    paused: "Pausado",
    completed: "Concluído",
    failed: "Falhou",
    interrupted: "Interrompido pelo encerramento",
  };
  return (
    <section className="panel jobs">
      <h2>Histórico de processamento</h2>
      {!jobs.length ? (
        <p className="muted">Nenhuma tarefa registrada.</p>
      ) : (
        jobs.map((j) => (
          <div className="job" key={j.id}>
            <div className="job-top">
              <strong>
                {j.kind === "import" ? "Importação PGN" : "Treinamento neural"}
              </strong>
              <span
                className={"pill " + (j.status === "failed" ? "failed" : "")}
              >
                {labels[j.status] || j.status}
              </span>
              {j.kind === "training" && j.status === "running" && (
                <button
                  className="secondary"
                  onClick={() =>
                    post(`/jobs/${j.id}/pause`).catch((e) => onError(e.message))
                  }
                >
                  Pausar após época
                </button>
              )}
            </div>
            {j.detail.error && <p className="error-text">{j.detail.error}</p>}
            {j.kind === "import" && (
              <div className="job-counters">
                {[
                  ["processed", "Lidas"],
                  ["imported", "Importadas"],
                  ["positions", "Posições"],
                  ["skipped", "Ignoradas"],
                  ["duplicates", "Duplicadas"],
                  ["errors", "Erros"],
                ].map(([k, v]) => (
                  <span key={k}>
                    {v}:{" "}
                    <b>
                      {Number(j.detail[k as "processed"] || 0).toLocaleString(
                        "pt-BR",
                      )}
                    </b>
                  </span>
                ))}
              </div>
            )}
            {j.detail.epoch && (
              <p className="muted">
                Época {j.detail.epoch} concluída · checkpoint salvo
              </p>
            )}
            {j.detail.messages?.length ? (
              <details>
                <summary>Detalhes da importação (últimos 20)</summary>
                {j.detail.messages.map((m, i) => (
                  <p key={i} className="error-text">
                    {m}
                  </p>
                ))}
              </details>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
function DNA({ player }: { player?: Player }) {
  const [data, setData] = useState<Record<string, number>>({}),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData({});
    if (player)
      api<{ counts: Record<string, number> }>(`/players/${player.id}/dna`)
        .then((d) => {
          if (live) setData(d.counts);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [player?.id, player?.games]);
  const total = data.moves || 0;
  if (!total)
    return (
      <Empty
        title={error || "Uma identidade construída lance a lance"}
        text="Importe partidas para visualizar as estatísticas observadas do jogador."
      />
    );
  const pieces: Record<string, string> = {
    p: "Peão",
    n: "Cavalo",
    b: "Bispo",
    r: "Torre",
    q: "Dama",
    k: "Rei",
  };
  const openings = Object.entries(data)
    .filter(([k]) => k.startsWith("opening:"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  return (
    <>
      <p className="notice">
        <Check size={16} /> Estatísticas diretamente observadas nos PGNs. Não
        são classificações de personalidade nem interpretações da rede.
      </p>
      <div className="stats-grid">
        {[
          ["Capturas", data.captures / total],
          ["Movimentos de peões", (data["piece:p"] || 0) / total],
          ["Roques por movimento", data.castles / total],
          ["Recapturas imediatas", data.recaptures / total],
        ].map(([label, v]) => (
          <section key={String(label)} className="panel stat">
            <small>{label}</small>
            <strong>{pct(Number(v))}</strong>
          </section>
        ))}
      </div>
      <div className="training-grid">
        <section className="panel">
          <h2>Preferência por peças</h2>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart
                data={Object.entries(pieces).map(([k, name]) => ({
                  name,
                  Movimentos: data["piece:" + k] || 0,
                }))}
              >
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar
                  dataKey="Movimentos"
                  fill="#badb91"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel">
          <h2>Sequências de abertura mais frequentes</h2>
          <p className="muted">
            Primeiros 8 meios-lances · ambos os lados da partida.
          </p>
          {openings.map(([k, v]) => (
            <div className="opening" key={k}>
              <span>{k.slice(8)}</span>
              <b>{v} partida(s)</b>
            </div>
          ))}
        </section>
      </div>
      <section className="panel">
        <h2>Fases e cores</h2>
        <div className="metric-grid">
          {[
            ["phase:opening", "Abertura"],
            ["phase:middlegame", "Meio-jogo"],
            ["phase:endgame", "Final"],
            ["color:white", "Brancas"],
            ["color:black", "Pretas"],
          ].map(([k, v]) => (
            <div key={k}>
              <small>{v}</small>
              <strong>{data[k] || 0}</strong>
            </div>
          ))}
        </div>
        <p className="fineprint">
          Abertura: até lance 10. Depois disso, final: até 12 peças; demais
          posições: meio-jogo. Recaptura: captura do jogador imediatamente após
          captura adversária, sem inferir intenção de troca.
        </p>
      </section>
    </>
  );
}
function Compare({
  players,
  onError,
}: {
  players: Player[];
  onError: (s: string) => void;
}) {
  const [a, setA] = useState(""),
    [b, setB] = useState(""),
    [fen, setFen] = useState(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    ),
    [result, setResult] = useState<
      { san: string; a: number; b: number }[] | null
    >(null),
    [busy, setBusy] = useState(false);
  async function compare(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const [pa, pb] = await Promise.all([
        post<Prediction>(`/players/${a}/predict`, { fen }),
        post<Prediction>(`/players/${b}/predict`, { fen }),
      ]);
      setResult(
        pa.moves
          .map((m) => ({
            san: m.san,
            a: m.probability,
            b: pb.moves.find((x) => x.uci === m.uci)?.probability || 0,
          }))
          .sort((x, y) => y.a + y.b - (x.a + x.b)),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="panel" onSubmit={compare}>
        <h2>Dois jogadores, a mesma posição</h2>
        <div className="form-grid">
          {[
            [a, setA, "Jogador A"],
            [b, setB, "Jogador B"],
          ].map(([value, setter, label]) => (
            <label key={String(label)}>
              {String(label)}
              <select
                required
                value={value as string}
                onChange={(e) => {
                  (setter as (v: string) => void)(e.target.value);
                  setResult(null);
                }}
              >
                <option value="">Selecione um modelo treinado</option>
                {players
                  .filter((p) => p.model)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        <label>
          Posição FEN
          <input
            value={fen}
            onChange={(e) => {
              setFen(e.target.value);
              setResult(null);
            }}
            required
          />
        </label>
        <button disabled={!a || !b || a === b || busy}>
          <GitCompareArrows size={17} />
          {busy ? "Comparando…" : "Comparar probabilidades"}
        </button>
      </form>
      {result && (
        <section className="panel">
          <h2>Distribuição por movimento</h2>
          <table>
            <thead>
              <tr>
                <th>Movimento</th>
                <th>{players.find((p) => p.id === a)?.name}</th>
                <th>{players.find((p) => p.id === b)?.name}</th>
              </tr>
            </thead>
            <tbody>
              {result.map((r) => (
                <tr key={r.san}>
                  <td>{r.san}</td>
                  <td>
                    {pct(r.a)}
                    <div className="bar">
                      <i style={{ width: r.a * 100 + "%" }} />
                    </div>
                  </td>
                  <td>
                    {pct(r.b)}
                    <div className="bar blue">
                      <i style={{ width: r.b * 100 + "%" }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <BrainCircuit size={34} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
