// plant.js - builds the cut-away PWR site. Static parts are merged per material (few draw calls);
// moving parts are separate meshes / InstancedMesh, returned in `dyn` for scene3d.js to animate.
import * as THREE from 'three';
import { Bucket, revolveSector, wallProfile, domeProfile, box, pipeCurve, tube, mulberry } from './geo.js';
import { noiseTexture, flowTexture, blurDiscTexture, groundTexture, signTexture } from './textures.js';

export const W = 220, D = 120;            // ground plate (x, z)
export const VIEW_A = 0.6;                // azimuth the cut planes face (radians, three.js convention)
const CX = -62, CZ = -2;                  // containment centre
const RX = CX, RZ = CZ + 1;               // reactor vessel axis
const SHAFT_Y = 12.8;                     // turbine shaft height
const TX = 80, TZ = -20;                  // cooling tower centre

// palette (restrained, harmonised with the UI)
const C = {
  concrete: '#C9C3B8', concreteDark: '#B4AEA3', cut: '#E6D6C0', liner: '#A9B2B9',
  white: '#E8EBEC', cladding: '#B9C4CB', roof: '#7F8992', steel: '#5D6A74', steelLight: '#8E9AA3',
  yellow: '#D4A12A', casing: '#8EA1B1', casingIn: '#6E7E8B', gen: '#4E6A5F', rotor: '#B9BEC2',
  vessel: '#9AA4AB', vesselIn: '#C8CDD0', fuel: '#A9A79F', copper: '#B98B5E',
  transformer: '#6F7C73', insulator: '#C9B9A4', asphaltObj: '#4A4F52', glass: '#9DB4C2',
  trunk: '#6B5443', leaf: '#6E8F55', conifer: '#4F6F4A', vest: '#E07A2E', pants: '#2F3E52', skin: '#D6A47E'
};
export const FLUID = {
  hot: '#C8553D', cold: '#D39A3A', steam: '#D7DADC', feed: '#4E7FB8', cool: '#3E9A97'
};

const TAU = Math.PI * 2;
const vx = Math.sin(VIEW_A), vz = Math.cos(VIEW_A);           // direction toward the camera
const tx = Math.cos(VIEW_A), tz = -Math.sin(VIEW_A);           // tangent of the cut plane
const HALF0 = VIEW_A + Math.PI / 2, HALF1 = VIEW_A + Math.PI * 1.5;  // back half (kept)

