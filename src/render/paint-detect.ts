/**
 * Decide which parts of an imported car model are painted body panels.
 * Pure logic (no Three.js) so it can be unit-tested; the renderer supplies one entry per mesh
 * or material slot.
 */
export interface PartInfo {
  /** mesh (node) name */
  name: string;
  /** material name */
  material: string;
  /** bounding-box diagonal in model units */
  size: number;
  transparent: boolean;
}

const NOT_PAINT = /glass|window|windshield|windscreen|tyre|tire|rubber|chrome|light|lamp|lens|interior|seat|dash|steer|rim|wheel|brake|disc|caliper|plate|licen[cs]e|grill|grille|exhaust|engine|chassis|under|lowerarm|upperarm|subframe|swaybar|radiator|transmission|strut|stut|tierod|halfshaft|shock|spring|hub|fueltank|differential|diff|steeringbox|suspension|logo|badge|emblem|wiper|plastic|trim|mirror_?glass|carbon|metal_?dark|black_?matte|shadow|ao_?plane/i;
const PAINT = /paint|body|carpaint|car_paint|exterior|shell|coat|hood|bonnet|door|fender|wing|bumper|trunk|boot|roof|quarter|panel|spoiler/i;

/** Indices of parts that should get the paint system. */
export function guessPaintParts(parts: PartInfo[]): number[] {
  const label = (p: PartInfo) => `${p.name} ${p.material}`;
  const candidates = parts.map((p, i) => [p, i] as const).filter(([p]) => !p.transparent && !NOT_PAINT.test(label(p)));
  if (!candidates.length) return [];

  const named = candidates.filter(([p]) => PAINT.test(label(p))).map(([, i]) => i);
  if (named.length) return named;

  // No helpful names: the body is usually the material that covers the most of the car.
  const bySize = new Map<string, { total: number; idx: number[] }>();
  for (const [p, i] of candidates) {
    const key = p.material || `#${i}`;
    const g = bySize.get(key) ?? { total: 0, idx: [] };
    g.total += p.size;
    g.idx.push(i);
    bySize.set(key, g);
  }
  return [...bySize.values()].sort((a, b) => b.total - a.total)[0].idx;
}
