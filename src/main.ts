import './styles.css';
import { initBench, attachBooth } from './ui/bench.ts';
import { initCalibration } from './ui/calibrate.ts';
import { $, view } from './ui/store.ts';

document.querySelector<HTMLButtonElement>('#lockApp')?.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    location.replace('/');
  }
});

initBench(null);
initCalibration();

function startBooth() {
  void import('./render/booth.ts').then(({ Booth }) => {
    const booth = new Booth($<HTMLCanvasElement>('cv'), $('view'));
    booth.setLight(view.light);
    booth.setShape(view.shape);
    attachBooth(booth);
  }).catch((err) => {
    console.error(err);
    $('fail').style.display = 'grid';
  });
}

if ('requestIdleCallback' in window) {
  window.requestIdleCallback(startBooth, { timeout: 1500 });
} else {
  setTimeout(startBooth);
}