export function buildPlant(opts) {
  const rnd = mulberry(1234);
  const root = new THREE.Group();
  const B = { concrete: new Bucket(), paint: new Bucket(), metal: new Bucket(), glass: new Bucket(),
    soil: new Bucket(), water: new Bucket() };
  const F = { hot: new Bucket(), cold: new Bucket(), steam: new Bucket(), feed: new Bucket(), cool: new Bucket() };
  const dyn = {};
  const disposables = [];
  const noise = noiseTexture(); disposables.push(noise);

  /* ------------------------------------------------------------ materials */
  const std = (o) => { const m = new THREE.MeshStandardMaterial(o); disposables.push(m); return m; };
  const M = {
    concrete: std({ vertexColors: true, roughness: 0.92, roughnessMap: noise, side: THREE.DoubleSide }),
    paint: std({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }),
    metal: std({ vertexColors: true, roughness: 0.34, metalness: 0.8, roughnessMap: noise, side: THREE.DoubleSide }),
    glass: std({ vertexColors: true, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    soil: std({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
    water: std({ vertexColors: true, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.88 })
  };
  const flowTex = flowTexture(); disposables.push(flowTex);
  const FM = {};
  Object.keys(FLUID).forEach((k) => {
    const t = flowTex.clone(); t.needsUpdate = true; disposables.push(t);
    FM[k] = std({ color: FLUID[k], map: t, emissive: FLUID[k], emissiveMap: t, emissiveIntensity: 0.18,
      roughness: k === 'steam' ? 0.5 : 0.4, metalness: 0.05 });
  });
  dyn.flowMats = FM;

  /* ------------------------------------------------------------ ground plate + soil */
  const plan = {
    paved: [[-88, -26, -36, 24], [-36, -20, 38, 20], [33, 1, 42, 13], [-104, 12, -80, 30]],
    gravel: [[42, 12, 72, 40]],
    roads: [[-110, 44, 110, 50], [-41.5, -32, -37.5, 44], [-104, 30, -80, 33], [38, 20, 42, 44]],
    parking: [[-100, 34, -82, 42]],
    aoCircles: [[CX, CZ, 19.5], [TX, TZ, 20]],
    aoRects: [[-36, -14, 32, 14], [-104, 14, -84, 28], [34, 3, 40, 10]]
  };
  const gtex = groundTexture(W, D, plan); disposables.push(gtex);
  const gmat = std({ map: gtex, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), gmat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground';
  disposables.push(ground.geometry);
  root.add(ground);
  dyn.groundTex = gtex;
  soilFaces(B.soil, rnd);

  /* ------------------------------------------------------------ containment */
  const KEEP0 = 1.92, KEEP1 = -0.70 + TAU;    // wall sector kept (front wedge removed)
  const Ro = 19, Ri = 17.6, Hc = 34, Hd = 13;
  {
    const outer = wallProfile(Ro, 0.3, Hc).concat(domeProfile(Ro, Hc, Hd, 14).slice(1));
    const inner = wallProfile(Ri, 0.3, Hc).concat(domeProfile(Ri, Hc, Hd - 1.2, 14).slice(1));
    const r = revolveSector(outer, inner, KEEP0, KEEP1, 64);
    shade(r.solid, C.concrete, (y) => 0.94 + 0.06 * Math.min(1, y / 40));
    B.concrete.list.push(at(r.solid, CX, 0, CZ));
    B.concrete.add(r.cut, C.cut, [CX, 0, CZ]);
    // steel liner
    const lo = wallProfile(Ri - 0.02, 0.3, Hc).concat(domeProfile(Ri - 0.02, Hc, Hd - 1.22, 14).slice(1));
    const li = wallProfile(Ri - 0.12, 0.3, Hc).concat(domeProfile(Ri - 0.12, Hc, Hd - 1.32, 14).slice(1));
    const l = revolveSector(lo, li, KEEP0 + 0.01, KEEP1 - 0.01, 64);
    B.metal.add(l.solid, C.liner, [CX, 0, CZ]);
    // base mat and plinth ring
    B.concrete.add(new THREE.CylinderGeometry(20, 20.4, 2.3, 64), C.concreteDark, [CX, -0.85, CZ]);
    // operating floor (kept sector) and inner floor at grade
    const fl = revolveSector([[Ri - 0.1, 12], [Ri - 0.1, 12.7]], [[6.2, 12], [6.2, 12.7]], KEEP0 + 0.01, KEEP1 - 0.01, 48);
    B.concrete.add(fl.solid, '#B4BAB3', [CX, 0, CZ]);
    if (fl.cut) B.concrete.add(fl.cut, C.cut, [CX, 0, CZ]);
    B.concrete.add(new THREE.CylinderGeometry(Ri - 0.1, Ri - 0.1, 0.3, 64), '#A9AFA8', [CX, 0.3, CZ]);
    // polar crane: ring girder + bridge along azimuth 135deg + trolley
    const rg = revolveSector([[Ri - 0.15, 30.6], [Ri - 0.15, 31.6]], [[Ri - 1.3, 30.6], [Ri - 1.3, 31.6]], KEEP0 + 0.02, KEEP1 - 0.02, 64);
    B.paint.add(rg.solid, C.steelLight, [CX, 0, CZ]);
    const ba = 2.356;
    const bg = box(-0.8, 0, -16.6, 0.8, 1.6, 16.6);
    B.paint.add(bg, C.yellow, [CX + Math.sin(ba) * 1.4, 31.7, CZ + Math.cos(ba) * 1.4], [0, ba, 0]);
    B.paint.add(bg, C.yellow, [CX - Math.sin(ba) * 1.4, 31.7, CZ - Math.cos(ba) * 1.4], [0, ba, 0]);
    B.paint.add(box(-2.4, 0, -1.4, 2.4, 1.2, 1.4), '#C4952A', [CX, 33.3, CZ], [0, ba, 0]);
    B.metal.add(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), '#555', [CX, 30.2, CZ]);
    B.paint.add(box(-0.5, 0, -0.5, 0.5, 0.9, 0.5), C.yellow, [CX, 26.8, CZ]);
    // equipment hatch (outer boss) and personnel airlock at the back
    B.concrete.add(new THREE.CylinderGeometry(3.2, 3.2, 1.2, 32), C.concreteDark, [CX - 13.8, 9, CZ - 13.2], [Math.PI / 2, 0, -0.81]);
    // beacons: housings on the dome
    const domeTop = Hc + Hd;
    dyn.beaconPos = new THREE.Vector3(CX, domeTop + 1.6, CZ);
    B.metal.add(new THREE.CylinderGeometry(0.12, 0.16, 1.6, 8), C.steel, [CX, domeTop + 0.6, CZ]);
  }

  /* ------------------------------------------------------------ biological shield + reactor vessel */
  {
    const sh = revolveSector([[5.6, 0.3], [5.6, 12]], [[3.3, 0.3], [3.3, 12]], HALF0, HALF1, 40);
    B.concrete.add(sh.solid, C.concrete, [RX, 0, RZ]);
    B.concrete.add(sh.cut, C.cut, [RX, 0, RZ]);
    // vessel: bottom head + shell; cut along the view plane
    const vR = 2.4, vT = 0.24;
    const outer = [], inner = [];
    for (let i = 0; i <= 8; i++) {
      const t = -Math.PI / 2 + (i / 8) * Math.PI / 2;
      outer.push([Math.max(0.001, vR * Math.cos(t)), 3 + vR * Math.sin(t)]);
      inner.push([Math.max(0.001, (vR - vT) * Math.cos(t)), 3 + (vR - vT) * Math.sin(t)]);
    }
    outer.push([vR, 13]); inner.push([vR - vT, 13]);
    const v = revolveSector(outer, inner, HALF0, HALF1, 36);
    B.metal.add(v.solid, C.vessel, [RX, 0, RZ]);
    B.concrete.add(v.cut, '#D9C7AE', [RX, 0, RZ]);
    // flange + closure head
    const fo = [[vR + 0.35, 12.6], [vR + 0.35, 13.4]], fi = [[vR - vT, 12.6], [vR - vT, 13.4]];
    const f = revolveSector(fo, fi, HALF0, HALF1, 36);
    B.metal.add(f.solid, C.vessel, [RX, 0, RZ]); B.concrete.add(f.cut, '#D9C7AE', [RX, 0, RZ]);
    const ho = domeProfile(vR, 13.4, 2.0, 8), hi = domeProfile(vR - vT, 13.4, 1.8, 8);
    const h = revolveSector(ho, hi, HALF0, HALF1, 36);
    B.metal.add(h.solid, C.vessel, [RX, 0, RZ]); B.concrete.add(h.cut, '#D9C7AE', [RX, 0, RZ]);
    // core barrel (thin), lower support plate, upper core plate
    const cb = revolveSector([[1.95, 3.1], [1.95, 11.4]], [[1.85, 3.1], [1.85, 11.4]], HALF0, HALF1, 32);
    B.metal.add(cb.solid, C.vesselIn, [RX, 0, RZ]);
    B.metal.add(halfDisc(1.85, 0.25), C.vesselIn, [RX, 3.35, RZ]);
    B.metal.add(halfDisc(1.85, 0.2), C.vesselIn, [RX, 8.4, RZ]);
    // nozzles (stubs) toward the loops
    [[-1, 0], [1, 0]].forEach((d) => {
      B.metal.add(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 16), C.vessel, [RX + d[0] * 2.9, 10.5, RZ - 0.6], [0, 0, Math.PI / 2]);
    });
  }

  // fuel assemblies (instanced; back half only, plus the row on the cut plane)
  {
    const pos = [];
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
      const x = i * 0.36, z = j * 0.36;
      if (x * x + z * z > 1.72 * 1.72) continue;
      if (x * vx + z * vz > 0.05) continue;
      pos.push([x, z, (i + j) & 1]);
    }
    const fg = new THREE.BoxGeometry(0.33, 4.4, 0.33);
    const fmat = std({ color: C.fuel, roughness: 0.42, metalness: 0.55, emissive: '#FF6A2A', emissiveIntensity: 0 });
    const fuel = new THREE.InstancedMesh(fg, fmat, pos.length);
    const m4 = new THREE.Matrix4();
    pos.forEach((p, k) => { m4.makeTranslation(RX + p[0], 3.6 + 2.2, RZ + p[1]); fuel.setMatrixAt(k, m4); });
    fuel.castShadow = false; fuel.receiveShadow = true;
    root.add(fuel); disposables.push(fg);
    dyn.fuelMat = fmat;

    // control rods + drive shafts + handle in one group that moves with rodPos
    const rods = new THREE.Group();
    const rodSpots = pos.filter((p) => p[2] === 0);
    const rodG = new THREE.CylinderGeometry(0.07, 0.07, 4.3, 8);
    rodG.translate(0, 2.15, 0);
    const shaftG = new THREE.CylinderGeometry(0.035, 0.035, 12, 6);
    shaftG.translate(0, 4.3 + 6, 0);
    const rodGeo = mergeSimple([rodG, shaftG]);
    const rmat = std({ color: '#3E464D', roughness: 0.38, metalness: 0.7 });
    const rodMesh = new THREE.InstancedMesh(rodGeo, rmat, rodSpots.length);
    rodSpots.forEach((p, k) => { m4.makeTranslation(RX + p[0], 0, RZ + p[1]); rodMesh.setMatrixAt(k, m4); });
    rods.add(rodMesh);
    // spider + lifting handle (amber), visibly travels with the rods
    const hmat = std({ color: '#D9A21E', roughness: 0.4, metalness: 0.25, emissive: '#D9A21E', emissiveIntensity: 0.08 });
    const handle = new THREE.Mesh(mergeSimple([
      box(-2.1, 17.2, -0.22, 2.1, 17.6, 0.22),
      box(-0.22, 17.2, -2.1, 0.22, 17.6, 2.1),
      new THREE.CylinderGeometry(0.16, 0.16, 2.4, 10).translate(0, 18.6, 0),
      new THREE.TorusGeometry(0.75, 0.16, 10, 28).rotateX(Math.PI / 2).translate(0, 19.9, 0)
    ]), hmat);
    handle.position.set(RX, 0, RZ);
    handle.castShadow = true;
    rods.add(handle);
    rods.position.y = 3.6;               // rodPos 0: rod bottoms at the core bottom
    root.add(rods);
    disposables.push(rodGeo, handle.geometry, rodG, shaftG);
    dyn.rods = rods; dyn.rodTravel = 4.2; dyn.handleMat = hmat;
    dyn.handleAnchor = new THREE.Vector3(RX, 3.6 + 19.9, RZ);

    // CRDM housings on the head (back half), static
    const crdmG = mergeSimple([
      new THREE.CylinderGeometry(0.17, 0.17, 5.2, 8).translate(0, 2.6, 0),
      new THREE.CylinderGeometry(0.24, 0.24, 1.3, 8).translate(0, 3.6, 0)
    ]);
    pos.forEach((p) => {
      if (p[2] !== 0) return;
      const d = Math.hypot(p[0], p[1]);
      const yb = 13.4 + 2.0 * Math.sqrt(Math.max(0, 1 - (d / 2.4) ** 2));
      B.metal.add(crdmG, '#7C868E', [RX + p[0], yb - 0.2, RZ + p[1]]);
    });
    crdmG.dispose();
    // core water: Cherenkov glow (emissive, scaled by thermal power)
    const cw = new THREE.Mesh(halfCyl(1.84, 6.0), std({ color: '#2F6FA8', emissive: '#4C9BE8', emissiveIntensity: 0.6,
      roughness: 0.1, transparent: true, opacity: 0.38, depthWrite: false }));
    cw.position.set(RX, 3.4, RZ);
    cw.renderOrder = 2;
    root.add(cw);
    dyn.coreWater = cw.material;
    // danger outline: back-face hull around the vessel
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 14.5, 40, 1, false),
      new THREE.MeshBasicMaterial({ color: '#C62828', side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }));
    hull.position.set(RX, 8.2, RZ); hull.visible = false;
    root.add(hull); disposables.push(hull.geometry, hull.material);
    dyn.hull = hull;
  }

  /* ------------------------------------------------------------ steam generators, pressurizer, pumps, loops */
  const SG = [[CX - 11, CZ - 6], [CX + 11, CZ - 6]];
  const bubbleSpots = [];
  SG.forEach((s, idx) => {
    const t = 0.16;
    const out = [[0.001, 7.6], [0.9, 7.8], [1.5, 8.4], [1.7, 9.4], [1.7, 20], [2.5, 22], [2.5, 27.4]]
      .concat(domeProfile(2.5, 27.4, 1.6, 6).slice(1));
    const inn = out.map((p, i) => [Math.max(0.001, p[0] - t), p[1] + (i === 0 ? t : (i >= out.length - 6 ? -t * (i - (out.length - 7)) / 6 : 0))]);
    const g = revolveSector(out, inn, HALF0, HALF1, 32);
    B.paint.add(g.solid, C.white, [s[0], 0, s[1]]);
    B.concrete.add(g.cut, C.cut, [s[0], 0, s[1]]);
    // tube sheet
    B.metal.add(halfDisc(1.55, 0.4), '#8C949A', [s[0], 10, s[1]]);
    // U-tube bundle: nested U's in planes parallel to the cut
    [-0.12, -0.55, -0.95].forEach((dd, layer) => {
      const wmax = Math.sqrt(Math.max(0.1, 1.45 * 1.45 - dd * dd));
      for (let k = 0; k < 6 - layer; k++) {
        const w = wmax * (0.2 + 0.8 * k / 5);
        const top = 18.6 + w * 0.15;
        const pts = [];
        pts.push([-w, 10.2], [-w, top - w * 0.6]);
        for (let a = 1; a < 12; a++) { const th = Math.PI - (a / 12) * Math.PI; pts.push([w * Math.cos(th), top - w * 0.6 + w * 0.6 * Math.sin(th)]); }
        pts.push([w, top - w * 0.6], [w, 10.2]);
        const path = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(
          s[0] + tx * q[0] + vx * dd, q[1], s[1] + tz * q[0] + vz * dd)));
        B.metal.add(new THREE.TubeGeometry(path, 32, 0.06, 5, false), C.copper);
      }
    });
    // separators and dryers in the upper shell
    [-1.2, 0, 1.2].forEach((o) => {
      B.metal.add(new THREE.CylinderGeometry(0.42, 0.42, 3.2, 12), '#9AA2A8', [s[0] + tx * o - vx * 0.6, 23.4, s[1] + tz * o - vz * 0.6]);
    });
    B.metal.add(box(-1.9, 26, -0.6, 1.9, 26.8, 0.6), '#8F979D', [s[0] - vx * 0.9, 0, s[1] - vz * 0.9], [0, VIEW_A, 0]);
    // water inside lower shell (back half), visible level near the cone
    const wtr = halfCyl(1.53, 11.2);
    B.water.add(wtr, '#7FA9BC', [s[0], 10.4, s[1]]);
    // support legs
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach((d) => {
      B.paint.add(box(-0.2, 0.3, -0.2, 0.2, 8.6, 0.2), C.steel, [s[0] + d[0] * 1.2, 0, s[1] + d[1] * 1.2]);
    });
    for (let k = 0; k < 40; k++) bubbleSpots.push([s[0], s[1], idx, k]);
  });
  dyn.sgPositions = SG;

  // pressurizer
  const PZ = [CX - 7, CZ + 6];
  B.paint.add(new THREE.CylinderGeometry(1.3, 1.3, 9, 24), C.white, [PZ[0], 17.5, PZ[1]]);
  B.paint.add(new THREE.SphereGeometry(1.3, 24, 12, 0, TAU, 0, Math.PI / 2), C.white, [PZ[0], 22, PZ[1]]);
  B.paint.add(new THREE.SphereGeometry(1.3, 24, 12, 0, TAU, Math.PI / 2, Math.PI / 2), C.white, [PZ[0], 13, PZ[1]]);
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach((d) => B.paint.add(box(-0.15, 0.3, -0.15, 0.15, 12.2, 0.15), C.steel, [PZ[0] + d[0] * 0.9, 0, PZ[1] + d[1] * 0.9]));
  // reactor coolant pumps
  const PUMPS = [[CX - 13, CZ + 2], [CX + 13, CZ + 2]];
  PUMPS.forEach((p) => {
    B.paint.add(new THREE.CylinderGeometry(1.0, 1.15, 2.4, 20), '#9AA4AB', [p[0], 7.4, p[1]]);
    B.paint.add(new THREE.CylinderGeometry(0.95, 0.95, 3.6, 20), '#59707F', [p[0], 10.4, p[1]]);
    B.paint.add(new THREE.CylinderGeometry(0.7, 0.95, 0.6, 20), '#59707F', [p[0], 12.5, p[1]]);
    B.paint.add(box(-1.4, 0.3, -1.4, 1.4, 6.2, 1.4), C.concreteDark, [p[0], 0, p[1]]);
  });

  // primary loops: hot legs (vessel -> SG inlet), cold legs (SG outlet -> pump -> vessel)
  const flowPaths = { hot: [], cold: [], steam: [], feed: [], cool: [] };
  const P = (k, pts, r) => { const c = pipeCurve(pts, 1.2); F[k].add(tube(c, r || 0.55, 12), '#ffffff'); flowPaths[k].push(c); return c; };
  [-1, 1].forEach((d, i) => {
    const s = SG[i], pmp = PUMPS[i];
    P('hot', [[RX + d * 3.4, 10.5, RZ - 0.6], [s[0] - d * 3.6, 10.5, RZ - 0.6], [s[0] - d * 0.4, 9.2, s[1] + 0.6], [s[0], 8.2, s[1]]]);
    P('cold', [[s[0] + d * 0.5, 7.9, s[1] + 0.4], [s[0] + d * 0.8, 6.6, s[1] + 2.2], [pmp[0], 6.6, pmp[1] - 2.4], [pmp[0], 6.6, pmp[1]]]);
    P('cold', [[pmp[0] - d * 1.0, 7.4, pmp[1]], [RX + d * 4.6, 7.4, pmp[1]], [RX + d * 3.4, 10.5, RZ + 0.5]]);
  });
  P('hot', [[PZ[0], 12.2, PZ[1]], [PZ[0], 11.2, PZ[1]], [PZ[0], 11.2, RZ - 0.6], [RX - 5.4, 10.6, RZ - 0.6]], 0.22);

  /* ------------------------------------------------------------ secondary: steam, feedwater */
  P('steam', [[SG[0][0], 29.0, SG[0][1]], [SG[0][0], 31.2, SG[0][1]], [SG[0][0], 31.2, -13.5], [-40, 31.2, -13.5], [-40, 17, -13.5], [-30, 17, -12], [-29, 15.5, -1.6], [-27.6, 13.6, -1.2]], 0.7);
  P('steam', [[SG[1][0], 29.0, SG[1][1]], [SG[1][0], 31.2, SG[1][1]], [SG[1][0], 31.2, -13.5]], 0.7);
  P('steam', [[-21, 15.6, 0], [-21, 17.6, 0], [-10, 17.6, -2.4], [-10, 15.6, -2.4]], 0.5);
  P('steam', [[-19, 15.6, 0.6], [-19, 18.4, 0.6], [4, 18.4, 0.6], [4, 15.6, 0.6]], 0.5);
  P('feed', [[-6, 2.0, 7.8], [-30, 2.0, 7.8], [-33, 2.0, -16], [-52, 2.0, -16], [-52, 2.0, -14], [-52, 22.0, -14], [SG[1][0], 22.0, SG[1][1] - 2.5]], 0.42);
  P('feed', [[-52, 22.0, -14], [-52, 24.4, -14], [SG[0][0], 24.4, -14], [SG[0][0], 22.0, SG[0][1] - 2.5]], 0.42);

  /* ------------------------------------------------------------ turbine hall */
  const HX0 = -36, HX1 = 32, HZ0 = -14, HZ1 = 14, HH = 26;
  {
    // columns
    for (let x = HX0; x <= HX1 + 0.1; x += 6.8) {
      B.paint.add(box(-0.35, 0, -0.35, 0.35, HH, 0.35), C.steel, [x, 0, HZ0 + 0.38]);
      const corner = x < HX0 + 0.1 || x > HX1 - 0.2;
      B.paint.add(box(-0.35, 0, -0.35, 0.35, corner ? HH : 1.46, 0.35), C.steel, [x, 0, HZ1 - 0.42]);
      if (!corner) B.concrete.add(box(-0.37, 1.46, -0.37, 0.37, 1.52, 0.37), C.cut, [x, 0, HZ1 - 0.42]);
      B.paint.add(box(-0.3, 21.4, HZ0 + 0.7, 0.3, 22.0, HZ0 + 1.6), C.steel, [x, 0, 0]);
    }
    // back wall: cladding, window band with mullions
    B.paint.add(box(HX0, 0, HZ0 - 0.3, HX1, 14.5, HZ0), C.cladding);
    B.paint.add(box(HX0, 21, HZ0 - 0.3, HX1, HH, HZ0), C.cladding);
    B.glass.add(box(HX0, 14.5, HZ0 - 0.18, HX1, 21, HZ0 - 0.12), C.glass);
    for (let x = HX0; x <= HX1; x += 2.27) B.paint.add(box(-0.08, 14.5, HZ0 - 0.32, 0.08, 21, HZ0 + 0.02), '#4E5A63', [x, 0, 0]);
    B.paint.add(box(HX0, 17.7, HZ0 - 0.32, HX1, 17.85, HZ0 + 0.02), '#4E5A63');
    // horizontal cladding seams
    for (let y = 2.5; y < 14.5; y += 2.4) B.paint.add(box(HX0, y, HZ0 + 0.012, HX1, y + 0.06, HZ0 + 0.03), '#A6B1B8');
    // left end wall (full) with gable, right end wall only at the back (section)
    B.paint.add(box(HX0 - 0.3, 0, HZ0, HX0, HH, HZ1), C.cladding);
    B.paint.add(gable(HZ0, HZ1, HH, 3.2), C.cladding, [HX0 - 0.15, 0, 0]);
    B.paint.add(box(HX1, 0, HZ0, HX1 + 0.3, HH, -1.5), C.cladding);
    B.concrete.add(box(HX1 - 0.02, 0, -1.5, HX1 + 0.32, HH, -1.2), C.cut);
    // front wall: only a low plinth (cut away above)
    B.concrete.add(box(HX0, 0, HZ1 - 0.3, HX1, 1.2, HZ1 + 0.03), C.concreteDark);
    B.concrete.add(box(HX0 - 0.01, 1.2, HZ1 - 0.31, HX1 + 0.01, 1.4, HZ1 + 0.04), C.cut);
    // roof panels over the back half, trusses everywhere
    const rise = 3.2, rz = (z) => HH + rise * (1 - Math.abs(z) / HZ1);
    {
      const g = new THREE.PlaneGeometry(HX1 - HX0 + 0.6, Math.hypot(HZ1 - 1, rise * (HZ1 - 1) / HZ1));
      g.rotateX(-Math.PI / 2 - Math.atan2(rise, HZ1));
      B.paint.add(g, C.roof, [(HX0 + HX1) / 2, (rz(HZ0) + rz(-1)) / 2 + 0.25, (HZ0 + -1) / 2]);
    }
    for (let x = HX0; x <= HX1 + 0.1; x += 6.8) trussZ(B.paint, x, HZ0, HZ1, HH, rise, C.steelLight);
    // purlins on the open front half
    B.paint.add(box(HX0, HH - 0.6, HZ1 - 0.6, HX1, HH, HZ1), C.steel);
    for (let z = 5; z < HZ1; z += 6) B.paint.add(box(HX0, rz(z) + 0.1, z - 0.08, HX1, rz(z) + 0.3, z + 0.08), C.steelLight);
    // crane rails and overhead crane
    B.metal.add(box(HX0, 22.0, HZ0 + 1.0, HX1, 22.3, HZ0 + 1.3), '#4E5A63');
    B.paint.add(box(-0.35, 22.3, HZ0 + 0.8, 0.35, 23.4, HZ1 - 1.2), C.yellow, [-31.6, 0, 0]);
    B.paint.add(box(-0.35, 22.3, HZ0 + 0.8, 0.35, 23.4, HZ1 - 1.2), C.yellow, [-29.6, 0, 0]);
    B.paint.add(box(-32.0, 23.4, -4.0, -29.2, 24.3, -1.0), '#C4952A');
    B.metal.add(box(-30.66, 19.6, -2.56, -30.54, 23.4, -2.44), '#444');
    B.paint.add(box(-31.0, 18.9, -3.0, -30.2, 19.6, -2.0), C.yellow);
    // turbine deck: slab and pedestal columns, condenser underneath
    B.concrete.add(box(HX0 + 0.3, 9.3, HZ0 + 0.3, HX1 - 0.3, 10, 4.6), C.concrete);
    B.concrete.add(box(HX0 + 0.3, 9.3, 4.6, HX1 - 0.3, 10, 4.75), C.cut);
    for (let x = -32; x <= 28; x += 7.5) for (const z of [-11, -6, 3.4]) B.concrete.add(box(x - 0.6, 0, z - 0.6, x + 0.6, 9.3, z + 0.6), C.concreteDark);
    B.paint.add(box(-16.5, 0.3, -5.2, 10.5, 8.8, 2.8), '#7E98A6');
    for (let x = -15.5; x < 10.5; x += 2.2) B.paint.add(box(x, 0.3, 2.8, x + 0.1, 8.8, 2.86), '#6C8592');
    B.paint.add(box(-16.5, 8.8, -5.2, 10.5, 9.3, 2.8), '#6C8592');
    // deck railing along the front edge
    railing(B.metal, HX0 + 1, HX1 - 1, 4.5, 10, '#C9A23A');
    // stair from grade to deck
    for (let k = 0; k < 18; k++) B.concrete.add(box(25 + k * 0.32, 0, 5, 25.35 + k * 0.32, 0.55 + k * 0.53, 7), C.concreteDark);
    railingX(B.metal, 25, 30.8, 7.1, 0.9, 10.4, '#C9A23A');
    // feedwater heaters and pumps at grade
    [-30, -21, -12].forEach((x) => {
      B.paint.add(new THREE.CylinderGeometry(1.1, 1.1, 7, 20), '#9FAEB8', [x, 2.2, 9.4], [0, 0, Math.PI / 2]);
      B.paint.add(box(x - 2.6, 0, 8.8, x - 2.0, 1.2, 10), C.steel); B.paint.add(box(x + 2.0, 0, 8.8, x + 2.6, 1.2, 10), C.steel);
    });
    [-3, 2].forEach((x) => {
      B.paint.add(box(x - 1, 0, 9, x + 1, 1.1, 11), C.concreteDark);
      B.paint.add(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 16), '#3F6F9A', [x, 1.7, 10], [0, 0, Math.PI / 2]);
      B.paint.add(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 16), '#3B4B57', [x + 1.4, 1.7, 10], [0, 0, Math.PI / 2]);
    });
  }

  // turbine casings (cut: front-top quadrant removed), generator, exciter
  const TURB = [
    { x0: -27, x1: -19, r: 2.0 }, { x0: -15, x1: -5, r: 3.0 }, { x0: -1, x1: 9, r: 3.0 }
  ];
  TURB.forEach((t) => {
    const len = t.x1 - t.x0, mid = (t.x0 + t.x1) / 2;
    const prof = [[t.r * 0.8, -len / 2], [t.r, -len / 2 + len * 0.18], [t.r, len / 2 - len * 0.18], [t.r * 0.8, len / 2]];
    const inner = prof.map((p) => [p[0] - 0.18, p[1]]);
    const g = revolveSector(prof, inner, 0, Math.PI * 1.5, 40);
    const rot = [0, 0, -Math.PI / 2];
    B.paint.add(g.solid, C.casing, [mid, SHAFT_Y, 0], rot);
    B.concrete.add(g.cut, C.cut, [mid, SHAFT_Y, 0], rot);
    // horizontal joint flange and feet
    B.paint.add(box(t.x0 + 0.4, SHAFT_Y - 0.15, -t.r - 0.35, t.x1 - 0.4, SHAFT_Y + 0.15, -t.r + 0.1), C.casingIn);
    B.paint.add(box(t.x0 + 0.6, 10, -t.r * 0.8, t.x1 - 0.6, SHAFT_Y - t.r * 0.55, t.r * 0.8), C.casingIn);
  });
  B.paint.add(new THREE.CylinderGeometry(2.3, 2.3, 9, 36), C.gen, [17.5, SHAFT_Y, 0], [0, 0, Math.PI / 2]);
  for (let x = 13.6; x <= 21.4; x += 1.3) B.paint.add(new THREE.CylinderGeometry(2.42, 2.42, 0.22, 36), '#44594F', [x, SHAFT_Y, 0], [0, 0, Math.PI / 2]);
  B.paint.add(box(13, 10, -2.4, 22, 11.2, 2.4), '#3E5249');
  B.paint.add(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 24), C.gen, [24, SHAFT_Y, 0], [0, 0, Math.PI / 2]);
  // isolated phase bus to transformer
  B.paint.add(box(22, 14.6, -0.7, 37, 15.8, 0.7), '#7C8890');
  B.paint.add(box(36.2, 7.2, -0.7, 37.4, 15.8, 0.7), '#7C8890');
  // bearing pedestals
  [-28.5, -17, -3, 11, 22.8].forEach((x) => B.paint.add(box(x - 0.6, 10, -1.2, x + 0.6, SHAFT_Y - 0.2, 1.2), '#5C6B76'));

  // rotor (shaft + bladed stages + couplings), one mesh spinning around x
  {
    const parts = [];
    parts.push(new THREE.CylinderGeometry(0.34, 0.34, 54, 16).rotateZ(Math.PI / 2).translate(-1.5, 0, 0));
    const stage = (x, rIn, rOut, n, w) => {
      parts.push(new THREE.CylinderGeometry(rIn, rIn, w * 0.6, 24).rotateZ(Math.PI / 2).translate(x, 0, 0));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const b = new THREE.BoxGeometry(w * 0.7, rOut - rIn, 0.05);
        b.translate(0, (rIn + rOut) / 2, 0); b.rotateY(0.6); b.rotateX(a); b.translate(x, 0, 0);
        parts.push(b);
      }
    };
    const stages = [];
    for (let k = 0; k < 5; k++) stages.push([-25.8 + k * 1.4, 0.8, 1.25 + k * 0.08, 0.45]);
    for (const c of [-10, 4]) for (let k = 0; k < 4; k++) {
      stages.push([c - 0.9 - k * 1.05, 1.0, 1.6 + k * 0.28, 0.5]);
      stages.push([c + 0.9 + k * 1.05, 1.0, 1.6 + k * 0.28, 0.5]);
    }
    stages.forEach((s) => stage(s[0], s[1], s[2], 30, s[3]));
    // couplings with painted index marks (make rotation readable)
    const marks = [];
    [-17, -3, 11].forEach((x) => {
      parts.push(new THREE.CylinderGeometry(0.75, 0.75, 0.7, 24).rotateZ(Math.PI / 2).translate(x, 0, 0));
      marks.push(box(x - 0.36, 0.55, -0.16, x + 0.36, 0.78, 0.16));
    });
    const rotorG = mergeSimple(parts);
    const markG = mergeSimple(marks);
    const rotor = new THREE.Group();
    const rm = new THREE.Mesh(rotorG, std({ color: C.rotor, roughness: 0.3, metalness: 0.85 }));
    const mm = new THREE.Mesh(markG, std({ color: '#C8553D', roughness: 0.5 }));
    rotor.add(rm, mm);
    rotor.position.set(0, SHAFT_Y, 0);
    root.add(rotor);
    disposables.push(rotorG, markG);
    parts.forEach((p) => p.dispose());
    dyn.rotor = rotor; dyn.rotorBlades = rm;
    // motion blur discs (one merged mesh, opacity follows rpm)
    const discs = [];
    stages.forEach((s) => discs.push(new THREE.RingGeometry(s[1], s[2], 40, 1).rotateY(Math.PI / 2).translate(s[0], 0, 0)));
    const blurTex = blurDiscTexture(); disposables.push(blurTex);
    const dg = mergeSimple(discs);
    // planar UVs from local y/z so the radial texture maps onto every ring
    const pa = dg.attributes.position, uva = dg.attributes.uv;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i), z = pa.getZ(i), r = Math.hypot(y, z), rr = r / 3.0;
      uva.setXY(i, 0.5 + 0.49 * (y / (r || 1)) * Math.min(1, rr), 0.5 + 0.49 * (z / (r || 1)) * Math.min(1, rr));
    }
    const blur = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: blurTex, color: '#cfd5da', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    blur.position.copy(rotor.position);
    blur.renderOrder = 3;
    root.add(blur);
    disposables.push(dg, blur.material);
    dyn.blur = blur;
  }

  /* ------------------------------------------------------------ cooling water + tower */
  P('cool', [[10.5, 2.4, -3.6], [30, 2.4, -3.6], [50, 2.4, -8], [64, 2.4, -14], [64, 5.6, -14]], 0.85);
  P('cool', [[61.4, 0.9, -12.6], [47, 0.9, -1.6], [30, 0.9, -1.0], [10.5, 0.9, -1.0]], 0.85);
  {
    const a = 10.5, yt = 40, c = 23.21, yb = 5, ytop = 50;
    const rAt = (y) => a * Math.sqrt(1 + ((y - yt) / c) ** 2);
    const outer = [], inner = [];
    for (let i = 0; i <= 24; i++) {
      const y = yb + (ytop - yb) * i / 24;
      outer.push([rAt(y), y]); inner.push([rAt(y) - 0.45, y]);
    }
    const g = revolveSector(outer, inner, 0, TAU, 72);
    shade(g.solid, '#CFCAC0', (y) => (y < 8 ? 0.86 + 0.05 * (y - 5) : 1) * (y > 48 ? 0.9 : 1) * (0.97 + 0.03 * Math.sin(y * 0.7)));
    B.concrete.list.push(at(g.solid, TX, 0, TZ));
    // top ring beam and base ring beam
    B.concrete.add(new THREE.TorusGeometry(rAt(ytop) - 0.2, 0.35, 8, 72).rotateX(Math.PI / 2), '#BDB7AC', [TX, ytop, TZ]);
    B.concrete.add(new THREE.TorusGeometry(rAt(yb) - 0.2, 0.5, 8, 72).rotateX(Math.PI / 2), '#B3ADA2', [TX, yb, TZ]);
    // diagonal column pairs
    const n = 36, legG = new THREE.CylinderGeometry(0.28, 0.32, 1, 6);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU, a1 = a0 + TAU / n;
      for (const [aa, ab] of [[a0, a1], [a1, a0]]) {
        const p0 = new THREE.Vector3(TX + Math.sin(aa) * (rAt(yb) + 0.4), 0, TZ + Math.cos(aa) * (rAt(yb) + 0.4));
        const p1 = new THREE.Vector3(TX + Math.sin(ab) * rAt(yb), yb, TZ + Math.cos(ab) * rAt(yb));
        B.concrete.addMatrix(legG, '#C2BCB1', strut(p0, p1));
      }
    }
    legG.dispose();
    // basin wall and water
    const RB = rAt(yb);
    const bw = revolveSector([[RB + 1.6, 0], [RB + 1.6, 1.1]], [[RB + 0.9, 0], [RB + 0.9, 1.1]], 0, TAU, 72);
    B.concrete.add(bw.solid, '#B8B2A7', [TX, 0, TZ]);
    B.water.add(new THREE.CircleGeometry(RB + 0.9, 72).rotateX(-Math.PI / 2), '#6E98A2', [TX, 0.62, TZ]);
    // fill pack under the shell (dark band seen through the columns)
    B.paint.add(new THREE.CylinderGeometry(RB - 1.4, RB - 1.4, 1.2, 64, 1, true), '#4C5652', [TX, 4.4, TZ]);
    dyn.towerTop = new THREE.Vector3(TX, ytop, TZ);
    dyn.towerTopR = rAt(ytop) - 0.6;
    dyn.towerCenter = [TX, TZ];
  }

  /* ------------------------------------------------------------ transformer, switchyard, transmission */
  const lineCurves = [];
  {
    // main transformer
    B.concrete.add(box(33.5, 0, 2.5, 40.5, 0.5, 11.5), C.concreteDark);
    B.paint.add(box(34.5, 0.5, 4, 39.5, 6, 10), C.transformer);
    for (let z = 4.3; z < 10; z += 0.55) B.paint.add(box(39.5, 1, z, 40.6, 5.4, z + 0.12), '#66736A');
    for (let z = 4.3; z < 10; z += 0.55) B.paint.add(box(33.4, 1, z, 34.5, 5.4, z + 0.12), '#66736A');
    B.paint.add(new THREE.CylinderGeometry(0.7, 0.7, 4.6, 16), C.transformer, [37, 7.0, 9.4], [Math.PI / 2, 0, 0]);
    const bush = [];
    [5.4, 7, 8.6].forEach((z) => bush.push([37.6, z]));
    bush.forEach((b) => insulator(B, b[0], 6, b[1], 2.4));
    // switchyard gantries
    const gantry = (x) => {
      [16, 38].forEach((z) => lattice(B.paint, x, 0, z, 0.9, 15, C.steelLight));
      B.paint.add(box(x - 0.45, 14.2, 16, x + 0.45, 15, 38), C.steelLight);
    };
    gantry(46); gantry(68);
    // breakers / disconnectors rows
    for (let x = 50; x <= 64; x += 7) for (const z of [21, 27, 33]) {
      B.concrete.add(box(x - 0.6, 0, z - 0.6, x + 0.6, 0.6, z + 0.6), C.concreteDark);
      B.paint.add(box(x - 0.15, 0.6, z - 0.15, x + 0.15, 3.2, z + 0.15), C.steelLight);
      insulator(B, x, 3.2, z, 2.2);
    }
    // conductors: transformer -> gantry 1 -> gantry 2 -> towers
    const towers = [[84, 0, 44, -0.45], [98, 0, 51, -0.45]];
    dyn.towerSpots = towers;
    const phase = [-3.6, 0, 3.6];
    phase.forEach((o, i) => {
      const zz = [21, 27, 33][i];
      const segs = [
        [new THREE.Vector3(37.6, 8.4, 5.4 + i * 1.6), new THREE.Vector3(46, 14.2, zz), 0.6],
        [new THREE.Vector3(46, 14.2, zz), new THREE.Vector3(68, 14.2, zz), 1.0]
      ];
      let prev = new THREE.Vector3(68, 14.2, zz);
      towers.forEach((t) => {
        const ca = Math.cos(t[3]), sa = Math.sin(t[3]);
        const p = new THREE.Vector3(t[0] + ca * o, 24.6, t[2] - sa * o);
        segs.push([prev, p, 2.2]); prev = p;
      });
      segs.push([prev, new THREE.Vector3(110, 22.5, 58 + i * 0.0 - (1 - i) * 1.2 * 0), 2.4]);
      segs.forEach((sg) => {
        const curve = catenary(sg[0], sg[1], sg[2]);
        B.metal.add(new THREE.TubeGeometry(curve, 24, 0.06, 4, false), '#3E464C');
        lineCurves.push(curve);
      });
    });
    // lightning shield wires on top of towers are part of the lattice mesh
  }
  dyn.lineCurves = lineCurves;

  // transmission towers (instanced lattice)
  {
    const parts = [];
    latticeTower(parts);
    const tg = mergeSimple(parts);
    parts.forEach((p) => p.dispose());
    const tm = new THREE.InstancedMesh(tg, std({ color: '#8C979F', roughness: 0.5, metalness: 0.6 }), dyn.towerSpots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    dyn.towerSpots.forEach((t, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[3]);
      m4.compose(new THREE.Vector3(t[0], 0, t[2]), q, new THREE.Vector3(1, 1, 1));
      tm.setMatrixAt(k, m4);
    });
    tm.castShadow = true;
    root.add(tm); disposables.push(tg);
  }

  /* ------------------------------------------------------------ admin building, sign, fences */
  {
    B.paint.add(box(-103, 0, 15, -85, 8.6, 27), '#E2DFD8');
    B.paint.add(box(-103.4, 8.6, 14.6, -84.6, 9.2, 27.4), '#9AA3A9');
    for (const y of [1.6, 5.4]) B.glass.add(box(-102.6, y, 27.0, -85.4, y + 2.2, 27.08), C.glass);
    for (const y of [1.6, 5.4]) B.glass.add(box(-85.02, y, 15.6, -84.94, y + 2.2, 26.4), C.glass);
    B.paint.add(box(-96, 0, 27, -92, 3, 29.5), '#9AA3A9');
    // site sign at the entrance
    const st = signTexture('Nhà máy điện hạt nhân', 'Mô hình PWR · 1000 MW');
    disposables.push(st);
    const sm = std({ map: st, roughness: 0.6 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.8), sm);
    sign.position.set(-48, 3.4, 42.2); sign.rotation.y = 0.2;
    root.add(sign); disposables.push(sign.geometry);
    dyn.sign = { mesh: sign, tex: st };
    B.metal.add(box(-0.12, 0, -0.12, 0.12, 4.8, 0.12), '#59646C', [-52.3, 0, 41.3]);
    B.metal.add(box(-0.12, 0, -0.12, 0.12, 4.8, 0.12), '#59646C', [-43.6, 0, 43.1]);
    B.paint.add(box(-4.6, -1.5, -0.12, 4.6, 1.5, -0.04), '#E9E6DF', [-48, 3.4, 42.2], [0, 0.2, 0]);
    // perimeter fence along the plate edge (front and right), posts + wire rails
    fenceLine(B.metal, -108, 108, 53.5);
  }

  /* ------------------------------------------------------------ trees, workers, vehicles */
  {
    const spots = [];
    const blocked = (x, z) =>
      (Math.hypot(x - CX, z - CZ) < 24) || (Math.hypot(x - TX, z - TZ) < 25) ||
      (x > -40 && x < 44 && z > -18 && z < 22) || (x > 30 && x < 74 && z > 10 && z < 42) ||
      (z > 42 && z < 52) || (x > -106 && x < -78 && z > 12 && z < 44) || (x > -43 && x < -36) ||
      (x > 80 && z > 36) || (x > 50 && x < 66 && z > -16 && z < 0);
    let guard = 0;
    while (spots.length < (opts.trees || 90) && guard++ < 5000) {
      const x = -106 + rnd() * 212, z = -57 + rnd() * 112;
      const edge = z < -40 || z > 52 || x < -96 || x > 100 || (z > 26 && z < 42);
      if (!edge && rnd() < 0.7) continue;
      if (blocked(x, z)) continue;
      spots.push([x, z, 0.75 + rnd() * 0.6, rnd() < 0.35 ? 1 : 0, rnd()]);
    }
    const decid = mergeSimple([
      paint(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 6).translate(0, 1.3, 0), C.trunk),
      paint(new THREE.IcosahedronGeometry(2.4, 1).scale(1, 1.15, 1).translate(0, 4.4, 0), C.leaf),
      paint(new THREE.IcosahedronGeometry(1.6, 1).translate(1.1, 5.6, 0.4), C.leaf)
    ], true);
    const conif = mergeSimple([
      paint(new THREE.CylinderGeometry(0.2, 0.26, 2.0, 6).translate(0, 1.0, 0), C.trunk),
      paint(new THREE.ConeGeometry(2.0, 4.6, 8).translate(0, 3.8, 0), C.conifer),
      paint(new THREE.ConeGeometry(1.5, 3.6, 8).translate(0, 6.0, 0), C.conifer)
    ], true);
    const tmat = std({ vertexColors: true, roughness: 0.85, flatShading: true });
    const kinds = [decid, conif];
    kinds.forEach((geo, kind) => {
      const list = spots.filter((s) => s[3] === kind);
      const im = new THREE.InstancedMesh(geo, tmat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      list.forEach((s, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s[4] * TAU);
        m4.compose(new THREE.Vector3(s[0], 0, s[1]), q, new THREE.Vector3(s[2], s[2] * (0.9 + s[4] * 0.25), s[2]));
        im.setMatrixAt(k, m4);
        col.setHSL(0.22 + (s[4] - 0.5) * 0.06, 0.25, 0.85 + s[4] * 0.15);
        im.setColorAt(k, col);
      });
      im.castShadow = true; im.receiveShadow = true;
      root.add(im); disposables.push(geo);
    });

    // workers: static ones + walkers
    const person = mergeSimple([
      paint(new THREE.CylinderGeometry(0.14, 0.14, 0.85, 6).translate(-0.12, 0.43, 0), C.pants),
      paint(new THREE.CylinderGeometry(0.14, 0.14, 0.85, 6).translate(0.12, 0.43, 0), C.pants),
      paint(new THREE.CylinderGeometry(0.26, 0.22, 0.7, 8).translate(0, 1.2, 0), C.vest),
      paint(new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.72, 0), C.skin),
      paint(new THREE.SphereGeometry(0.19, 10, 6, 0, TAU, 0, Math.PI / 2).translate(0, 1.78, 0), '#F2F0EA')
    ], true);
    const still = [[-20, 10, 2.2], [-6, 10, -6], [12, 10, 3.6], [-2, 0, 11.6], [-26, 0, 11.2], [36, 0, 13], [55, 0, 24],
      [61, 0, 30], [CX + 8, 12.7, CZ - 10], [CX - 4, 12.7, CZ - 12], [CX + 2, 0.45, CZ + 12], [-92, 0, 30], [-90, 0, 31],
      [29, 10, 2], [-40, 0, 14], [70, 0, 4]];
    const walkers = [
      { a: [-38.5, 40], b: [-38.5, 16], s: 1.3 }, { a: [-60, 26], b: [-80, 31], s: 1.1 },
      { a: [44, 44], b: [44, 22], s: 1.2 }, { a: [-30, 12], b: [20, 12], s: 1.4 }, { a: [62, 6], b: [48, -6], s: 1.0 }
    ];
    const wm = new THREE.InstancedMesh(person, std({ vertexColors: true, roughness: 0.7 }), still.length + walkers.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    still.forEach((p, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * TAU);
      m4.compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, 1, 1));
      wm.setMatrixAt(k, m4);
    });
    wm.castShadow = true;
    root.add(wm); disposables.push(person);
    dyn.workers = { mesh: wm, base: still.length, walkers };
    walkers.forEach((w) => { w.t = rnd(); w.len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); w.yaw = Math.atan2(w.b[0] - w.a[0], w.b[1] - w.a[1]); });

    // vehicles: trucks and cars on the main road + parked cars
    const truck = mergeSimple([
      paint(box(-1.1, 0.5, 1.6, 1.1, 2.4, 3.2), '#E7E4DC'),
      paint(box(-1.15, 0.6, -3.4, 1.15, 3.0, 1.5), '#C6CED3'),
      paint(box(-1.0, 1.4, 3.15, 1.0, 2.2, 3.22), '#2E3A44'),
      ...[[-1.1, -2.2], [1.1, -2.2], [-1.1, 2.3], [1.1, 2.3]].map((w) => paint(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10).rotateZ(Math.PI / 2).translate(w[0], 0.45, w[1]), '#222'))
    ], true);
    const car = mergeSimple([
      paint(box(-0.9, 0.35, -2.1, 0.9, 1.1, 2.1), '#ffffff'),
      paint(box(-0.8, 1.1, -1.1, 0.8, 1.7, 0.9), '#ffffff'),
      paint(box(-0.82, 1.15, -1.0, 0.82, 1.6, 0.8), '#3A4650'),
      ...[[-0.9, -1.3], [0.9, -1.3], [-0.9, 1.3], [0.9, 1.3]].map((w) => paint(new THREE.CylinderGeometry(0.35, 0.35, 0.24, 10).rotateZ(Math.PI / 2).translate(w[0], 0.35, w[1]), '#222'))
    ], true);
    const vmat = std({ vertexColors: true, roughness: 0.45, metalness: 0.2 });
    const movers = [
      { kind: 0, lane: 45.6, dir: 1, x: -80, v: 7 }, { kind: 1, lane: 45.6, dir: 1, x: 10, v: 11 },
      { kind: 1, lane: 48.4, dir: -1, x: 60, v: 10 }, { kind: 0, lane: 48.4, dir: -1, x: -20, v: 6.5 },
      { kind: 1, lane: 48.4, dir: -1, x: -95, v: 12 }
    ];
    const parked = [];
    for (let k = 0; k < 5; k++) parked.push([-98.5 + k * 3 + (k > 2 ? 3 : 0), 37]);
    const carCols = ['#E9E7E1', '#8B96A0', '#5A6E83', '#B8473A', '#2F3A44', '#D7D2C5', '#6E7F68'];
    const cars = new THREE.InstancedMesh(car, vmat, movers.filter((m) => m.kind === 1).length + parked.length);
    const trucks = new THREE.InstancedMesh(truck, vmat, movers.filter((m) => m.kind === 0).length);
    const col = new THREE.Color();
    let ci = 0, ti = 0;
    movers.forEach((m) => {
      if (m.kind === 1) { m.mesh = cars; m.idx = ci++; cars.setColorAt(m.idx, col.set(carCols[m.idx % carCols.length])); }
      else { m.mesh = trucks; m.idx = ti++; trucks.setColorAt(m.idx, col.set('#ffffff')); }
    });
    parked.forEach((p) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      m4.compose(new THREE.Vector3(p[0], 0, p[1]), q, new THREE.Vector3(1, 1, 1));
      cars.setMatrixAt(ci, m4); cars.setColorAt(ci, col.set(carCols[(ci + 3) % carCols.length])); ci++;
    });
    cars.castShadow = trucks.castShadow = true;
    root.add(cars, trucks); disposables.push(car, truck);
    dyn.vehicles = movers;
  }

  /* ------------------------------------------------------------ dynamic particles */
  // SG boiling bubbles
  {
    const g = new THREE.SphereGeometry(0.075, 6, 4);
    const m = std({ color: '#F4F8FA', roughness: 0.2, transparent: true, opacity: 0.85, emissive: '#ffffff', emissiveIntensity: 0.15 });
    const im = new THREE.InstancedMesh(g, m, bubbleSpots.length);
    im.frustumCulled = false;
    root.add(im); disposables.push(g);
    dyn.bubbles = { mesh: im, spots: bubbleSpots.map((b) => ({ sx: b[0], sz: b[1],
      o: (rnd() - 0.5) * 2.4, d: -0.1 - rnd() * 1.0, ph: rnd(), sp: 0.7 + rnd() * 0.6 })) };
  }
  // tower rain
  {
    const g = new THREE.BoxGeometry(0.05, 1.3, 0.05);
    const m = new THREE.MeshBasicMaterial({ color: '#DCE7EC', transparent: true, opacity: 0.55, depthWrite: false });
    const n = 260;
    const im = new THREE.InstancedMesh(g, m, n);
    im.frustumCulled = false;
    const drops = [];
    for (let k = 0; k < n; k++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * 16.5;
      drops.push({ x: TX + Math.sin(a) * r, z: TZ + Math.cos(a) * r, ph: rnd(), sp: 0.9 + rnd() * 0.3 });
    }
    root.add(im); disposables.push(g, m);
    dyn.rain = { mesh: im, drops, mat: m };
  }
  // energy pulses along the power lines
  {
    const g = new THREE.SphereGeometry(0.22, 8, 6);
    const m = new THREE.MeshBasicMaterial({ color: '#F3D58A', transparent: true, opacity: 0.95 });
    const per = 6;
    const im = new THREE.InstancedMesh(g, m, lineCurves.length * per);
    im.frustumCulled = false;
    // precompute 64 samples per curve
    const samples = lineCurves.map((c) => c.getSpacedPoints(64));
    root.add(im); disposables.push(g, m);
    dyn.pulses = { mesh: im, samples, per, mat: m };
  }

  /* ------------------------------------------------------------ build merged meshes */
  const statics = [];
  const mk = (bucket, mat, cast, recv, name) => {
    const g = bucket.build();
    if (!g) return null;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = cast; mesh.receiveShadow = recv; mesh.name = name;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh); disposables.push(g); statics.push(mesh);
    return mesh;
  };
  mk(B.concrete, M.concrete, true, true, 'concrete');
  mk(B.paint, M.paint, true, true, 'paint');
  mk(B.metal, M.metal, true, true, 'metal');
  mk(B.soil, M.soil, false, false, 'soil');
  mk(B.water, M.water, false, true, 'water');
  const glass = mk(B.glass, M.glass, false, false, 'glass');
  if (glass) glass.renderOrder = 1;
  Object.keys(F).forEach((k) => mk(F[k], FM[k], true, true, 'flow-' + k));
  dyn.flowPaths = flowPaths;

  /* ------------------------------------------------------------ parts: anchors, hit volumes, camera views */
  const parts = [
    { id: 'reactor', label: 'Lò phản ứng', anchor: [RX, 28.5, RZ], hit: [RX, 8, RZ, 6, 16, 6], view: [RX, 15.5, RZ, 64, 0.62, 1.08], pri: 10 },
    { id: 'sg', label: 'Bình sinh hơi', anchor: [SG[1][0], 31, SG[1][1]], hit: [SG[1][0], 17, SG[1][1], 3, 13, 3], view: [SG[1][0], 18, SG[1][1], 46, 0.62, 1.1], pri: 8, hit2: [SG[0][0], 17, SG[0][1], 3, 13, 3] },
    { id: 'pressurizer', label: 'Bình điều áp', anchor: [PZ[0], 24.5, PZ[1]], hit: [PZ[0], 17, PZ[1], 1.8, 6.5, 1.8], view: [PZ[0], 16, PZ[1], 36, 0.62, 1.15], pri: 4 },
    { id: 'pump', label: 'Bơm sơ cấp', anchor: [PUMPS[1][0], 14, PUMPS[1][1]], hit: [PUMPS[1][0], 9, PUMPS[1][1], 1.8, 4.5, 1.8], view: [PUMPS[1][0], 9, PUMPS[1][1], 30, 0.62, 1.15], pri: 3, hit2: [PUMPS[0][0], 9, PUMPS[0][1], 1.8, 4.5, 1.8] },
    { id: 'containment', label: 'Nhà lò', anchor: [CX, Hc + Hd + 3, CZ], hit: null, view: [CX, 20, CZ, 110, 0.62, 1.0], pri: 6 },
    { id: 'turbine', label: 'Tuabin', anchor: [-10, 20, 0], hit: [-8, 13, 0, 20, 4, 4], view: [-9, 12, 0, 58, 0.62, 1.0], pri: 9 },
    { id: 'generator', label: 'Máy phát điện', anchor: [18, 18, 0], hit: [18.5, 13, 0, 6.5, 3, 3], view: [18, 12, 0, 40, 0.75, 1.05], pri: 7 },
    { id: 'condenser', label: 'Bình ngưng', anchor: [-3, 6, 6.5], hit: [-3, 4.5, 0, 13.5, 4.5, 4], view: [-3, 5, 2, 48, 0.62, 1.2], pri: 5 },
    { id: 'tower', label: 'Tháp làm mát', anchor: [TX, 53, TZ], hit: [TX, 25, TZ, 19, 25, 19], view: [TX, 26, TZ, 125, 0.62, 1.12], pri: 8 },
    { id: 'grid', label: 'Lưới điện', anchor: [57, 18, 27], hit: [56, 7, 27, 16, 8, 14], view: [62, 8, 30, 80, 0.62, 1.0], pri: 7, hit2: [37, 4, 7, 4, 4, 4] }
  ];
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  disposables.push(hitMat);
  const hitBox = new THREE.BoxGeometry(2, 2, 2); disposables.push(hitBox);
  const hits = [];
  parts.forEach((p) => {
    [p.hit, p.hit2].forEach((h) => {
      if (!h) return;
      const m = new THREE.Mesh(hitBox, hitMat);
      m.position.set(h[0], h[1], h[2]); m.scale.set(h[3], h[4], h[5]);
      m.userData.part = p.id;
      root.add(m); hits.push(m);
    });
  });
  // rod handle grab volume (moves with rods)
  const grab = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 7, 12), hitMat);
  grab.position.set(RX, 19.5, RZ);
  grab.userData.part = 'rods';
  dyn.rods.add(grab); disposables.push(grab.geometry);
  dyn.grab = grab;

  return { root, dyn, parts, hits, statics, disposables, materials: M };
}

