import './styles.css';
import { Booth } from './render/booth.ts';
import { initBench } from './ui/bench.ts';
import { initCalibration } from './ui/calibrate.ts';
import { $, view } from './ui/store.ts';

let booth: Booth | null = null;
try {
  booth = new Booth($<HTMLCanvasElement>('cv'), $('view'));
  booth.setLight(view.light);
  booth.setShape(view.shape);
} catch (err) {
  console.error(err);
  $('fail').style.display = 'grid';
}

initBench(booth);
initCalibration();
