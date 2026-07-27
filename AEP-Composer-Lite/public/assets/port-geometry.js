/** Port perimeter placement (parity with NLA Agent Composer lattice canvas). */

const PORT_FLOAT_OFFSET = 16;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalizeAngle(angle) {
  let a = angle;
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function resolvePortAngle(node) {
  const raw = Number(node?.data?.port_angle);
  return Number.isFinite(raw) ? normalizeAngle(raw) : 0;
}

function rectPerimeterPoint(hw, hh, angle) {
  const a = normalizeAngle(angle);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const tx = Math.abs(cos) / Math.max(hw, 1e-6);
  const ty = Math.abs(sin) / Math.max(hh, 1e-6);
  if (tx * hh >= ty * hw) {
    return { x: cos >= 0 ? hw : -hw, y: clamp((sin * hw) / tx, -hh, hh), angle: a };
  }
  return { x: clamp((cos * hh) / ty, -hw, hw), y: sin >= 0 ? hh : -hh, angle: a };
}

function raySegmentIntersect(ox, oy, dx, dy, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const crossDS = dx * sy - dy * sx;
  if (Math.abs(crossDS) < 1e-8) return null;
  const axo = ax - ox;
  const ayo = ay - oy;
  const t = (axo * sy - ayo * sx) / crossDS;
  const u = (axo * dy - ayo * dx) / crossDS;
  if (t <= 1e-8 || u < 0 || u > 1) return null;
  return { t, x: ox + dx * t, y: oy + dy * t };
}

function polygonRayPerimeterPoint(verts, angle) {
  const a = normalizeAngle(angle);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let bestT = Infinity;
  let bestPt = null;
  for (let i = 0; i < verts.length; i++) {
    const p1 = verts[i];
    const p2 = verts[(i + 1) % verts.length];
    const hit = raySegmentIntersect(0, 0, cos, sin, p1.x, p1.y, p2.x, p2.y);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      bestPt = { x: hit.x, y: hit.y };
    }
  }
  return bestPt ? { ...bestPt, angle: a } : rectPerimeterPoint(1, 1, angle);
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) return { x: ax, y: ay, distSq: (px - ax) ** 2 + (py - ay) ** 2 };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = clamp(t, 0, 1);
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { x, y, distSq: (px - x) ** 2 + (py - y) ** 2 };
}

export function shapeFromLayout(layout) {
  if (layout.shape === "funnel") return "funnel";
  if (layout.shape === "diamond") return "diamond";
  if (layout.shape === "rect") return "rect";
  return "rect";
}

export function shapeHalfExtents(layout) {
  return { hw: layout.width / 2, hh: layout.height / 2 };
}

function shapeVertices(shape, hw, hh) {
  const flat = hw * 0.8660254;
  switch (shape) {
    case "diamond":
      return [
        { x: 0, y: -hh },
        { x: hw, y: 0 },
        { x: 0, y: hh },
        { x: -hw, y: 0 },
      ];
    case "funnel": {
      const bottom = hw * 0.36;
      return [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: bottom, y: hh },
        { x: -bottom, y: hh },
      ];
    }
    default:
      return [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ];
  }
}

export function perimeterPoint(shape, hw, hh, angle) {
  if (shape === "rect") return rectPerimeterPoint(hw, hh, angle);
  const verts = shapeVertices(shape, hw, hh);
  return polygonRayPerimeterPoint(verts, angle);
}

export function perimeterNormal(shape, hw, hh, angle) {
  if (shape === "rect") {
    const pt = rectPerimeterPoint(hw, hh, angle);
    if (Math.abs(pt.x) >= hw - 0.01) return { x: pt.x >= 0 ? 1 : -1, y: 0 };
    return { x: 0, y: pt.y >= 0 ? 1 : -1 };
  }
  const verts = shapeVertices(shape, hw, hh);
  const pt = polygonRayPerimeterPoint(verts, angle);
  const len = Math.hypot(pt.x, pt.y) || 1;
  return { x: pt.x / len, y: pt.y / len };
}

export function projectPortAngle(node, layout, worldX, worldY) {
  const { hw, hh } = shapeHalfExtents(layout);
  const shape = shapeFromLayout(layout);
  const cx = node.x + hw;
  const cy = node.y + hh;
  const lx = worldX - cx;
  const ly = worldY - cy;
  if (shape === "rect") {
    if (Math.abs(lx) < 1e-6 && Math.abs(ly) < 1e-6) return 0;
    const absX = Math.abs(lx);
    const absY = Math.abs(ly);
    const tx = absX / Math.max(hw, 1e-6);
    const ty = absY / Math.max(hh, 1e-6);
    let x;
    let y;
    if (tx * hh >= ty * hw) {
      x = lx >= 0 ? hw : -hw;
      y = clamp(ly, -hh, hh);
    } else {
      y = ly >= 0 ? hh : -hh;
      x = clamp(lx, -hw, hw);
    }
    return Math.atan2(y, x);
  }
  const verts = shapeVertices(shape, hw, hh);
  let best = null;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const hit = closestPointOnSegment(lx, ly, a.x, a.y, b.x, b.y);
    if (!best || hit.distSq < best.distSq) best = hit;
  }
  return Math.atan2(best.y, best.x);
}

export function portAngleForKind(node, kind) {
  const base = resolvePortAngle(node);
  return kind === "in" ? normalizeAngle(base + Math.PI) : base;
}

export function portLocalPosition(node, layout, kind) {
  const { hw, hh } = shapeHalfExtents(layout);
  const shape = shapeFromLayout(layout);
  const angle = portAngleForKind(node, kind);
  const pt = perimeterPoint(shape, hw, hh, angle);
  const normal = perimeterNormal(shape, hw, hh, angle);
  const sizeBoost = Math.max(1, Math.min(hw, hh) / 72);
  const offset = PORT_FLOAT_OFFSET * 1.12 * sizeBoost;
  return {
    x: hw + pt.x + normal.x * offset,
    y: hh + pt.y + normal.y * offset,
  };
}

export function portWorldPosition(node, layout, kind) {
  const local = portLocalPosition(node, layout, kind);
  return { x: node.x + local.x, y: node.y + local.y };
}

/** Edge anchor on node perimeter (no port float offset). Matches NLA Agent Composer. */
export function portConnectWorldPosition(node, layout, kind) {
  const { hw, hh } = shapeHalfExtents(layout);
  const shape = shapeFromLayout(layout);
  const angle = portAngleForKind(node, kind);
  const pt = perimeterPoint(shape, hw, hh, angle);
  return {
    x: node.x + hw + pt.x,
    y: node.y + hh + pt.y,
  };
}

export function hitPortAt(nodes, nodeLayoutFn, worldX, worldY, scale = 1) {
  const hitR = 32 / Math.max(scale, 0.35);
  let best = null;
  let bestDist = hitR;
  for (const node of nodes) {
    const layout = nodeLayoutFn(node);
    for (const kind of ["in", "out"]) {
      const p = portWorldPosition(node, layout, kind);
      const d = Math.hypot(p.x - worldX, p.y - worldY);
      if (d <= bestDist) {
        bestDist = d;
        best = { nodeId: node.id, kind, node };
      }
    }
  }
  return best;
}