/* ======================================================================= helpers */
function at(g, x, y, z) { g.translate(x, y, z); paintIfMissing(g); return g; }
function paintIfMissing(g) { if (!g.attributes.color) paint(g, '#ffffff'); }
function paint(g, col) {
  const n = g.attributes.position.count, arr = new Float32Array(n * 3), c = new THREE.Color(col);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
// vertex color by height
function shade(g, col, fn) {
  paint(g, col);
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) { const k = fn(p.getY(i)); c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k); }
}

function mergeSimple(list, keepColor) {
  const norm = list.map((g) => {
    const o = g.index ? g.toNonIndexed() : g.clone();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', o.attributes.position);
    if (!o.attributes.normal) o.computeVertexNormals();
    out.setAttribute('normal', o.attributes.normal);
    out.setAttribute('uv', o.attributes.uv || new THREE.BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
    if (keepColor) out.setAttribute('color', o.attributes.color);
    return out;
  });
  const n = norm.reduce((s, g) => s + g.attributes.position.count, 0);
  const res = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv'].concat(keepColor ? ['color'] : []);
  names.forEach((name) => {
    const size = norm[0].attributes[name].itemSize, arr = new Float32Array(n * size);
    let off = 0;
    norm.forEach((g) => { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; });
    res.setAttribute(name, new THREE.BufferAttribute(arr, size));
  });
  res.computeBoundingSphere();
  return res;
}

function halfDisc(r, h) {
  const o = [[r, -h / 2], [r, h / 2]], i = [[0.001, -h / 2], [0.001, h / 2]];
  const g = revolveSector(o, i, HALF0, HALF1, 24);
  return mergeSimple([g.solid].concat(g.cut ? [g.cut] : []));
}
function halfCyl(r, h) {
  const o = [[r, 0], [r, h]], i = [[0.001, 0], [0.001, h]];
  const g = revolveSector(o, i, HALF0, HALF1, 28);
  return mergeSimple([g.solid].concat(g.cut ? [g.cut] : []));
}

function gable(z0, z1, y0, rise) {
  const s = new THREE.Shape();
  s.moveTo(z0, y0); s.lineTo(z1, y0); s.lineTo(0, y0 + rise); s.lineTo(z0, y0);
  const g = new THREE.ShapeGeometry(s);
  g.rotateY(Math.PI / 2);
  return g;
}

function trussZ(bucket, x, z0, z1, y0, rise, col) {
  const top = (z) => y0 + rise * (1 - Math.abs(z) / z1);
  const bar = (a, b, t) => bucket.addMatrix(unitBox(t), col, strut(a, b));
  const v = (z, y) => new THREE.Vector3(x, y, z);
  bar(v(z0, y0), v(z1, y0), 0.22);
  bar(v(z0, y0), v(0, y0 + rise), 0.26);
  bar(v(0, y0 + rise), v(z1, y0), 0.26);
  const n = 8;
  for (let k = 1; k < n; k++) {
    const z = z0 + (z1 - z0) * k / n;
    bar(v(z, y0), v(z, top(z)), 0.12);
    const zn = z0 + (z1 - z0) * (k + (z < 0 ? -1 : 1)) / n;
    bar(v(z, y0), v(zn, top(zn)), 0.1);
  }
}
const _unit = {};
function unitBox(t) { return _unit[t] || (_unit[t] = new THREE.BoxGeometry(t, 1, t)); }
// matrix that maps a unit Y-aligned box/cylinder (height 1, centred) onto segment a->b
function strut(a, b) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
}

