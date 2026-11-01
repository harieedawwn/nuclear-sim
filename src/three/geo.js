// geo.js - geometry helpers: colored buckets merged per material, revolved cut-away solids.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// Bucket collects geometries for one material; each part is pre-transformed and vertex-colored.
export class Bucket {
  constructor() { this.list = []; }
  add(geom, color, pos, rot, scale) {
    let g = geom.index ? geom : geom; // keep reference; clone below
    g = g.clone();
    if (pos || rot || scale) {
      _p.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
      _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
      _q.setFromEuler(_e);
      _s.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
      g.applyMatrix4(_m.compose(_p, _q, _s));
    }
    paint(g, color);
    this.list.push(g);
    return g;
  }
  addMatrix(geom, color, matrix) {
    const g = geom.clone().applyMatrix4(matrix);
    paint(g, color);
    this.list.push(g);
    return g;
  }
  build() {
    if (!this.list.length) return null;
    const norm = this.list.map(normalize);
    const anyNonIndexed = norm.some((g) => !g.index);
    const ready = anyNonIndexed ? norm.map((g) => (g.index ? g.toNonIndexed() : g)) : norm;
    const merged = mergeGeometries(ready, false);
    ready.forEach((g) => g.dispose());
    this.list.forEach((g) => g.dispose());
    this.list = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

function normalize(g) {
  const out = new THREE.BufferGeometry();
  const n = g.attributes.position.count;
  out.setAttribute('position', g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  out.setAttribute('normal', g.attributes.normal);
  out.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  out.setAttribute('color', g.attributes.color);
  if (g.index) out.setIndex(g.index);
  return out;
}

export function paint(g, color) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Build a revolved solid between an outer and inner profile [[r,y],...] over angles a0..a1
// (three.js cylinder convention: x = r sin a, z = r cos a). Returns { solid, cut } geometries:
// `cut` holds the two section faces, so they can get a distinct "section" color.
export function revolveSector(outer, inner, a0, a1, seg) {
  const solid = [], cut = [];
  solid.push(surface(outer, a0, a1, seg, false));
  solid.push(surface(inner, a0, a1, seg, true));
  // close the profile ends (rings between outer[i] and inner[i] at first/last point)
  solid.push(ring(outer[0], inner[0], a0, a1, seg));
  solid.push(ring(outer[outer.length - 1], inner[inner.length - 1], a0, a1, seg));
  if (a1 - a0 < Math.PI * 2 - 1e-4) {
    cut.push(section(outer, inner, a0));
    cut.push(section(outer, inner, a1));
  }
  return { solid: mergeGeometries(solid), cut: cut.length ? mergeGeometries(cut) : null };
}

function surface(prof, a0, a1, seg, flip) {
  const pos = [], uv = [], idx = [];
  const cols = seg + 1;
  for (let i = 0; i < prof.length; i++) {
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (a1 - a0) * j / seg;
      pos.push(prof[i][0] * Math.sin(a), prof[i][1], prof[i][0] * Math.cos(a));
      uv.push(j / seg, i / (prof.length - 1));
    }
  }
  for (let i = 0; i < prof.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  return mk(pos, uv, idx);
}

function ring(po, pi, a0, a1, seg) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= seg; j++) {
    const a = a0 + (a1 - a0) * j / seg, s = Math.sin(a), c = Math.cos(a);
    pos.push(po[0] * s, po[1], po[0] * c, pi[0] * s, pi[1], pi[0] * c);
    uv.push(j / seg, 0, j / seg, 1);
  }
  for (let j = 0; j < seg; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  return mk(pos, uv, idx);
}

function section(outer, inner, a) {
  const pos = [], uv = [], idx = [], s = Math.sin(a), c = Math.cos(a);
  for (let i = 0; i < outer.length; i++) {
    pos.push(outer[i][0] * s, outer[i][1], outer[i][0] * c, inner[i][0] * s, inner[i][1], inner[i][0] * c);
    uv.push(0, i / outer.length, 1, i / outer.length);
  }
  for (let i = 0; i < outer.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  return mk(pos, uv, idx);
}

function mk(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// helpers for common profiles
export function wallProfile(r, y0, y1) { return [[r, y0], [r, y1]]; }
export function domeProfile(r, yBase, h, steps) {
  const p = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI / 2;
    p.push([Math.max(r * Math.cos(t), 0.0001), yBase + h * Math.sin(t)]);
  }
  return p;
}

// Box from min/max corners (y up).
export function box(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// Tube along a polyline with rounded corners (radius rc), returns { geom, curve }.
export function pipeCurve(points, rc) {
  const path = new THREE.CurvePath();
  const v = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  let prev = v[0].clone();
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1], b = v[i], c = v[i + 1];
    const d1 = b.clone().sub(a), d2 = c.clone().sub(b);
    const r = Math.min(rc, d1.length() / 2, d2.length() / 2);
    const p1 = b.clone().sub(d1.normalize().multiplyScalar(r));
    const p2 = b.clone().add(d2.normalize().multiplyScalar(r));
    if (prev.distanceTo(p1) > 1e-4) path.add(new THREE.LineCurve3(prev, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    prev = p2;
  }
  path.add(new THREE.LineCurve3(prev, v[v.length - 1]));
  return path;
}

export function tube(path, radius, radial) {
  const len = path.getLength();
  const segs = Math.max(8, Math.round(len * 1.2));
  const g = new THREE.TubeGeometry(path, segs, radius, radial || 10, false);
  // scale u along the length so texture period is constant (one unit of u per 4 world units)
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 4);
  return g;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
