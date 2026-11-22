import * as THREE from 'three';

export type LightId = 'booth' | 'sun' | 'cloud' | 'sunset' | 'night';

export const LIGHTS: Record<LightId, { label: string; bg: string; floor: number; exposure: number }> = {
  booth: { label: 'Booth', bg: '#c9ccd0', floor: 0x4f5358, exposure: 0.95 },
  sun: { label: 'Noon sun', bg: '#9cc3e6', floor: 0xb49d7a, exposure: 0.75 },
  cloud: { label: 'Overcast', bg: '#b7bcc2', floor: 0x676b70, exposure: 1.05 },
  sunset: { label: 'Sunset', bg: '#3a2240', floor: 0x3a2c2a, exposure: 1 },
  night: { label: 'Street lamps', bg: '#0b0d12', floor: 0x1b1d21, exposure: 1.5 },
};

type V3 = [number, number, number];

/** Sky dome with a vertical gradient (linear RGB values, may exceed 1). */
function gradientDome(top: V3, horizon: V3, ground: V3) {
  const g = new THREE.SphereGeometry(50, 32, 24);
  const pos = g.attributes.position;
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    const c = y > 0
      ? top.map((v, j) => horizon[j] + (v - horizon[j]) * Math.pow(y, 0.6))
      : ground.map((v, j) => horizon[j] + (v - horizon[j]) * Math.min(1, -y * 4));
    col.push(...c);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
}

/** Emissive shape: colour × intensity in linear RGB, so it can act as a light source in the environment map. */
function glow(geo: THREE.BufferGeometry, col: V3, k: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...col).multiplyScalar(k) }));
  m.position.set(x, y, z);
  return m;
}

export function buildEnvironment(id: LightId, pmrem: THREE.PMREMGenerator): THREE.Texture {
  const e = new THREE.Scene();
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const ball = (r: number) => new THREE.SphereGeometry(r, 16, 12);
  switch (id) {
    case 'booth':
      e.add(gradientDome([0.75, 0.76, 0.78], [0.6, 0.62, 0.64], [0.07, 0.07, 0.08]));
      for (const z of [-6, 0, 6]) e.add(glow(box(30, 0.2, 1.4), [1, 1, 1], 7, 0, 14, z));
      for (const z of [-9, -3, 3, 9]) {
        e.add(glow(box(0.2, 6, 1.2), [1, 1, 1], 4, 16, 6, z));
        e.add(glow(box(0.2, 6, 1.2), [1, 1, 1], 4, -16, 6, z));
      }
      break;
    case 'sun':
      e.add(gradientDome([0.12, 0.3, 0.85], [0.8, 0.85, 0.9], [0.55, 0.43, 0.3]));
      e.add(glow(ball(2.2), [1, 0.95, 0.85], 140, 12, 40, 10));
      break;
    case 'cloud':
      e.add(gradientDome([1, 1, 1.02], [0.85, 0.86, 0.88], [0.22, 0.22, 0.22]));
      break;
    case 'sunset':
      e.add(gradientDome([0.12, 0.08, 0.3], [1.5, 0.55, 0.18], [0.08, 0.06, 0.05]));
      e.add(glow(ball(3), [1, 0.5, 0.15], 50, -30, 4, -30));
      break;
    case 'night':
      e.add(gradientDome([0.004, 0.004, 0.008], [0.02, 0.02, 0.03], [0.01, 0.01, 0.01]));
      e.add(glow(ball(1), [1, 0.55, 0.2], 40, 14, 12, 6));
      e.add(glow(ball(1), [1, 0.55, 0.2], 40, -14, 12, -8));
      e.add(glow(box(10, 0.15, 0.6), [0.8, 0.9, 1], 10, 0, 16, 14));
      break;
  }
  return pmrem.fromScene(e, 0.02).texture;
}