function railing(bucket, x0, x1, z, y, col) {
  for (let x = x0; x <= x1; x += 1.6) bucket.add(box(-0.04, y, -0.04, 0.04, y + 1.1, 0.04), col, [x, 0, z]);
  bucket.add(box(x0, y + 1.05, z - 0.04, x1, y + 1.12, z + 0.04), col);
  bucket.add(box(x0, y + 0.55, z - 0.03, x1, y + 0.6, z + 0.03), col);
}
function railingX(bucket, x0, x1, z, y0, y1, col) {
  const a = new THREE.Vector3(x0, y0 + 1.1, z), b = new THREE.Vector3(x1, y1 + 1.1, z);
  bucket.addMatrix(unitBox(0.07), col, strut(a, b));
  for (let k = 0; k <= 4; k++) {
    const t = k / 4, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    bucket.add(box(-0.04, y, -0.04, 0.04, y + 1.1, 0.04), col, [x, 0, z]);
  }
}
function fenceLine(bucket, x0, x1, z) {
  for (let x = x0; x <= x1; x += 3) bucket.add(box(-0.05, 0, -0.05, 0.05, 2.0, 0.05), '#7D878E', [x, 0, z]);
  for (const y of [0.6, 1.2, 1.8]) bucket.add(box(x0, y, z - 0.015, x1, y + 0.03, z + 0.015), '#8E979D');
}

