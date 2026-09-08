/** Run from the browser harness with its Foundry ApplicationV2 stub in place. */
export async function runClocksPacerBrowserChecks() {
  const { DiceSlot } = await import('../scripts/features/clocks-tracker/delving/dice-slot.js');
  const { PerilOverlay } = await import('../scripts/features/stream-pacer/PerilOverlay.js');
  const checks = [];
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const capture = owner => {
    let latest;
    const add = owner.add.bind(owner);
    owner.add = animation => { latest = animation; return add(animation); };
    return () => latest;
  };
  for (const scale of [1, 0]) {
    const host = document.createElement('div');
    host.style.cssText = `position:relative;width:200px;height:56px;--gl-motion-scale:${scale}`;
    document.body.append(host);
    let settled = 0;
    const slot = DiceSlot.mount(host, { faces: [1, 6, 3], size: 6, discard: 2 }, () => ++settled);
    cancelAnimationFrame(slot._frame);
    const latest = capture(slot._motion);
    slot._spin();
    const timeline = latest();
    timeline.pause();
    if (scale) {
      timeline.seek(1100, false);
      assert(!slot.reels[0].reel.classList.contains('drop'), 'discard remains hidden until every reel lands');
      const r = slot.reels[1];
      const y = new DOMMatrix(getComputedStyle(r.strip).transform).m42;
      assert(Math.abs(y + (r.total - 1) * r.cell) < 0.01, 'actual vendor lands on stored face');
      timeline.seek(1500, false);
      assert(slot.reels[0].reel.classList.contains('drop') && !slot.reels[1].reel.classList.contains('drop'), 'discard matches real result');
    }
    timeline.seek(timeline.duration + 1, false);
    assert(settled === 1, `settles once at motion scale ${scale}`);
    slot.destroy();
    assert(settled === 1 && !host.querySelector('.glct-slot'), 'destroy is idempotent and removes overlay');
    host.remove();
  }
  const peril = new PerilOverlay();
  peril._createStageContainer();
  peril._createIndicatorContainer();
  peril._stageEl.style.setProperty('--gl-motion-scale', '1');
  peril._stageEl.innerHTML = '<span class="pk-line-1"><span class="pk-l">D</span></span><span class="pk-line-2"><span class="pk-l">P</span></span>';
  peril._stageEl.classList.add('playing');
  peril._activationToken = 1;
  let handoffs = 0;
  peril._renderIndicator = () => ++handoffs;
  const latest = capture(peril._stageMotion);
  peril._scheduleHandoff(1);
  let timeline = latest(); timeline.pause();
  timeline.seek(3600, false);
  assert(handoffs === 1, 'peril timeline hands off once');
  timeline.seek(4300, false);
  assert(!peril._stageEl.classList.contains('playing') && !peril._stageEl.childElementCount, 'peril stage unmounts at endpoint');
  peril._activationToken = 2;
  peril._scheduleHandoff(2);
  timeline = latest(); timeline.pause();
  peril._hideIndicator();
  timeline.seek(4300, false);
  assert(handoffs === 1, 'dismissed peril never hands off from a stale timeline');
  assert(!peril._indicatorEl.classList.contains('visible'), 'dismiss hides indicator immediately');
  peril.destroy();
  assert(!peril._stageEl && !peril._indicatorEl, 'destroy releases both containers');
  return checks;
}
