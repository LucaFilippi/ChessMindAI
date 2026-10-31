import type { Move } from "./api";
import { pct } from "./api";
export function squarePoint(
  square: string,
  flipped: boolean,
): [number, number] {
  const file = square.charCodeAt(0) - 97,
    rank = Number(square[1]) - 1;
  return flipped
    ? [(7 - file) * 100 + 50, rank * 100 + 50]
    : [file * 100 + 50, (7 - rank) * 100 + 50];
}
export default function Arrows({
  moves,
  flipped,
  opacity,
  selected,
}: {
  moves: Move[];
  flipped: boolean;
  opacity: number;
  selected: string;
}) {
  return (
    <svg
      className="probability-arrows"
      viewBox="0 0 800 800"
      aria-label="Setas de probabilidade"
    >
      <defs>
        {moves.map((m, i) => (
          <marker
            key={m.uci}
            id={"arrow" + i}
            markerWidth="3.5"
            markerHeight="3.5"
            refX="2.8"
            refY="1.75"
            orient="auto"
          >
            <path
              d="M0,0 L3.5,1.75 L0,3.5 Z"
              fill={
                m.probability > 0.3
                  ? "#d2f58c"
                  : m.probability > 0.1
                    ? "#f6ca78"
                    : "#89b9e4"
              }
            />
          </marker>
        ))}
      </defs>
      {[...moves].reverse().map((m, j) => {
        const i = moves.length - 1 - j;
        const [x, y] = squarePoint(m.origin, flipped),
          [a, b] = squarePoint(m.target, flipped);
        const dx = a - x,
          dy = b - y,
          len = Math.hypot(dx, dy);
        const ex = a - (dx / len) * 20,
          ey = b - (dy / len) * 20;
        const highlighted = !selected || selected === m.uci;
        const overlap = moves
          .slice(0, i)
          .filter((v) => v.target === m.target).length;
        return (
          <g key={m.uci} opacity={highlighted ? opacity : 0.13}>
            <line
              x1={x}
              y1={y}
              x2={ex}
              y2={ey}
              stroke={
                m.probability > 0.3
                  ? "#d2f58c"
                  : m.probability > 0.1
                    ? "#f6ca78"
                    : "#89b9e4"
              }
              strokeWidth={5 + 22 * m.probability}
              strokeLinecap="round"
              markerEnd={"url(#arrow" + i + ")"}
            />
            <g
              transform={`translate(${Math.min(758, Math.max(42, a))},${Math.min(775, Math.max(25, b - 25 + overlap * 25))})`}
            >
              <rect
                x="-38"
                y="-16"
                width="76"
                height="27"
                rx="8"
                fill="#101915"
              />
              <text
                textAnchor="middle"
                y="3"
                fill="#fff"
                fontSize="17"
                fontWeight="700"
              >
                {pct(m.probability)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
