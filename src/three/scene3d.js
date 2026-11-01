// scene3d.js - real-time 3D view of the plant. Same contract as the 2D Scene (update, setReducedMotion)
// plus camera focus, labels, quality tiers and disposal. Draws only; no physics.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPlant, W, D } from './plant.js';
import { skyTexture, puffTexture, signTexture } from './textures.js';

export const TIERS = {
  high: { dpr: 2, shadow: 2048, post: true, plume: 44, rain: 260, bubbles: 1 },
  medium: { dpr: 1.5, shadow: 1024, post: false, plume: 32, rain: 150, bubbles: 0.7 },
  low: { dpr: 1, shadow: 0, post: false, plume: 16, rain: 60, bubbles: 0.4 }
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function mount3D(container, cb, opts) {
  cb = cb || {};
  opts = opts || {};
  const progress = cb.onProgress || (() => {});
  const tick = () => new Promise((r) => setTimeout(r, 0));

  /* ---------------------------------------------------------------- renderer */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'gl';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.Fog('#E3E7E8', 420, 900);
  progress(0.35);
  await tick();

  /* ---------------------------------------------------------------- environment (generated) */
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  const sunDir = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
  function makeEnv() {
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(100, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { sun: { value: sunDir } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 sun; varying vec3 vP;',
        'void main(){',
        '  float h = vP.y;',
        '  vec3 zen = vec3(0.42,0.56,0.74), hor = vec3(0.86,0.88,0.88), gnd = vec3(0.40,0.38,0.33);',
        '  vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.6)) : mix(hor, gnd, pow(-h, 0.4));',
        '  float d = max(dot(normalize(vP), sun), 0.0);',
        '  c += vec3(1.0,0.92,0.8) * (pow(d, 400.0) * 40.0 + pow(d, 8.0) * 0.35);',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n')
    });
    s.add(new THREE.Mesh(geo, mat));
    const rt = pmrem.fromScene(s, 0.02);
    geo.dispose(); mat.dispose();
    return rt;
  }
  envRT = makeEnv();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.8;

  /* ---------------------------------------------------------------- lights */
  const sun = new THREE.DirectionalLight('#FFF1DE', 2.7);
  sun.position.copy(sunDir).multiplyScalar(220);
  sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera;
  sc.left = -150; sc.right = 150; sc.top = 120; sc.bottom = -120; sc.near = 20; sc.far = 480;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.35; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight('#DCE6EE', '#8A8170', 0.35);
  scene.add(fill);

  /* ---------------------------------------------------------------- plant */
  progress(0.45);
  await tick();
  const plant = buildPlant({ trees: opts.trees || 95 });
  scene.add(plant.root);
  const dyn = plant.dyn;
  progress(0.8);
  await tick();

  // beacons on the dome: housings + rotating beams
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#5A5F63', emissive: '#C98A12', emissiveIntensity: 0, roughness: 0.4 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 16), beaconMat);
  beacon.position.copy(dyn.beaconPos);
  scene.add(beacon);
  const beamGeo = new THREE.ConeGeometry(2.2, 9, 20, 1, true);
  beamGeo.translate(0, -4.5, 0); beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color: '#E0483A', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beams = new THREE.Group();
  const b1 = new THREE.Mesh(beamGeo, beamMat), b2 = new THREE.Mesh(beamGeo, beamMat);
  b2.rotation.y = Math.PI;
  beams.add(b1, b2); beams.position.copy(dyn.beaconPos); beams.visible = false;
  scene.add(beams);

  // cooling tower plume: instanced camera-facing puffs with soft fake lighting
  const puff = puffTexture();
  const plumeGeo = new THREE.PlaneGeometry(1, 1);
  const PN = TIERS.high.plume;
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(PN), 1);
  const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(PN), 1);
  aAlpha.setUsage(THREE.DynamicDrawUsage);
  plumeGeo.setAttribute('aAlpha', aAlpha);
  plumeGeo.setAttribute('aSeed', aSeed);
  const sunView = new THREE.Vector3();
  const plumeMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: puff }, sunV: { value: sunView } },
    transparent: true, depthWrite: false, toneMapped: true,
    vertexShader: [
      'attribute float aAlpha; attribute float aSeed;',
      'varying vec2 vUv; varying float vAlpha; varying float vSeed;',
      'void main(){',
      '  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;',
      '  float s = length(instanceMatrix[0].xyz);',
      '  vec4 mv = viewMatrix * vec4(c, 1.0);',
      '  mv.xy += position.xy * s;',
      '  vUv = uv; vAlpha = aAlpha; vSeed = aSeed;',
      '  gl_Position = projectionMatrix * mv;',
      '}'].join('\n'),
    fragmentShader: [
      'uniform sampler2D map; uniform vec3 sunV;',
      'varying vec2 vUv; varying float vAlpha; varying float vSeed;',
      'void main(){',
      '  vec2 q = vUv * 2.0 - 1.0; float r2 = dot(q, q);',
      '  if (r2 > 1.0) discard;',
      '  float a = vSeed * 6.2831; mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));',
      '  float d = texture2D(map, R * (vUv - 0.5) + 0.5).r;',
      '  vec3 n = normalize(vec3(q, sqrt(max(0.0, 1.0 - r2))));',
      '  float l = clamp(dot(n, normalize(sunV)) * 0.5 + 0.5, 0.0, 1.0);',
      '  vec3 col = mix(vec3(0.66,0.71,0.78), vec3(1.0,0.97,0.92), l);',
      '  float alpha = d * vAlpha * (1.0 - smoothstep(0.55, 1.0, r2));',
      '  gl_FragColor = vec4(col, alpha);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'].join('\n')
  });
  const plume = new THREE.InstancedMesh(plumeGeo, plumeMat, PN);
  plume.frustumCulled = false;
  plume.renderOrder = 5;
  scene.add(plume);
  const puffs = [];
  for (let i = 0; i < PN; i++) { puffs.push({ t: i / PN, ox: Math.random() - 0.5, oz: Math.random() - 0.5, s: 0.8 + Math.random() * 0.5 }); aSeed.setX(i, Math.random()); }

  /* ---------------------------------------------------------------- camera + controls */
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 1600);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
  controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.36;
  controls.minAzimuthAngle = -0.55; controls.maxAzimuthAngle = 1.75;
  controls.minDistance = 16;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = false;

  let vw = 1, vh = 1, inset = { right: 0, bottom: 0 }, overviewDist = 300;
  const overviewTarget = new THREE.Vector3(0, 6, 2);
  // overview distance: smallest distance at which the key points fit in the free area
  const FIT_WIDE = [[-110, 0, -60], [110, 0, -60], [-110, -10, 60], [110, -10, 60], [80, 66, -20], [-62, 48, -2]];
  const FIT_TALL = [[-84, 0, -2], [-62, 50, -2], [102, 0, -20], [80, 66, -20], [98, 27, 51], [-50, 0, 46], [60, 0, -44]];
  let overviewAz = 0.62;
  const fitCam = new THREE.PerspectiveCamera();
  function fitOverview() {
    const ew = Math.max(1, vw - inset.right), eh = Math.max(1, vh - inset.bottom);
    const tall = ew / eh < 1;
    const pts = tall ? FIT_TALL : FIT_WIDE;
    overviewAz = tall ? 0.78 : 0.62;
    overviewTarget.set(tall ? 8 : 0, 8, 2);
    fitCam.copy(camera);
    let d = 120;
    for (; d < 900; d *= 1.04) {
      viewPos(overviewTarget, d, overviewAz, 1.0, fitCam.position);
      fitCam.lookAt(overviewTarget); fitCam.updateMatrixWorld();
      let ok = true;
      for (const p of pts) {
        tmpV.set(p[0], p[1], p[2]).project(fitCam);
        // NDC of the full canvas -> pixels; must land inside the free area with a margin
        const x = (tmpV.x * 0.5 + 0.5) * vw, y = (-tmpV.y * 0.5 + 0.5) * vh;
        if (x < 12 || x > ew - 12 || y < (tall ? 70 : 60) || y > eh - 12) { ok = false; break; }
      }
      if (ok) break;
    }
    overviewDist = d;
    controls.maxDistance = overviewDist * 1.35;
  }
  function viewPos(target, dist, az, pol, out) {
    return out.set(target.x + dist * Math.sin(pol) * Math.sin(az), target.y + dist * Math.cos(pol), target.z + dist * Math.sin(pol) * Math.cos(az));
  }

  function resize() {
    const r = container.getBoundingClientRect();
    vw = Math.max(1, Math.round(r.width)); vh = Math.max(1, Math.round(r.height));
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.fov = vw / vh < 0.8 ? 38 : 30;
    camera.setViewOffset(vw, vh, inset.right / 2, inset.bottom / 2, vw, vh);
    camera.updateProjectionMatrix();
    const wasDist = overviewDist;
    fitOverview();
    if (atOverview && !fly) {
      const k = overviewDist / wasDist;
      camera.position.sub(controls.target).multiplyScalar(k).add(controls.target);
    }
    if (composer) composer.setSize(vw, vh);
    needsRender = true;
  }

  /* ---------------------------------------------------------------- labels */
  const layer = document.createElement('div');
  layer.className = 'labels';
  container.appendChild(layer);
  const labels = plant.parts.map((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tag'; b.textContent = p.label;
    b.setAttribute('data-part', p.id);
    b.addEventListener('click', (e) => { e.stopPropagation(); focusPart(p.id, true); });
    layer.appendChild(b);
    b.classList.add('off');
    return { p, el: b, v: new THREE.Vector3(p.anchor[0], p.anchor[1], p.anchor[2]), x: 0, y: 0, w: 0, h: 0, on: true, vis: false };
  });
  const tmpV = new THREE.Vector3();
  let labelFrame = 0;
  function placeLabels() {
    labelFrame++;
    const measure = labelFrame % 30 === 1;
    for (const L of labels) {
      if (measure || !L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      tmpV.copy(L.v).project(camera);
      L.on = tmpV.z < 1 && tmpV.x > -1.1 && tmpV.x < 1.1 && tmpV.y > -1.1 && tmpV.y < 1.1;
      L.y = (-tmpV.y * 0.5 + 0.5) * vh;
      // keep the tag inside the free area horizontally (its stem may sit off-centre)
      L.x = clamp((tmpV.x * 0.5 + 0.5) * vw, L.w / 2 + 6, vw - inset.right - L.w / 2 - 6);
      L.el.style.transform = 'translate3d(' + (L.x - L.w / 2).toFixed(1) + 'px,' + (L.y - L.h - 6).toFixed(1) + 'px,0)';
    }
    if (labelFrame % 6 !== 0 && !measure) return;
    // declutter by priority (focused part first)
    const order = labels.slice().sort((a, b) => (b.p.id === focused) - (a.p.id === focused) || b.p.pri - a.p.pri);
    const placed = [];
    for (const L of order) {
      let ok = L.on && L.x > 4 && L.x < vw - inset.right - 4 && L.y < vh - inset.bottom - 4 && L.y > L.h + 72;
      if (ok) {
        const r = [L.x - L.w / 2 - 4, L.y - L.h - 10, L.x + L.w / 2 + 4, L.y - 2];
        for (const q of placed) { if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) { ok = false; break; } }
        if (ok) placed.push(r);
      }
      if (ok !== L.vis) { L.vis = ok; L.el.classList.toggle('off', !ok); L.el.tabIndex = ok ? 0 : -1; }
    }
  }

  /* ---------------------------------------------------------------- camera flights */
  let fly = null, atOverview = true, focused = null, idleT = 0, driftDir = 1, reduced = false;
  const flyFromP = new THREE.Vector3(), flyFromT = new THREE.Vector3(), flyToP = new THREE.Vector3(), flyToT = new THREE.Vector3();
  function flyTo(target, dist, az, pol, dur) {
    flyFromP.copy(camera.position); flyFromT.copy(controls.target);
    flyToT.copy(target);
    viewPos(flyToT, dist, az, pol, flyToP);
    if (reduced || dur === 0) {
      camera.position.copy(flyToP); controls.target.copy(flyToT); controls.update(); fly = null;
    } else {
      fly = { t: 0, dur: dur || 1.3 };
    }
    needsRender = true;
  }
  const _tv = new THREE.Vector3();
  function focusPart(id, notify) {
    const p = plant.parts.find((q) => q.id === id);
    if (!p) return;
    focused = id; atOverview = false; idleT = 0;
    const k = Math.pow(Math.max(1, 1.2 / camera.aspect), 0.75);
    _tv.set(p.view[0], p.view[1], p.view[2]);
    flyTo(_tv, p.view[3] * k, p.view[4], p.view[5]);
    labels.forEach((L) => L.el.classList.toggle('on', L.p.id === id));
    if (notify && cb.onPartTap) cb.onPartTap(id);
  }
  function overview(instant) {
    focused = null; atOverview = true; idleT = 0;
    labels.forEach((L) => L.el.classList.remove('on'));
    flyTo(overviewTarget, overviewDist, overviewAz, 1.0, instant ? 0 : 1.4);
  }

  /* ---------------------------------------------------------------- pointer: taps, rod drag */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null, rodLocked = false, rodW = 60;
  function pick(ev, objs) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(objs, false);
    return hit.length ? hit[0].object : null;
  }
  function interacted() { idleT = 0; controls.autoRotate = false; if (fly) fly = null; if (cb.onInteract) cb.onInteract(); }
  function onDown(ev) {
    if (ev.target !== canvas) return;
    interacted();
    if (down && down.id !== ev.pointerId) { down.multi = true; return; }
    plant.root.updateMatrixWorld();
    const g = !rodLocked && (ev.pointerType !== 'mouse' || ev.button === 0) ? pick(ev, [dyn.grab]) : null;
    down = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), rod: !!g, dragging: false, w0: rodW, multi: false };
    if (g) {
      ev.stopPropagation(); ev.preventDefault();
      try { container.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
  }
  function onMove(ev) {
    if (down && down.id === ev.pointerId) {
      const dy = ev.clientY - down.y, dx = ev.clientX - down.x;
      if (down.rod) {
        if (!down.dragging && Math.abs(dy) > 4) { down.dragging = true; container.classList.add('dragging-rods'); }
        if (down.dragging && cb.onRodDrag) {
          ev.preventDefault();
          cb.onRodDrag(clamp(down.w0 - dy / Math.max(180, vh * 0.42) * 100, 0, 100));
        }
      } else if (Math.abs(dx) + Math.abs(dy) > 8) { down.moved = true; }
      return;
    }
    if (ev.pointerType === 'mouse' && !down) {
      hoverFrame = ev;
    }
  }
  let hoverFrame = null, hoverState = '';
  function onUp(ev) {
    if (!down || down.id !== ev.pointerId) return;
    const d = down; down = null;
    container.classList.remove('dragging-rods');
    try { container.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    if (d.multi || d.moved || d.dragging || performance.now() - d.t > 600) return;
    plant.root.updateMatrixWorld();
    if (d.rod) { focusPart('reactor', true); return; }
    const o = pick(ev, plant.hits);
    if (o && o.userData.part) focusPart(o.userData.part, true);
  }
  container.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', interacted, { passive: true });
  controls.addEventListener('start', () => { interacted(); atOverview = false; });
  controls.addEventListener('change', () => { needsRender = true; });

  /* ---------------------------------------------------------------- quality + post */
  let tierName = null, composer = null, gtao = null;
  async function setupPost(on) {
    if (composer) { composer.dispose(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); if (gtao) gtao.dispose(); composer = null; gtao = null; }
    if (!on) return;
    try {
      const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/GTAOPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
      if (tierName !== 'high') return;
      const rt = new THREE.WebGLRenderTarget(vw, vh, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      gtao = new GTAOPass(scene, camera, vw, vh);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.7;
      gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.6, thickness: 1.5, scale: 1.0, samples: 12 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(gtao);
      composer.addPass(new OutputPass());
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(vw, vh);
    } catch (e) {
      composer = null; gtao = null;
    }
  }
  function setQuality(name) {
    if (!TIERS[name] || name === tierName) return;
    const T = TIERS[name], prevShadow = tierName ? TIERS[tierName].shadow : -1;
    tierName = name;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, T.dpr));
    const sh = T.shadow > 0;
    if (sh !== (prevShadow > 0) || T.shadow !== prevShadow) {
      renderer.shadowMap.enabled = sh;
      sun.castShadow = sh;
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      sun.shadow.mapSize.set(T.shadow || 512, T.shadow || 512);
      scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
    }
    fill.intensity = sh ? 0.35 : 0.6;
    plume.count = T.plume;
    dyn.rain.mesh.count = T.rain;
    dyn.bubbles.mesh.count = Math.round(dyn.bubbles.spots.length * T.bubbles);
    setupPost(T.post);
    resize();
  }

  /* ---------------------------------------------------------------- context loss */
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; if (cb.onContextLost) cb.onContextLost(); });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    try {
      if (envRT) envRT.dispose();
      envRT = makeEnv(); scene.environment = envRT.texture;
      scene.traverse((o) => {
        if (!o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          ['map', 'emissiveMap', 'roughnessMap'].forEach((k) => { if (m[k]) m[k].needsUpdate = true; });
          m.needsUpdate = true;
        });
      });
      sky.needsUpdate = true;
      const t = tierName; tierName = null; setQuality(t);
    } catch (e) { /* app decides */ }
    needsRender = true;
    if (cb.onContextRestored) cb.onContextRestored();
  });

  // re-draw the sign when the web font is ready
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      try {
        const t = signTexture('Nhà máy điện hạt nhân', 'Mô hình PWR · 1000 MW');
        const old = dyn.sign.mesh.material.map;
        dyn.sign.mesh.material.map = t; dyn.sign.mesh.material.needsUpdate = true;
        old.dispose(); dyn.sign.tex = t; needsRender = true;
      } catch (e) { /* ignore */ }
    });
  }

  /* ---------------------------------------------------------------- per-frame update (no allocations) */
  let needsRender = true, time = 0, rotorA = 0, beamA = 0, lastNow = performance.now();
  const m = new THREE.Matrix4(), qv = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const qEast = new THREE.Quaternion().setFromAxisAngle(yAxis, Math.PI / 2), qWest = new THREE.Quaternion().setFromAxisAngle(yAxis, -Math.PI / 2);
  const tanX = Math.cos(0.6), tanZ = -Math.sin(0.6), vX = Math.sin(0.6), vZ = Math.cos(0.6);

  function setT(arr, i, x, y, z, s) {
    const o = i * 16;
    arr[o] = s; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = s; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  function update(s, dt) {
    if (lost) return;
    const now = performance.now();
    const rdt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    dt = Math.min(dt, 0.1);
    const live = dt > 1e-4;
    time += dt;

    // camera flight / idle drift
    if (fly) {
      fly.t += rdt / fly.dur;
      const k = ease(Math.min(1, fly.t));
      camera.position.lerpVectors(flyFromP, flyToP, k);
      controls.target.lerpVectors(flyFromT, flyToT, k);
      if (fly.t >= 1) fly = null;
      needsRender = true;
    }
    idleT += rdt;
    if (atOverview && !fly && !reduced && idleT > 8 && !down) {
      controls.autoRotate = true;
      const az = controls.getAzimuthalAngle();
      if (az > 0.95) driftDir = -1; else if (az < 0.3) driftDir = 1;
      controls.autoRotateSpeed = 0.12 * driftDir;
    } else controls.autoRotate = false;
    controls.update(rdt);
    // keep the target on the plate
    const t = controls.target;
    const cx = clamp(t.x, -W / 2 + 10, W / 2 - 10), cy = clamp(t.y, 0, 45), cz = clamp(t.z, -D / 2 + 5, D / 2 - 5);
    if (cx !== t.x || cy !== t.y || cz !== t.z) { const dx = cx - t.x, dy = cy - t.y, dz = cz - t.z; t.set(cx, cy, cz); camera.position.x += dx; camera.position.y += dy; camera.position.z += dz; }

    // hover cursor over the rod handle (mouse only, throttled)
    if (hoverFrame && (labelFrame & 3) === 0) {
      const o = rodLocked ? null : pick(hoverFrame, [dyn.grab]);
      const st = o ? 'grab' : '';
      if (st !== hoverState) { hoverState = st; container.classList.toggle('over-rods', !!o); }
      hoverFrame = null;
    }

    if (!live && !needsRender && !fly && !controls.autoRotate) return;

    const pf = clamp((s.pTh || 0) / 3000, 0, 1.25);
    const rpmF = clamp((s.rpm || 0) / 3000, 0, 1.25);
    const pe = clamp((s.pElec || 0) / 1000, 0, 1.25);
    const tk = clamp(((s.tCore || 40) - 290) / 70, 0, 1);
    rodLocked = !!s.scrammed;
    rodW = typeof s.w === 'number' ? s.w : rodW;

    // rods and handle
    dyn.rods.position.y = 3.6 + clamp(s.rodPos || 0, 0, 100) / 100 * dyn.rodTravel;
    dyn.handleMat.emissiveIntensity = (down && down.rod) ? 0.35 : 0.08;
    // Cherenkov glow and core warmth
    dyn.coreWater.emissiveIntensity = 0.06 + 1.25 * Math.min(1, pf);
    dyn.coreWater.opacity = 0.26 + 0.16 * Math.min(1, pf);
    dyn.fuelMat.emissiveIntensity = tk * tk * 0.85;
    dyn.flowMats.hot.emissiveIntensity = 0.12 + tk * 0.55;

    // flow textures
    const fm = dyn.flowMats;
    fm.hot.map.offset.x -= dt * 1.3 * (s.flowPrimary || 0);
    fm.cold.map.offset.x -= dt * 1.3 * (s.flowPrimary || 0);
    fm.steam.map.offset.x -= dt * 1.8 * (s.flowSteam || 0);
    fm.feed.map.offset.x -= dt * 0.9 * (s.flowSteam || 0);
    fm.cool.map.offset.x -= dt * 1.0 * (s.flowCooling || 0);
    for (const k in fm) { const x = fm[k].map.offset.x; if (x < -1000) fm[k].map.offset.x = x % 1; }

    // turbine rotor: capped visual speed + blur discs (never strobes)
    rotorA = (rotorA + dt * rpmF * 6.6) % (Math.PI * 2);
    dyn.rotor.rotation.x = rotorA;
    dyn.blur.rotation.x = rotorA * 0.3;
    dyn.blur.material.opacity = smooth(0.3, 0.95, rpmF) * 0.82;

    // SG boiling bubbles
    const bb = dyn.bubbles, barr = bb.mesh.instanceMatrix.array, bn = bb.mesh.count;
    const act = s.pTh > 30 ? clamp(0.15 + pf, 0, 1) : 0;
    for (let i = 0; i < bn; i++) {
      const b = bb.spots[i];
      b.ph = (b.ph + dt * (0.18 + 0.75 * pf) * b.sp) % 1;
      const on = (i % 40) / 40 < act;
      const y = 10.5 + b.ph * 9.6;
      const w = Math.sin((b.ph * 9 + b.o) * 3) * 0.06;
      setT(barr, i, b.sx + tanX * (b.o + w) + vX * b.d, y, b.sz + tanZ * (b.o + w) + vZ * b.d, on ? 0.7 + b.ph * 0.6 : 0);
    }
    bb.mesh.instanceMatrix.needsUpdate = true;

    // tower rain
    const rn = dyn.rain, rarr = rn.mesh.instanceMatrix.array, rc = rn.mesh.count, fc = clamp(s.flowCooling || 0, 0, 1);
    for (let i = 0; i < rc; i++) {
      const d = rn.drops[i];
      d.ph = (d.ph + dt * 1.4 * d.sp) % 1;
      setT(rarr, i, d.x, 4.2 - d.ph * 3.5, d.z, (i / rc) < fc * 1.05 ? 1 : 0);
    }
    rn.mesh.instanceMatrix.needsUpdate = true;
    rn.mat.opacity = 0.25 + 0.35 * fc;

    // power-line pulses
    const pu = dyn.pulses;
    pu.mesh.visible = pe > 0.01;
    if (pu.mesh.visible) {
      const parr = pu.mesh.instanceMatrix.array;
      let i = 0;
      const ph = (time * (0.06 + 0.22 * Math.min(1, pe))) % 1;
      for (let c = 0; c < pu.samples.length; c++) {
        const sm = pu.samples[c];
        for (let k = 0; k < pu.per; k++, i++) {
          const u = (k / pu.per + ph) % 1, f = u * (sm.length - 1), j = Math.floor(f), fr = f - j;
          const a = sm[j], b2 = sm[Math.min(sm.length - 1, j + 1)];
          setT(parr, i, a.x + (b2.x - a.x) * fr, a.y + (b2.y - a.y) * fr, a.z + (b2.z - a.z) * fr, 0.7 + 0.5 * Math.min(1, pe));
        }
      }
      pu.mesh.instanceMatrix.needsUpdate = true;
      pu.mat.opacity = 0.35 + 0.6 * Math.min(1, pe);
    }

    // plume
    const top = dyn.towerTop, tr = dyn.towerTopR, load = clamp(s.flowCooling || 0, 0, 1.1), pn = plume.count;
    const parr2 = plume.instanceMatrix.array;
    for (let i = 0; i < pn; i++) {
      const p = puffs[i];
      p.t += dt * (0.055 + 0.03 * load);
      if (p.t >= 1) { p.t -= 1; p.ox = Math.random() - 0.5; p.oz = Math.random() - 0.5; }
      const u = p.t;
      const rise = u * (30 + 40 * load), drift = u * u * (24 + 14 * load);
      const size = (tr * 0.95 + u * (12 + 18 * load)) * p.s * (0.6 + 0.4 * load);
      setT(parr2, i, top.x + p.ox * tr * 0.8 + drift, top.y + 1 + rise, top.z + p.oz * tr * 0.8 + drift * 0.25, size);
      aAlpha.array[i] = smooth(0, 0.05, u) * (1 - smooth(0.3, 1, u)) * (0.12 + 0.7 * load);
    }
    plume.instanceMatrix.needsUpdate = true; aAlpha.needsUpdate = true;
    sunView.copy(sunDir).transformDirection(camera.matrixWorldInverse);

    // vehicles and walkers
    for (const v of dyn.vehicles) {
      v.x += v.dir * v.v * dt;
      if (v.x > 112) v.x = -112; else if (v.x < -112) v.x = 112;
      pv.set(v.x, 0, v.lane); sv.set(1, 1, 1);
      m.compose(pv, v.dir > 0 ? qEast : qWest, sv);
      v.mesh.setMatrixAt(v.idx, m); v.mesh.instanceMatrix.needsUpdate = true;
    }
    const wk = dyn.workers;
    for (let i = 0; i < wk.walkers.length; i++) {
      const w = wk.walkers[i];
      w.t = (w.t + dt * w.s / w.len) % 2;
      const u = w.t < 1 ? w.t : 2 - w.t;
      pv.set(w.a[0] + (w.b[0] - w.a[0]) * u, Math.abs(Math.sin(w.t * w.len * 2.2)) * 0.05, w.a[1] + (w.b[1] - w.a[1]) * u);
      qv.setFromAxisAngle(yAxis, w.t < 1 ? w.yaw : w.yaw + Math.PI);
      m.compose(pv, qv, sv.set(1, 1, 1));
      wk.mesh.setMatrixAt(wk.base + i, m);
    }
    wk.mesh.instanceMatrix.needsUpdate = true;

    // status: beacons, danger outline
    const st = s.status || 'safe';
    if (st === 'danger') {
      beaconMat.emissive.set('#E0483A');
      beaconMat.emissiveIntensity = 2.2;
      beams.visible = true;
      beamA += rdt * (reduced ? 1.2 : 4.2);
      beams.rotation.y = beamA;
      beamMat.opacity = 0.16;
      dyn.hull.visible = true;
      dyn.hull.material.opacity = 0.35 + 0.35 * Math.sin(now / 1000 * (reduced ? 2 : 6));
    } else {
      beams.visible = false;
      dyn.hull.visible = false;
      if (st === 'warn') { beaconMat.emissive.set('#E2A12A'); beaconMat.emissiveIntensity = 1.2 + (reduced ? 0 : 0.8 * Math.sin(now / 1000 * 2.4)); }
      else beaconMat.emissiveIntensity = 0;
    }

    render();
    placeLabels();
  }

  function render() {
    needsRender = false;
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  /* ---------------------------------------------------------------- init */
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container); else window.addEventListener('resize', resize);
  resize();
  setQuality(opts.tier || 'medium');
  overview(true);
  // compile shaders up front so the first frames do not hitch
  try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
  progress(1);

  return {
    kind: '3d',
    canvas,
    update,
    focusPart: (id) => focusPart(id, false),
    overview: () => overview(false),
    isOverview: () => atOverview,
    setQuality,
    getQuality: () => tierName,
    setInsets(right, bottom) {
      right = Math.max(0, right | 0); bottom = Math.max(0, bottom | 0);
      if (right === inset.right && bottom === inset.bottom) return;
      inset = { right, bottom }; resize();
      if (atOverview && !fly) overview(true);
    },
    setReducedMotion(b) { reduced = !!b; if (reduced) controls.autoRotate = false; },
    info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries, tier: tierName }; },
    focusedPart: () => focused,
    // screen position of the rod handle (used by the automated tests)
    handlePoint() {
      const v = tmpV.copy(dyn.handleAnchor);
      v.y += dyn.rods.position.y - 3.6;
      v.project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    },
    dispose() {
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      container.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      controls.dispose();
      setupPost(false);
      plant.disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* ignore */ } });
      [beaconMat, beamMat, beamGeo, plumeGeo, plumeMat, puff, sky, beacon.geometry].forEach((d) => d.dispose());
      if (dyn.sign.tex) dyn.sign.tex.dispose();
      if (envRT) envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.remove(); layer.remove();
    }
  };
}