function insulator(B, x, y, z, h) {
  const n = Math.round(h / 0.3);
  for (let k = 0; k < n; k++) B.paint.add(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), '#B5A08A', [x, y + 0.15 + k * 0.3, z]);
  B.paint.add(new THREE.CylinderGeometry(0.12, 0.12, h, 8), '#C9B9A4', [x, y + h / 2, z]);
}

function lattice(bucket, x, y, z, w, h, col) {
  const legs = [[-w, -w], [w, -w], [w, w], [-w, w]];
  legs.forEach((l) => bucket.add(box(-0.1, 0, -0.1, 0.1, h, 0.1), col, [x + l[0], y, z + l[1]]));
  for (let yy = 0; yy < h; yy += 2) {
    for (let k = 0; k < 4; k++) {
      const a = legs[k], b = legs[(k + 1) % 4];
      const p0 = new THREE.Vector3(x + a[0], y + yy, z + a[1]), p1 = new THREE.Vector3(x + b[0], y + yy + 2, z + b[1]);
      bucket.addMatrix(unitBox(0.06), col, strut(p0, p1));
    }
  }
}

function latticeTower(parts) {
  const H = 26, bw = 3.2, tw = 0.9;
  const leg = (sx, sz) => [new THREE.Vector3(sx * bw, 0, sz * bw), new THREE.Vector3(sx * tw, H, sz * tw)];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((c) => leg(c[0], c[1]));
  const add = (a, b, t) => { const g = new THREE.BoxGeometry(t, 1, t); g.applyMatrix4(strut(a, b)); parts.push(g); };
  corners.forEach((c) => add(c[0], c[1], 0.22));
  const levels = 7;
  for (let k = 0; k < levels; k++) {
    const t0 = k / levels, t1 = (k + 1) / levels;
    for (let s = 0; s < 4; s++) {
      const A = corners[s], Bc = corners[(s + 1) % 4];
      const a0 = A[0].clone().lerp(A[1], t0), b1 = Bc[0].clone().lerp(Bc[1], t1);
      const b0 = Bc[0].clone().lerp(Bc[1], t0), a1 = A[0].clone().lerp(A[1], t1);
      add(a0, b1, 0.08); add(b0, a1, 0.08); add(a1, b1, 0.08);
    }
  }
  // cross arms (along local x) at 24.6 for phases, top for shield wire
  add(new THREE.Vector3(-4.6, 24.6, 0), new THREE.Vector3(4.6, 24.6, 0), 0.3);
  add(new THREE.Vector3(-4.6, 24.6, 0), new THREE.Vector3(-tw, 23.0, 0), 0.12);
  add(new THREE.Vector3(4.6, 24.6, 0), new THREE.Vector3(tw, 23.0, 0), 0.12);
  add(new THREE.Vector3(-1.6, H + 1.2, 0), new THREE.Vector3(1.6, H + 1.2, 0), 0.16);
  add(new THREE.Vector3(0, H, 0), new THREE.Vector3(0, H + 1.2, 0), 0.16);
  [-3.6, 0, 3.6].forEach((o) => {
    const g = new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6); g.translate(o, 24.0, 0); parts.push(g);
  });
}

