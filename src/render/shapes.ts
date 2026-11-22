import * as THREE from 'three';

/** Curved test panel: a cylinder segment, so flake and pearl flop is visible across it. */
export function buildPanel(paint: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.3, 64, 1, true, -0.5, 1), paint);
  m.position.set(0, 0.95, -1.8);
  return m;
}

export function buildSphere(paint: THREE.Material) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.8, 96, 64), paint);
  m.position.y = 0.85;
  return m;
}

/** Soft contact shadow under the object. */
export function shadowBlob(w: number, d: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.75)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  return m;
}

function glassStrip(p1: [number, number], p2: [number, number], halfWidth: number, offset: number, mat: THREE.Material) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy);
  const nx = (-dy / L) * offset, ny = (dx / L) * offset;
  const a = [p1[0] + dx * 0.06 + nx, p1[1] + dy * 0.06 + ny], b = [p2[0] - dx * 0.06 + nx, p2[1] - dy * 0.06 + ny];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a[0], a[1], -halfWidth, b[0], b[1], -halfWidth, b[0], b[1], halfWidth, a[0], a[1], halfWidth], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Simple procedural coupe: extruded side profile with wheel arches, glass, wheels and lamps. */
export function buildCar(paint: THREE.Material) {
  const s = new THREE.Shape();
  s.moveTo(-2.15, 0.3);
  s.lineTo(-2.25, 0.6);
  s.quadraticCurveTo(-2.28, 0.92, -1.95, 0.96);
  s.lineTo(-1.25, 1);
  s.quadraticCurveTo(-0.9, 1.25, -0.6, 1.38);
  s.quadraticCurveTo(0, 1.46, 0.4, 1.4);
  s.lineTo(1, 1);
  s.quadraticCurveTo(1.2, 0.9, 2.05, 0.84);
  s.quadraticCurveTo(2.3, 0.8, 2.28, 0.5);
  s.lineTo(2.2, 0.3);
  s.lineTo(1.86, 0.3);
  s.absarc(1.4, 0.36, 0.46, 0, Math.PI, false);
  s.lineTo(0.94, 0.3);
  s.lineTo(-0.94, 0.3);
  s.absarc(-1.4, 0.36, 0.46, 0, Math.PI, false);
  s.lineTo(-2.15, 0.3);
  const body = new THREE.ExtrudeGeometry(s, { depth: 1.4, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.16, bevelSegments: 8, curveSegments: 28 });
  body.translate(0, 0, -0.7);

  const car = new THREE.Group();
  car.add(new THREE.Mesh(body, paint));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x07090c, roughness: 0.04, metalness: 0, clearcoat: 1, side: THREE.DoubleSide });
  const win = new THREE.Shape([[-1.12, 1.03], [-0.62, 1.3], [0.35, 1.33], [0.92, 1.03]].map(([x, y]) => new THREE.Vector2(x, y)));
  for (const z of [0.924, -0.924]) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(win), glass);
    m.position.z = z;
    car.add(m);
  }
  car.add(glassStrip([0.4, 1.4], [1, 1], 0.62, 0.012, glass));
  car.add(glassStrip([-1.25, 1], [-0.6, 1.38], 0.62, 0.06, glass));

  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.25 });
  for (const [x, z] of [[1.4, 0.79], [1.4, -0.79], [-1.4, 0.79], [-1.4, -0.79]]) {
    for (const [r, w, mat] of [[0.36, 0.26, tire], [0.23, 0.28, rim]] as const) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 32), mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, 0.36, z);
      car.add(m);
    }
  }
  const lamp = (col: number, k: number, x: number, y: number, z: number, w: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, w), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k) }));
    m.position.set(x, y, z);
    car.add(m);
  };
  for (const z of [0.6, -0.6]) {
    lamp(0xffffff, 3, 2.27, 0.64, z, 0.34);
    lamp(0xff0d08, 2, -2.27, 0.8, z, 0.4);
  }
  return car;
}
