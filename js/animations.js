/*
 * Lottie animations, loaded from the CDN on first use.
 * An element with data-lottie="<name>" plays assets/lottie/<name>.json; its
 * children are shown as a fallback until the animation has loaded.
 */

const LOTTIE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie_light.min.js';

let lottiePromise = null;
const playing = new Set();

function loadLottie() {
  if (!lottiePromise) {
    lottiePromise = new Promise((resolve, reject) => {
      if (window.lottie) return resolve(window.lottie);
      const script = document.createElement('script');
      script.src = LOTTIE_SRC;
      script.async = true;
      script.onload = () => resolve(window.lottie);
      script.onerror = () => { lottiePromise = null; reject(new Error('Could not load lottie-web')); };
      document.head.append(script);
    });
  }
  return lottiePromise;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Starts every [data-lottie] element inside root that isn't playing yet.
 * If lottie-web can't load, the fallback content simply stays visible.
 * @param {ParentNode} [root=document]
 */
export async function mountAnimations(root = document) {
  const hosts = [...root.querySelectorAll('[data-lottie]:not([data-mounted])')];
  if (!hosts.length) return;
  hosts.forEach(host => { host.dataset.mounted = ''; });

  let lottie;
  try { lottie = await loadLottie(); } catch { return; }

  // Free animations whose container was replaced since the last mount.
  playing.forEach(anim => {
    if (!anim.wrapper?.isConnected) { anim.destroy(); playing.delete(anim); }
  });

  for (const host of hosts) {
    if (!host.isConnected) continue;
    const still = reducedMotion();
    const anim = lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: host.dataset.loop !== 'false',
      autoplay: !still,
      path: `assets/lottie/${host.dataset.lottie}.json`,
    });
    anim.addEventListener('DOMLoaded', () => {
      host.classList.add('lottie-ready');
      if (still) anim.goToAndStop(anim.totalFrames - 1, true);
    });
    playing.add(anim);
  }
}