function catenary(a, b, sag) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function soilFaces(bucket, rnd) {
  const layers = [[0, '#6B8A4E'], [-0.35, '#5E4A38'], [-1.8, '#8A6A48'], [-4.4, '#A88E6A'], [-6.6, '#8E8A80'], [-10, '#7A756C']];
  const colAt = (y, u) => {
    const wav = Math.sin(u * 0.13) * 0.35 + Math.sin(u * 0.41 + 1.3) * 0.18;
    for (let i = layers.length - 1; i >= 0; i--) if (y <= layers[i][0] + (i > 1 ? wav : 0)) return layers[i][1];
    return layers[0][1];
  };
  const face = (len, rotY, px, pz) => {
    const g = new THREE.PlaneGeometry(len, 10, Math.round(len / 1.2), 24);
    const p = g.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i), y = p.getY(i) - 5;
      p.setY(i, y);
      c.set(colAt(y, u + px * 0.7 + pz * 0.3));
      const k = 0.92 + rnd() * 0.12;
      cols[i * 3] = c.r * k; cols[i * 3 + 1] = c.g * k; cols[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.rotateY(rotY); g.translate(px, 0, pz);
    bucket.list.push(g);
  };
  face(W, 0, 0, D / 2);
  face(D, Math.PI / 2, W / 2, 0);
  face(W, Math.PI, 0, -D / 2);
  face(D, -Math.PI / 2, -W / 2, 0);
  const bottom = new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(0, -10, 0);
  paint(bottom, '#6F6A62');
  bucket.list.push(bottom);
}
