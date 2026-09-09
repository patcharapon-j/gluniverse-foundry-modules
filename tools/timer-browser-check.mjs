/** Actual DOM/Anime.js cleanup and authoritative Timer HUD behavior. */
export async function runTimerBrowserChecks() {
  const { TimerMotion } = await import('../scripts/features/timer/motion.mjs');
  const { TimerHUD } = await import('../scripts/features/timer/hud.mjs');
  const results = [];
  const check = (v, message) => { if (!v) throw new Error(message); results.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const root = document.createElement('div');
  root.innerHTML = '<div class="gltimer-face"><span class="gltimer-main">00</span></div><span class="gltimer-sheen-light"></span><div class="gltimer-impact"></div>';
  document.body.append(root);
  root.style.setProperty('--gl-motion-scale', '.1');
  const motion = new TimerMotion(root);
  try {
    motion.emphasize(true);
    await wait(30);
    motion.clear();
    check(getComputedStyle(root.querySelector('.gltimer-impact')).opacity === '0', 'Timer cancellation restores invisible impact ring');
    check(!root.querySelector('.gltimer-main').style.transform, 'Timer cancellation restores digit geometry');
    motion.reveal();
    // Wait for the visual endpoint, allowing the browser to schedule the first
    // frame under the combined suite's rendering load.
    const deadline = performance.now() + 1200;
    do { await wait(30); } while (getComputedStyle(root.querySelector('.gltimer-sheen-light')).opacity !== '0' && performance.now() < deadline);
    check(getComputedStyle(root.querySelector('.gltimer-sheen-light')).opacity === '0', 'Timer entrance sheen reaches an invisible endpoint');
    motion.clear();
    root.style.setProperty('--gl-motion-scale', '0');
    motion.reveal(); motion.emphasize(true);
    check(!root.querySelector('.gltimer-main').style.transform, 'Timer zero motion leaves digits at rest');
  } finally { motion.clear(); root.remove(); }
  const hud = new TimerHUD.constructor();
  try {
    hud.mount();
    hud.el.style.setProperty('--gl-motion-scale','0');
    hud.onState({ active:true,running:true,expired:false,worldPaused:false,remainingMs:5000,totalMs:5000,anchor:Date.now()-1000 });
    await wait(40);
    check(hud._lastRem <= 4000 && hud._lastRem > 3700, 'Timer zero-motion countdown still follows wall-clock anchor');
    hud.onState({ active:true,running:false,expired:false,worldPaused:false,remainingMs:3500,totalMs:5000,anchor:Date.now() });
    await wait(40);
    const frozen = hud._lastMain + hud._lastFrac;
    await wait(50);
    check(hud._lastMain + hud._lastFrac === frozen, 'Timer paused digits remain frozen while presentation is independent');
    hud.onState({active:false});
    const stopDeadline = performance.now() + 1000;
    do { await wait(30); } while (hud.el.style.display !== 'none' && performance.now() < stopDeadline);
    check(hud.el.style.display === 'none', 'Timer stop hides HUD and clears motion');
  } finally { hud.destroy(); }
  return results;
}
