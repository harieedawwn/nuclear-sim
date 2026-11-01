// textures.js - small procedural canvas textures (no downloads).
import * as THREE from 'three';
import { mulberry } from './geo.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

// Soft grey value noise, used as roughness variation (linear data).
export function noiseTexture(size = 256, seed = 7) {
  const c = canvas(size, size), g = c.getContext('2d'), rnd = mulberry(seed);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    const v = 110 + Math.floor(rnd() * 90), r = 1 + rnd() * 10;
    g.fillStyle = `rgba(${v},${v},${v},0.18)`;
    g.beginPath(); g.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2); g.fill();
  }
  return tex(c, false, true);
}

// Flow stripes along pipes: grey base with soft bright bands; material color tints it.
export function flowTexture() {
  const c = canvas(128, 16), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, '#9c9c9c'); grd.addColorStop(0.55, '#9c9c9c');
  grd.addColorStop(0.8, '#ffffff'); grd.addColorStop(0.9, '#e6e6e6'); grd.addColorStop(1, '#9c9c9c');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 16);
  const t = tex(c, true, true);
  return t;
}

// Radial streak disc for rotor motion blur (alpha).
export function blurDiscTexture() {
  const s = 256, c = canvas(s, s), g = c.getContext('2d'), rnd = mulberry(11);
  g.translate(s / 2, s / 2);
  for (let r = 40; r < 126; r += 1) {
    const a = 0.25 + 0.55 * rnd() * (r > 60 ? 1 : (r - 40) / 20);
    g.strokeStyle = `rgba(210,216,222,${(a * 0.6).toFixed(3)})`;
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  }
  return tex(c, true, false);
}

// Soft puff for the cooling-tower plume (alpha in red channel is used by shader).
export function puffTexture() {
  const s = 128, c = canvas(s, s), g = c.getContext('2d'), rnd = mulberry(5);
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x = s / 2 + (rnd() - 0.5) * s * 0.42, y = s / 2 + (rnd() - 0.5) * s * 0.42;
    const r = s * (0.14 + rnd() * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }
  const t = tex(c, false, false);
  return t;
}

// Background: soft vertical sky gradient.
export function skyTexture() {
  const c = canvas(4, 512), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#9DB8CF');
  grd.addColorStop(0.55, '#D4DFE6');
  grd.addColorStop(0.8, '#E9ECEB');
  grd.addColorStop(1, '#EEEDE8');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 512);
  return tex(c, true, false);
}

// Site plan painted on the ground plate. `plan` gives world rectangles/areas, world X,Z extents.
export function groundTexture(W, D, plan) {
  const px = 9.3; // pixels per world unit
  const cw = Math.min(2048, Math.round(W * px)), ch = Math.round(cw * D / W);
  const c = canvas(cw, ch), g = c.getContext('2d'), rnd = mulberry(21);
  const sx = cw / W, sz = ch / D;
  const X = (x) => (x + W / 2) * sx, Z = (z) => (z + D / 2) * sz;
  // grass base with mottling
  g.fillStyle = '#93A27A'; g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 7000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? 'rgba(110,128,86,0.10)' : 'rgba(172,180,128,0.10)';
    const r = 2 + rnd() * 14;
    g.beginPath(); g.arc(rnd() * cw, rnd() * ch, r, 0, Math.PI * 2); g.fill();
  }
  const rect = (r, col) => { g.fillStyle = col; g.fillRect(X(r[0]), Z(r[1]), (r[2] - r[0]) * sx, (r[3] - r[1]) * sz); };
  // gravel
  plan.gravel.forEach((r) => {
    rect(r, '#ABA79D');
    for (let i = 0; i < 1400; i++) {
      const v = 140 + Math.floor(rnd() * 60);
      g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.5)`;
      g.fillRect(X(r[0]) + rnd() * (r[2] - r[0]) * sx, Z(r[1]) + rnd() * (r[3] - r[1]) * sz, 1.6, 1.6);
    }
  });
  // paved concrete with slab joints
  plan.paved.forEach((r) => {
    rect(r, '#CEC9BF');
    g.strokeStyle = 'rgba(120,112,100,0.18)'; g.lineWidth = 1;
    for (let x = Math.ceil(r[0] / 6) * 6; x < r[2]; x += 6) { g.beginPath(); g.moveTo(X(x), Z(r[1])); g.lineTo(X(x), Z(r[3])); g.stroke(); }
    for (let z = Math.ceil(r[1] / 6) * 6; z < r[3]; z += 6) { g.beginPath(); g.moveTo(X(r[0]), Z(z)); g.lineTo(X(r[2]), Z(z)); g.stroke(); }
  });
  // roads
  plan.roads.forEach((r) => {
    rect(r, '#5D6265');
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(X(r[0]) + rnd() * (r[2] - r[0]) * sx, Z(r[1]) + rnd() * (r[3] - r[1]) * sz, 2, 2);
    }
    g.fillStyle = 'rgba(240,238,228,0.85)';
    const horiz = (r[2] - r[0]) > (r[3] - r[1]);
    if (horiz) {
      const zc = Z((r[1] + r[3]) / 2);
      for (let x = r[0] + 1; x < r[2] - 2; x += 5) g.fillRect(X(x), zc - 1, 2.6 * sx, 2);
    } else {
      const xc = X((r[0] + r[2]) / 2);
      for (let z = r[1] + 1; z < r[3] - 2; z += 5) g.fillRect(xc - 1, Z(z), 2, 2.6 * sz);
    }
  });
  // parking bays
  plan.parking.forEach((r) => {
    rect(r, '#666B6E');
    g.strokeStyle = 'rgba(240,238,228,0.8)'; g.lineWidth = 1.5;
    for (let x = r[0] + 1; x < r[2]; x += 3) { g.beginPath(); g.moveTo(X(x), Z(r[1])); g.lineTo(X(x), Z(r[1] + 5)); g.stroke(); }
  });
  // soft ambient occlusion under footprints (circles and rects)
  g.globalCompositeOperation = 'multiply';
  plan.aoCircles.forEach((q) => {
    const cx = X(q[0]), cz = Z(q[1]), r = q[2] * sx;
    const grd = g.createRadialGradient(cx, cz, r * 0.85, cx, cz, r * 1.35);
    grd.addColorStop(0, 'rgba(90,90,90,1)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cz, r * 1.4, 0, Math.PI * 2); g.fill();
  });
  plan.aoRects.forEach((r) => {
    // layered expanding rects approximate a blur (canvas filter is missing on older Safari)
    const pad = 2.6 * sx;
    for (let k = 7; k >= 0; k--) {
      const e = pad * k / 7;
      g.fillStyle = 'rgba(150,150,150,0.16)';
      g.fillRect(X(r[0]) - e, Z(r[1]) - e, (r[2] - r[0]) * sx + e * 2, (r[3] - r[1]) * sz + e * 2);
    }
  });
  g.globalCompositeOperation = 'source-over';
  return tex(c, true, false);
}

// Text sign texture (Vietnamese), drawn with the page font.
export function signTexture(text, sub) {
  const c = canvas(512, 160), g = c.getContext('2d');
  g.fillStyle = '#F4F2EC'; g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#1F3B57'; g.fillRect(0, 0, 18, 160);
  g.fillStyle = '#1F3B57';
  g.font = '600 46px "Be Vietnam Pro", system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 44, sub ? 62 : 80);
  if (sub) { g.fillStyle = '#56636F'; g.font = '400 28px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText(sub, 44, 112); }
  return tex(c, true, false);
}
