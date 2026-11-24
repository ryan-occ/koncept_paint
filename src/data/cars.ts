/**
 * Built-in car models served from /models. Credits are shown on the preview while a car is
 * on screen, as the CC BY / CC BY-SA licences require. See public/models/CREDITS.md.
 */
export interface BuiltInCar {
  id: string;
  name: string;
  file: string;
  /** material names that carry the body paint in this model */
  paint: string[];
  credit: string;
  sizeMb: number;
}

export const CARS: BuiltInCar[] = [
  {
    id: 'shelby-gt500', name: 'Ford Mustang Shelby GT500', file: 'models/shelby-gt500.glb', paint: ['carpaint'], sizeMb: 11.5,
    credit: '"Ford Mustang Shelby GT500" by Jiaxing, CC BY 4.0, optimised for web',
  },
  {
    id: 'porsche-911-4s', name: 'Porsche 911 Carrera 4S', file: 'models/porsche-911-carrera-4s.glb', paint: ['paint'], sizeMb: 12.9,
    credit: '"(FREE) Porsche 911 Carrera 4S" by Karol Miklas, CC BY-SA 4.0, optimised for web',
  },
  {
    id: 'bmw-m3-e30', name: 'BMW M3 E30', file: 'models/bmw-m3-e30.glb', paint: ['BMW_E30_M3_PAINT'], sizeMb: 4.9,
    credit: '"[FREE] BMW M3 E30" by Martin Trafas, CC BY 4.0, optimised for web',
  },
];
