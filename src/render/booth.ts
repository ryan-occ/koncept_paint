import * as THREE from 'three';
import { PEARLS } from '../data/toners.ts';
import { POWDERS } from '../data/powders.ts';
import { midFactor } from '../color/mixing.ts';
import { hexToLinear } from '../color/space.ts';
import type { FlakeSize, Mix, RGB } from '../types.ts';
import { buildCar, buildPanel, buildSphere, shadowBlob } from './shapes.ts';
import { buildEnvironment, LIGHTS, type LightId } from './lighting.ts';
import { guessPaintParts } from './paint-detect.ts';

export type ShapeId = 'panel' | 'sphere' | 'car' | 'custom';
type CarPaintPart = { meshIndex: number; materialIndex: number | null };

const VIEW: Record<ShapeId, { rad: number; y: number; min: number; max: number; repeat: number }> = {
  car: { rad: 7.6, y: 0.7, min: 4.5, max: 13, repeat: 3 },
  // Imported models usually map UVs 0..1 over whole parts, so flakes need a high repeat.
  custom: { rad: 7.6, y: 0.65, min: 4, max: 13, repeat: 40 },
  panel: { rad: 4.2, y: 0.95, min: 2.6, max: 7, repeat: 10 },
  sphere: { rad: 3.6, y: 0.85, min: 2.2, max: 6, repeat: 14 },
};

function canvasTexture(renderer: THREE.WebGLRenderer, size: number, draw: (x: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

/** Random normal-map flakes; pixel size sets flake size. */
function flakeTexture(r: THREE.WebGLRenderer, fs: FlakeSize) {
  const px = { fine: 1, medium: 2, coarse: 3 }[fs];
  return canvasTexture(r, 512, (x, s) => {
    x.fillStyle = 'rgb(128,128,255)';
    x.fillRect(0, 0, s, s);
    const n = ((s * s) / (px * px)) * 0.45;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, d = Math.random() * 0.95;
      x.fillStyle = `rgb(${(128 + Math.cos(a) * d * 127) | 0},${(128 + Math.sin(a) * d * 127) | 0},${(200 + Math.random() * 55) | 0})`;
      x.fillRect((Math.random() * s) | 0, (Math.random() * s) | 0, px, px);
    }
  });
}

/** Soft bumps for clear-coat orange peel. */
function peelTexture(r: THREE.WebGLRenderer) {
  return canvasTexture(r, 256, (x, s) => {
    x.fillStyle = 'rgb(128,128,255)';
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const cx = Math.random() * s, cy = Math.random() * s, rr = 3 + Math.random() * 7;
      const g = x.createRadialGradient(cx - rr * 0.4, cy - rr * 0.4, 0, cx, cy, rr);
      g.addColorStop(0, 'rgba(90,90,255,.5)');
      g.addColorStop(0.6, 'rgba(170,170,255,.35)');
      g.addColorStop(1, 'rgba(128,128,255,0)');
      x.fillStyle = g;
      x.beginPath();
      x.arc(cx, cy, rr, 0, 7);
      x.fill();
    }
  });
}

/** The 3D preview: one shared physical paint material on a panel, sphere or car under a lighting preset. */
export class Booth {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  private pmrem: THREE.PMREMGenerator;
  private mat: THREE.MeshPhysicalMaterial;
  private peel: THREE.CanvasTexture;
  private flake?: THREE.CanvasTexture;
  private lastFs?: FlakeSize;
  private floor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private groups: Record<ShapeId, THREE.Group>;
  private envCache: Partial<Record<LightId, THREE.Texture>> = {};
  private target = new THREE.Vector3();
  private shape: ShapeId = 'panel';
  private th = 0.9;
  private ph = 1.18;
  private rad = 7.5;
  private minR = 4;
  private maxR = 12;
  private pointers = new Map<number, [number, number]>();
  autoRotate = true;
  /** When on, a click (not a drag) on the imported car toggles whether that part is painted. */
  pickMode = false;
  onPaintPartsChange?: (painted: number[]) => void;
  private carModel?: {
    root: THREE.Object3D;
    meshes: THREE.Mesh[];
    originals: (THREE.Material | THREE.Material[])[];
    parts: CarPaintPart[];
    painted: Set<number>;
  };

