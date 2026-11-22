export function surfaceCollisionGeometries(geometry) {
  const { vertices, topFaces, topCount, position, rotation } = geometry;
  if (!topFaces) return [geometry];

  const x = (index) => vertices[index * 3];
  const y = (index) => vertices[index * 3 + 1];
  const z = (index) => vertices[index * 3 + 2];
  const turn = (a, b, c) => (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
  const edgeKey = (a, b) => a * topCount + b;
  const edges = new Map();
  const valleyEdges = new Set();
  const neighbors = [];
  const pieces = [];

  for (let i = 0; i < topFaces.length; i += 3) {
    const points = topFaces.slice(i, i + 3);
    const piece = { points: new Set(points), border: new Map(), parent: null };
    pieces.push(piece);
    points.forEach((a, corner) => {
      const b = points[(corner + 1) % 3];
      const c = points[(corner + 2) % 3];
      piece.border.set(a, b);
      const edge = edges.get(edgeKey(b, a));
      if (!edge) {
        edges.set(edgeKey(a, b), { piece, opposite: c });
        return;
      }
      // A vertex above the neighboring triangle's plane marks a valley.
      const d = edge.opposite;
      const area = turn(a, b, c);
      const planeOffset = (z(d) - z(a)) * area
        - (z(b) - z(a)) * turn(a, d, c)
        - (z(c) - z(a)) * turn(a, b, d);
      if (planeOffset > 1e-9 * area) {
        valleyEdges.add(edgeKey(a, b));
        valleyEdges.add(edgeKey(b, a));
      } else {
        neighbors.push([edge.piece, piece]);
      }
    });
  }

  const root = (piece) => {
    while (piece.parent) piece = piece.parent;
    return piece;
  };
  const mergeBorder = (first, second) => {
    const border = new Map();
    for (const [current, other] of [[first, second], [second, first]]) {
      for (const [a, b] of current) {
        if (other.get(b) === a) {
          if (valleyEdges.has(edgeKey(a, b))) return null;
        } else {
          if (border.has(a)) return null;
          border.set(a, b);
        }
      }
    }
    // The projected footprint must remain a single convex polygon.
    const start = border.keys().next().value;
    let a = start;
    for (let i = 0; i < border.size; i += 1) {
      const b = border.get(a);
      const c = border.get(b);
      if (c === undefined || turn(a, b, c) < -1e-12) return null;
      if (b === start && i !== border.size - 1) return null;
      a = b;
    }
    return a === start ? border : null;
  };

  let changed;
  do {
    changed = false;
    for (const [left, right] of neighbors) {
      const first = root(left);
      const second = root(right);
      if (first === second) continue;
      const border = mergeBorder(first.border, second.border);
      if (!border) continue;
      first.border = border;
      for (const point of second.points) first.points.add(point);
      second.parent = first;
      changed = true;
    }
  } while (changed);

  return pieces.filter((piece) => !piece.parent).map(({ points, border }) => ({
    shape: 'mesh', position, rotation,
    vertices: [...points, ...Array.from(border.keys(), (vertex) => vertex + topCount)]
      .flatMap((vertex) => vertices.slice(vertex * 3, vertex * 3 + 3)),
  }));
}
