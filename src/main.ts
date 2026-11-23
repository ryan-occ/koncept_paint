import './styles.css';
import { initBench, attachBooth } from './ui/bench.ts';
import { initCalibration } from './ui/calibrate.ts';
import { initSearch } from './ui/search.ts';
import { initPhotoMatch } from './ui/photo-match.ts';
import { $, view } from './ui/store.ts';

async function lockApp() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', keepalive: true });
  } finally {
    location.replace('/');
  }
}

document.querySelector<HTMLButtonElement>('#lockApp')?.addEventListener('click', () => {
  void lockApp();
});

async function startIdleLock() {
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store' });
    const status: { authenticated?: boolean; idleTimeoutMs?: number } = await response.json();
    if (!response.ok || !status.authenticated) return;

    const idleTimeoutMs = status.idleTimeoutMs ?? 30 * 60 * 1000;
    let lastActivityAt = Date.now();
    let lastServerRefreshAt = lastActivityAt;
    let timer: number;

    const scheduleLock = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const remaining = idleTimeoutMs - (Date.now() - lastActivityAt);
        if (remaining <= 0) void lockApp();
        else scheduleLock();
      }, idleTimeoutMs - (Date.now() - lastActivityAt));
    };

    const onActivity = () => {
      if (document.hidden) return;
      lastActivityAt = Date.now();
      scheduleLock();
      const refreshInterval = Math.min(60_000, idleTimeoutMs / 3);
      if (lastActivityAt - lastServerRefreshAt < refreshInterval) return;
      lastServerRefreshAt = lastActivityAt;
      void fetch('/api/auth/activity', { method: 'POST', keepalive: true })
        .then((activityResponse) => {
          if (!activityResponse.ok) void lockApp();
        })
        .catch(() => {});
    };

    for (const eventName of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const remaining = idleTimeoutMs - (Date.now() - lastActivityAt);
      if (remaining <= 0) void lockApp();
      else scheduleLock();
    });
    scheduleLock();
  } catch {
    // The server also enforces the signed idle deadline on every authenticated request.
  }
}

void startIdleLock();

initBench(null);
initCalibration();
initSearch();
initPhotoMatch();

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
