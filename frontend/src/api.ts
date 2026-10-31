export type Metrics = {
  top1: number;
  top3: number;
  top5: number;
  loss: number;
  nll: number;
  brier: number;
  ece: number;
  positions: number;
  calibration: { count: number; confidence: number; accuracy: number }[];
};
export type Epoch = { epoch: number; train: Metrics; validation: Metrics };
export type Player = {
  id: string;
  name: string;
  color: "white" | "black" | "both";
  games: number;
  positions: number;
  splits: Record<string, number>;
  model: null | {
    version: number;
    games: number;
    positions: number;
    created: string;
    config: { width: number; blocks: number; history: number };
    metrics: {
      validation: Metrics;
      test: Metrics;
      history: Epoch[];
      calibrated: boolean;
      temperature?: number;
    };
  };
};
export type Move = {
  uci: string;
  san: string;
  origin: string;
  target: string;
  piece: string;
  probability: number;
};
export type Prediction = {
  id: number;
  moves: Move[];
  version: number;
  game_over: boolean;
};
export type Job = {
  id: string;
  player_id: string;
  kind: string;
  status: string;
  detail: {
    error?: string;
    history?: Epoch[];
    epoch?: number;
    processed?: number;
    imported?: number;
    positions?: number;
    skipped?: number;
    duplicates?: number;
    errors?: number;
    messages?: string[];
  };
};
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
  }
  return response.json();
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const pct = (n: number) =>
  (n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
