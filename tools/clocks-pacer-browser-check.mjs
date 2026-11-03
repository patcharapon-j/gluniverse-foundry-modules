/** Run from the browser harness with its Foundry ApplicationV2 stub in place. */
export async function runClocksPacerBrowserChecks() {
  const { DiceSlot } = await import('../scripts/features/clocks-tracker/delving/dice-slot.js');
  const { SignalBand, playPerilSplash } = await import('../scripts/features/stream-pacer/band.js');
  const { perilStageHTML } = await import('../scripts/features/stream-pacer/render.js');
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
  // Stream Pacer: the Dire Peril splash mounts its stage, lets clicks through
  // to the table, and ends once
  let done = 0;
  const splash = playPerilSplash({ html: perilStageHTML({ dire: 'Dire', peril: 'Peril', tag: 'Tag', subtitle: 'Sub', runTop: 'a', runBottom: 'b' }), onDone: () => ++done });
  assert(splash.el.isConnected && splash.el.querySelectorAll('.sp-pk-l').length === 9, 'peril splash mounts one span per title letter');
  assert(getComputedStyle(splash.el).pointerEvents === 'none', 'peril splash never takes a click');
  assert(splash.el.style.getPropertyValue('--sp-peril-stage').endsWith('ms'), 'peril splash writes the stage length its keyframes share');
  splash.finish();
  splash.finish();
  assert(done === 1 && !splash.el.isConnected, 'peril splash ends exactly once and leaves the DOM');

  // Stream Pacer: the band keeps lane order across arrivals, departures and moves.
  // A fresh lane whose slot is last has nextElementSibling === null like an
  // inserted one, and used to be skipped, so the next insert threw.
  const L = (k) => k;
  const lane = (key, kind) => ({ key, stamp: '', kind, tone: 'paper', icon: 'fa-solid fa-hand', label: { raw: key }, title: { raw: key }, ticker: [{ raw: key }], clock: null, count: null, people: [], actions: [], urgent: false, calm: false });
  const band = new SignalBand({ L, onAction() {} });
  const order = () => Array.from(band.list.children, (el) => el.dataset.key).filter((k) => !band.items.get(k)?.leaving);
  band.update([lane('a', 'safety'), lane('b', 'call'), lane('c', 'hands')], 0);
  assert(order().join() === 'a,b,c', 'band draws lanes in the order given');
  band.update([lane('b', 'call'), lane('d', 'mine'), lane('c', 'hands')], 0);
  assert(order().join() === 'b,d,c', 'band inserts, keeps and drops lanes in order');
  band.update([lane('e', 'safety'), lane('c', 'hands'), lane('b', 'call')], 0);
  assert(order().join() === 'e,c,b', 'band reorders kept lanes');
  band.destroy();
  assert(!document.getElementById('sp-band'), 'band destroy removes its root');
  return checks;
}
