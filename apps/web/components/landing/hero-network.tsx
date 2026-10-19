import type { CSSProperties } from "react";

/**
 * Decorative background for the hero: a quiet network of nodes with signals travelling
 * between them. Pure SVG; signals are hidden for reduced motion.
 */
const NODES: [number, number][] = [
  [120, 150],
  [380, 80],
  [600, 250],
  [860, 130],
  [1100, 260],
  [280, 430],
  [740, 470],
  [1010, 540],
  [500, 640],
];
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 2],
  [2, 6],
  [6, 7],
  [4, 7],
  [5, 8],
  [8, 6],
  [3, 6],
];
// [edge, seconds, delay, reversed]
const SIGNALS: [number, number, number, boolean][] = [
  [1, 3.4, 0, false],
  [2, 4.2, 1.1, false],
  [6, 3.8, 2.2, true],
  [9, 4.6, 0.6, false],
  [7, 5.2, 1.8, true],
  [11, 4.4, 3.0, false],
  [4, 3.6, 2.6, true],
];

function edgePath([a, b]: [number, number], reversed = false): string {
  const [x1, y1] = NODES[reversed ? b : a]!;
  const [x2, y2] = NODES[reversed ? a : b]!;
  const dx = (x2 - x1) * 0.5;
  return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

export function HeroNetwork() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 720"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-70 [mask-image:radial-gradient(ellipse_75%_70%_at_60%_35%,#000_25%,transparent_80%)]"
    >
      <g fill="none" stroke="var(--line-strong)" strokeWidth="1">
        {EDGES.map((e) => (
          <path key={`${e[0]}-${e[1]}`} d={edgePath(e)} />
        ))}
      </g>
      {NODES.map(([x, y], i) => (
        <circle
          key={`${x}-${y}`}
          className="landing-node"
          style={{ "--d": `${(i * 0.37) % 3}s` } as CSSProperties}
          cx={x}
          cy={y}
          r="3"
          fill="var(--fg-faint)"
        />
      ))}
      {SIGNALS.map(([edge, dur, delay, reversed]) => (
        <g key={`${edge}-${delay}`} className="landing-signal">
          <circle r="3.5" fill="var(--accent)">
            <animateMotion
              dur={`${dur}s`}
              begin={`-${delay}s`}
              repeatCount="indefinite"
              path={edgePath(EDGES[edge]!, reversed)}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.45 0 0.55 1"
            />
          </circle>
          <circle r="9" fill="var(--accent)" opacity="0.12">
            <animateMotion
              dur={`${dur}s`}
              begin={`-${delay}s`}
              repeatCount="indefinite"
              path={edgePath(EDGES[edge]!, reversed)}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.45 0 0.55 1"
            />
          </circle>
        </g>
      ))}
    </svg>
  );
}