  constructor(canvas: HTMLCanvasElement, private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.peel = peelTexture(this.renderer);
    this.mat = new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatNormalMap: this.peel, side: THREE.DoubleSide });

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor);

    const g = (...o: THREE.Object3D[]) => { const x = new THREE.Group(); x.add(...o); this.scene.add(x); return x; };
    this.groups = {
      car: g(buildCar(this.mat), shadowBlob(6, 3.2)),
      panel: g(buildPanel(this.mat), shadowBlob(2.4, 1.2)),
      sphere: g(buildSphere(this.mat), shadowBlob(2.2, 2.2)),
      custom: g(shadowBlob(6, 3.2)),
    };

    new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.fitCustomCamera();
    }).observe(host);
    this.bindControls(canvas);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setLight(id: LightId) {
    const L = LIGHTS[id];
    this.envCache[id] ??= buildEnvironment(id, this.pmrem);
    this.scene.environment = this.envCache[id]!;
    this.scene.background = new THREE.Color(L.bg);
    this.floor.material.color.set(L.floor);
    this.renderer.toneMappingExposure = L.exposure;
    this.host.style.background = L.bg;
  }

  setShape(id: ShapeId) {
    this.shape = id;
    for (const [k, grp] of Object.entries(this.groups)) grp.visible = k === id;
    const v = VIEW[id];
    this.rad = v.rad;
    this.minR = v.min;
    this.maxR = v.max;
    this.target.set(0, v.y, 0);
    this.setRepeat(v.repeat);
    this.fitCustomCamera(true);
  }

  private fitCustomCamera(reset = false) {
    if (this.shape !== 'custom' || !this.carModel) return;
    const box = new THREE.Box3().setFromObject(this.carModel.root);
    const size = box.getSize(new THREE.Vector3());
    const width = Math.max(size.x, size.z);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const fitRadius = width / (2 * Math.tan(halfFov) * Math.max(this.camera.aspect, 0.1) * 0.72);
    this.rad = reset ? Math.max(this.minR, fitRadius) : Math.max(this.rad, fitRadius);
    this.maxR = Math.max(this.maxR, this.rad * 1.8);
  }

  /**
   * Load a .glb car model, scale it to car size on the booth floor and paint its body panels.
   * `painted` restores a saved choice of paint parts; otherwise they are detected.
   * Returns the painted part indices.
   */
  async loadCarModel(data: ArrayBuffer, painted?: number[] | null, paintMaterials?: string[]): Promise<number[]> {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const root = gltf.scene;

    // Fit: longest horizontal side to 4.6 units (a car's length), centred, wheels on the floor.
    let box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = 4.6 / Math.max(size.x, size.z, 1e-6);
    root.scale.multiplyScalar(scale);
    box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    root.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));

    const meshes: THREE.Mesh[] = [];
    root.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    if (!meshes.length) throw new Error('The file has no 3D parts to paint.');
    const parts = meshes.flatMap((mesh, meshIndex) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materialIndexes: (number | null)[] = Array.isArray(mesh.material)
        ? [...new Set(mesh.geometry.groups.length
          ? mesh.geometry.groups.map((group) => group.materialIndex)
            .filter((index): index is number => typeof index === 'number' && Number.isInteger(index))
          : materials.map((_, index) => index))]
          .filter((index) => index >= 0 && index < materials.length)
        : [null];
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).length();
      return materialIndexes.map((materialIndex) => {
        const material = materialIndex === null ? materials[0] : materials[materialIndex];
        const info = {
          name: mesh.name,
          material: material.name,
          size,
          transparent: (material.transparent && material.opacity < 0.95) ||
            (material as THREE.MeshPhysicalMaterial).transmission > 0.2,
        };
        return { meshIndex, materialIndex, info };
      });
    });
    const infos = parts.map((part) => part.info);
    const detected = guessPaintParts(infos);
    const requestedMaterials = new Set((paintMaterials ?? []).map((name) => name.trim().toLowerCase()));
    const byMaterial = requestedMaterials.size
      ? parts.flatMap((part, index) =>
        requestedMaterials.has(part.info.material.trim().toLowerCase()) && detected.includes(index) ? [index] : [],
      )
      : [];
    if (requestedMaterials.size && !byMaterial.length) {
      throw new Error(`None of the configured paint materials were found: ${[...requestedMaterials].join(', ')}`);
    }
    const chosen = painted != null
      ? painted.filter((i) => i >= 0 && i < parts.length)
      : byMaterial.length ? byMaterial : detected;

    this.clearCarModel();
    this.carModel = {
      root,
      meshes,
      originals: meshes.map((m) => m.material),
      parts: parts.map(({ meshIndex, materialIndex }) => ({ meshIndex, materialIndex })),
      painted: new Set(chosen),
    };
    this.applyPaintParts();
    this.groups.custom.add(root);
    return [...this.carModel.painted];
  }

  clearCarModel() {
    if (!this.carModel) return;
    this.groups.custom.remove(this.carModel.root);
    this.carModel.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.carModel = undefined;
  }

  get hasCarModel() { return !!this.carModel; }

  private applyPaintParts() {
    const c = this.carModel;
    if (!c) return;
    const materials: (THREE.Material | THREE.Material[])[] = c.originals.map((original) =>
      Array.isArray(original) ? [...original] : original,
    );
    for (const partIndex of c.painted) {
      const part = c.parts[partIndex];
      if (!part) continue;
      if (part.materialIndex === null) {
        materials[part.meshIndex] = this.mat;
      } else {
        const slots = Array.isArray(materials[part.meshIndex])
          ? [...materials[part.meshIndex] as THREE.Material[]]
          : [materials[part.meshIndex] as THREE.Material];
        slots[part.materialIndex] = this.mat;
        materials[part.meshIndex] = slots;
      }
    }
    c.meshes.forEach((mesh, i) => { mesh.material = materials[i]; });
  }

  togglePaintPart(index: number) {
    const c = this.carModel;
    if (!c || index < 0 || index >= c.parts.length) return;
    if (c.painted.has(index)) c.painted.delete(index); else c.painted.add(index);
    this.applyPaintParts();
    this.onPaintPartsChange?.([...c.painted]);
  }

  private pickAt(clientX: number, clientY: number) {
    const c = this.carModel;
    if (!c || this.shape !== 'custom') return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(c.meshes, false)[0];
    if (hit) {
      const meshIndex = c.meshes.indexOf(hit.object as THREE.Mesh);
      const materialIndex = hit.face?.materialIndex ?? null;
      const partIndex = c.parts.findIndex((part) =>
        part.meshIndex === meshIndex && (part.materialIndex === null || part.materialIndex === materialIndex),
      );
      if (partIndex >= 0) this.togglePaintPart(partIndex);
    }
  }

  private setRepeat(k: number) {
    const sx = this.shape === 'sphere' ? 2 : 1;
    this.flake?.repeat.set(k * sx, k);
    this.peel.repeat.set((k / 3) * sx, k / 3);
  }

  /** Map the paint system onto the physical material. `rgb` is the flat colour in linear sRGB. */
  apply(mix: Mix, rgb: RGB) {
    const m = this.mat;
    const flake = mix.fl / 100, fsz = { fine: 0, medium: 0.5, coarse: 1 }[mix.fs];
    if (mix.fs !== this.lastFs) {
      this.flake?.dispose();
      this.flake = flakeTexture(this.renderer, mix.fs);
      m.normalMap = this.flake;
      m.needsUpdate = true;
      this.lastFs = mix.fs;
      this.setRepeat(VIEW[this.shape].repeat);
    }
    m.color.setRGB(...rgb, THREE.LinearSRGBColorSpace);
    let metal = flake * 0.8, nrm = flake * (0.25 + 0.5 * fsz);

    if (mix.clr < 1) {
      m.clearcoat = 0;
      m.roughness = 0.55 + 0.1 * fsz;
    } else {
      const cr = { gloss: 0.03, satin: 0.38, matte: 0.72 }[mix.fin];
      m.clearcoat = 1;
      m.clearcoatRoughness = cr;
      m.roughness = mix.fin === 'gloss' ? 0.3 + 0.15 * fsz : Math.max(cr, 0.45);
    }
    const peel = mix.fin === 'gloss' && mix.clr > 0 ? (mix.peel / 100) * 0.4 : 0;
    m.clearcoatNormalScale.set(peel, peel);

    const P = PEARLS[mix.p];
    let irid = mix.p === 'none' ? 0 : mix.pa / 100, film = P[1] || 100, ior = P[2], sheen = 0;
    ([[mix.m1, mix.m1l, false], [mix.m2, mix.m2l, true]] as [string, number, boolean][]).forEach(([k, load, flop]) => {
      const pw = POWDERS[k], f = midFactor(load, mix.mic);
      if (!pw || k === 'none' || !f) return;
      if (flop && (pw.kind === 'int' || pw.kind === 'col')) {
        sheen = f;
        m.sheenColor.setRGB(...hexToLinear(pw.colour), THREE.LinearSRGBColorSpace);
        m.sheenRoughness = 0.35;
        return;
      }
      switch (pw.kind) {
        case 'int': irid = Math.max(irid, f); film = pw.film; ior = 1.8; break;
        case 'col': nrm += f * 0.25; metal += f * 0.2; break;
        case 'spark': nrm += f * 0.9; metal += f * 0.35; break;
        case 'diff':
        case 'holo':
          metal += f * (pw.kind === 'diff' ? 0.6 : 0.7);
          nrm += f * (k === 'holo_std' ? 1.2 : pw.kind === 'holo' ? 0.6 : 0.3);
          if (f * 0.8 > irid) { irid = f * 0.8; film = pw.film; ior = 2; }
          break;
        case 'alu': metal += f * 0.5; nrm += f * 0.3; break;
        case 'glass': nrm += f * 0.8; break;
      }
    });
    m.metalness = Math.min(1, metal);
    m.normalScale.set(nrm, nrm);
    m.sheen = sheen;
    m.iridescence = irid;
    m.iridescenceIOR = ior;
    m.iridescenceThicknessRange = [100, film];
  }

  private bindControls(cv: HTMLCanvasElement) {
    let pinch = 0;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, [e.clientX, e.clientY]); });
    cv.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.rad = Math.min(this.maxR, Math.max(this.minR, (this.rad * pinch) / d));
        pinch = d;
        return;
      }
      this.th -= (e.clientX - prev[0]) * 0.008;
      this.ph = Math.min(1.52, Math.max(0.3, this.ph - (e.clientY - prev[1]) * 0.006));
    });
    let downAt: [number, number] | null = null;
    cv.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      pinch = 0;
      // A click without dragging picks a part when choosing paint parts.
      if (this.pickMode && downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5 && e.type === 'pointerup') this.pickAt(e.clientX, e.clientY);
      downAt = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.rad = Math.min(this.maxR, Math.max(this.minR, this.rad * (1 + e.deltaY * 0.001))); }, { passive: false });
  }

  private frame() {
    if (this.autoRotate && !this.pointers.size) this.th += 0.0025;
    const { target: t, rad, ph, th } = this;
    this.camera.position.set(t.x + rad * Math.sin(ph) * Math.sin(th), t.y + rad * Math.cos(ph), t.z + rad * Math.sin(ph) * Math.cos(th));
    this.camera.lookAt(t);
    this.renderer.render(this.scene, this.camera);
  }
}
