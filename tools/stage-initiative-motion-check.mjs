/** Browser checks against the production classes. Run from the motion preview. */
export async function runStageInitiativeMotionChecks() {
  const { StageOverlay } = await import('../scripts/features/stage/StageOverlay.js');
  const { GLUniverseInitiativeOverlay } = await import('../scripts/features/initiative/gluniverse-initiative.mjs');
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const image = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="${color}"/></svg>`)}`;
  const actor = name => ({ name, image: image(name === 'A' ? 'purple' : name === 'B' ? 'blue' : 'green') });
  const stage = new StageOverlay();
  stage._ensurePostFX = () => null;
  stage.render();
  stage._element.style.setProperty('--gl-motion-scale', '0.1');
  const state = (name, extra = {}) => ({ visible: true, slots: [{ slotId: 'motion-check', actor: name ? actor(name) : null }], ...extra });
  try {
    stage.applyState(state('A'));
    stage.applyState(state('B'));
    stage.applyState(state('C'));
    await wait(180);
    check(stage._element.querySelector('.stage-actor-img').alt === 'C', 'Stage rapid replacement settles on the latest actor');
    stage.applyState(state(null));
    stage.applyState(state('A'));
    await wait(120);
    check(stage._element.querySelector('.stage-actor-img')?.alt === 'A', 'Stage reassignment cancels pending content removal');
    const slot = stage._element.querySelector('.stage-slot');
    stage.applyState({ slots: [] });
    stage.applyState(state('B'));
    await wait(180);
    check(stage._element.querySelector('.stage-slot') === slot && !stage._exitingElements.size, 'Stage revived slot survives an interrupted exit without duplication');
    stage.applyState({ visible: false });
    stage.applyState({ visible: true });
    await wait(120);
    check(!stage._element.classList.contains('hidden'), 'Stage hide/show reversal remains visible');
    stage._element.style.setProperty('--gl-motion-scale', '0');
    stage.applyState(state('C'));
    await wait(80);
    check(stage._element.querySelector('.stage-actor-img')?.alt === 'C', 'Stage zero duration settles without an uninitialized callback');
    stage.applyState(state('B'));
    stage.close();
    await wait(120);
    check(stage._motions.size === 0 && !document.querySelector('#gluniverse-stage-overlay'), 'Stage close cancels every channel without late DOM resurrection');
  } finally { stage.close(); }

  const initiative = new GLUniverseInitiativeOverlay();
  initiative.root = document.createElement('div');
  initiative.root.className = 'gluni-initiative';
  initiative.root.style.setProperty('--gl-motion-scale', '0.1');
  document.body.append(initiative.root);
  try {
    initiative.root.innerHTML = '<div class="gluni-card" data-gluni-key="a" style="width:100px;height:80px"></div>';
    const card = initiative.root.firstElementChild;
    const rect = card.getBoundingClientRect();
    initiative.animateTurnChange(new Map([['a', { ...rect.toJSON(), left: rect.left + 120 }]]));
    await wait(25);
    check(card.classList.contains('gluni-anime-motion'), 'Initiative FLIP owns the moving card');
    initiative.clearPresentationMotion();
    check(!card.style.getPropertyValue('--gluni-flip-x'), 'Initiative cancellation restores FLIP variables');
    initiative.spawnCollectGhosts([{ html: '<div class="gluni-card" id="duplicate-id">A</div>', rect }], rect);
    check(document.querySelector('.gluni-card-ghost')?.inert && !document.querySelector('.gluni-card-ghost [id]'), 'Initiative collect ghosts are inert and have no duplicate IDs');
    initiative.clearPresentationMotion();
    check(!document.querySelector('.gluni-card-ghost-layer'), 'Initiative teardown removes collect layers immediately');
    const splash = () => {
      const el = document.createElement('div');
      el.style.setProperty('--gl-motion-scale', '0.1');
      el.innerHTML = '<div class="gluni-round-rule"></div><div class="gluni-round-splash-inner"><div class="gluni-round-label"><span class="tick"></span><span>ROUND</span></div><span class="d">2</span><div class="gluni-round-sub"><span>Cycle</span></div></div>';
      document.body.append(el);
      return el;
    };
    const first = splash();
    let cleaned = 0;
    initiative.playSplashMotion(first, 'round', () => cleaned++);
    const second = splash();
    initiative.playSplashMotion(second, 'round', () => cleaned++);
    check(!first.isConnected && cleaned === 1, 'Initiative replacement disposes the previous splash once');
    await wait(300);
    check(!second.isConnected && cleaned === 2 && !initiative._splashes.size, 'Initiative splash timeline completes and releases ownership');
    const instant = splash();
    instant.style.setProperty('--gl-motion-scale', '0');
    initiative.playSplashMotion(instant, 'round');
    await wait(80);
    check(!instant.isConnected && !initiative._splashes.size, 'Initiative zero duration releases the splash');
  } finally {
    initiative.clearPresentationMotion();
    initiative.root.remove();
  }
  return results;
}
