import { motion } from "motion/react";
import { duration, panelTransition } from "../../../shared/motion/tokens";
import { useMemo, useRef, type CSSProperties } from "react";
import { useCelebrationBox, useTurnCelebration } from "./turnCelebration";

const FIRST_EDGE_MS = duration.msg * 1000;
const EDGE_GAP_MS = duration.msg * 1000;
const EDGE_DRAW_MS = duration.panel * 1000;
const CHILD_DRAW_MS = duration.msg * 1000;
const INSET = 8;

type Point = { x: number; y: number };

export type ConstellationNode = Point & {
  /** Where its edge starts: the hub, or the node it branched from. */
  from: Point;
  /** When its edge starts drawing. */
  delay: number;
  draw: number;
  child: boolean;
};

export type Constellation = { hub: Point; nodes: ConstellationNode[] };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A lead at the bottom center fans work out to a few agents across the
 * bubble, and a couple of them hand off again. Everything stays inside the
 * bubble so its clipping never cuts a node in half.
 */
export function makeConstellation(
  width: number,
  height: number,
  random: () => number = Math.random,
): Constellation {
  const maxX = Math.max(INSET, width - INSET);
  const maxY = Math.max(INSET, height - INSET);
  const hub = { x: width / 2, y: maxY };
  const count = clamp(Math.round(width / 90), 3, 6);
  // Short single-line bubbles still leave the agents a little above the lead.
  const top = Math.min(maxY, Math.max(INSET, height * 0.35));
  const bottom = Math.max(top, Math.min(maxY - 10, height * 0.7));
  const agents: ConstellationNode[] = Array.from({ length: count }, (_, i) => ({
    x: clamp(((i + 0.2 + random() * 0.6) / count) * width, INSET, maxX),
    y: top + random() * (bottom - top),
    from: hub,
    delay: 0,
    draw: EDGE_DRAW_MS,
    child: false,
  }));
  // Fan out from the center so the lead reads as reaching both ways at once.
  agents.sort((a, b) => Math.abs(a.x - hub.x) - Math.abs(b.x - hub.x));
  agents.forEach((agent, i) => {
    agent.delay = FIRST_EDGE_MS + i * EDGE_GAP_MS;
  });
  const children = agents
    .filter((_, i) => i % 2 === 1)
    .map((parent) => {
      const direction = parent.x < hub.x ? -1 : 1;
      return {
        x: clamp(parent.x + direction * (22 + random() * 18), INSET, maxX),
        y: clamp(parent.y + (random() - 0.5) * 12, top, maxY),
        from: { x: parent.x, y: parent.y },
        delay: parent.delay + parent.draw,
        draw: CHILD_DRAW_MS,
        child: true,
      };
    });
  return { hub, nodes: [...agents, ...children] };
}

/**
 * A one-shot burst inside a freshly sent Orchestrator turn: the lead lights
 * up at the base of the bubble, edges race out to a constellation of agents
 * that pop in and hand off again, then the whole network rises beyond the
 * bubble's top edge.
 */
export function OrchestratorConstellation({
  blockId,
  startedAt,
}: {
  blockId: string;
  startedAt?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { active, opacity, y } = useTurnCelebration(blockId, startedAt);
  const box = useCelebrationBox(ref, active);
  const constellation = useMemo(
    () => (box ? makeConstellation(box.width, box.height) : null),
    [box],
  );

  if (!active) return null;
  return (
    <motion.span aria-hidden ref={ref} className="orchestrator-constellation" style={{ opacity, y }}>
      {box && constellation ? (
        <motion.span className="orchestrator-network" initial={false} animate={{ y: [0, -box.height] }} transition={panelTransition}>
          <svg
            className="orchestrator-edges"
            width={box.width}
            height={box.height}
            viewBox={`0 0 ${box.width} ${box.height}`}
          >
            {constellation.nodes.map((node, index) => {
              const length = Math.hypot(
                node.x - node.from.x,
                node.y - node.from.y,
              );
              const style = {
                "--length": length,
              } as CSSProperties;
              return (
                <g key={index}>
                  <line
                    className="orchestrator-edge"
                    x1={node.from.x}
                    y1={node.from.y}
                    x2={node.x}
                    y2={node.y}
                    style={style}
                  />
                  <line
                    className="orchestrator-pulse"
                    x1={node.from.x}
                    y1={node.from.y}
                    x2={node.x}
                    y2={node.y}
                    style={style}
                  />
                </g>
              );
            })}
          </svg>
          <span
            className="orchestrator-hub"
            style={
              {
                left: constellation.hub.x,
                top: constellation.hub.y,
              } as CSSProperties
            }
          />
          {constellation.nodes.map((node, index) => (
            <span
              key={index}
              className="orchestrator-node"
              data-child={node.child ? "true" : undefined}
              style={
                {
                  left: node.x,
                  top: node.y,
                } as CSSProperties
              }
            />
          ))}
        </motion.span>
      ) : null}
    </motion.span>
  );
}
