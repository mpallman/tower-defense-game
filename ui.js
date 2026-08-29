// ui.js — the DOM half of the game: the HUD, the wave bar, the tab panels.
//
// The panel is built once per tab and then *synced*, never rebuilt on a timer.
// Every value that changes registers an updater closure at build time; each
// frame the sync pass runs them and writes only what actually differs. That is
// what keeps the scroll position, the drag listeners and the pressed state of a
// button alive while the numbers underneath them move.

import { BALANCE } from './balance.js';
import { formatNumber, formatDuration } from './format.js';
import { glyph, towerSpriteUrl, enemySpriteUrl, vaultSpriteUrl } from './icons.js';

// ------------------------------------------------------------- dom helpers --
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setText(node, value) {
  const next = String(value);
  if (node.textContent !== next) node.textContent = next;
}

// `hidden` is an HTMLElement property; an <svg> is not an HTMLElement, so
// setting it there does nothing at all. Toggle the attribute instead — that
// works for every element, and the stylesheet hides [hidden] outright.
function setHidden(node, on) {
  node.toggleAttribute('hidden', !!on);
}

function setStyle(node, prop, value) {
  if (node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value);
}

function tile(url, className = 'tile') {
  const node = el('i', className);
  node.style.backgroundImage = `url(${url})`;
  return node;
}

function chip(iconName, className = 'chip') {
  const node = el('span', className);
  node.append(glyph(iconName));
  const value = el('b');
  node.append(value);
  return { node, value };
}

const rate = (perSecond) => `${perSecond.toFixed(perSecond < 10 ? 1 : 0)}/s`;

export function createUI({ game, audio, toast, makeDraggable }) {
  const state = game.state;

  const dom = {
    stats: document.getElementById('stats'),
    waveName: document.getElementById('wave-name'),
    waveNote: document.getElementById('wave-note'),
    waveFill: document.getElementById('wave-fill'),
    roster: document.getElementById('roster'),
    panel: document.getElementById('panel'),
    tabs: document.getElementById('tabs'),
    pause: document.getElementById('btn-pause'),
    speed: document.getElementById('btn-speed'),
  };

  let tab = 'build';
  let updaters = [];
  let rosterWave = -1;

  // Register a value that changes while the panel stays put.
  function bind(fn) {
    updaters.push(fn);
    fn();
  }

  // ------------------------------------------------------------------ hud --
  const STAT_DEFS = [
    { key: 'credits', icon: 'credits', label: 'Credits', tone: 'gold' },
    { key: 'wave', icon: 'wave', label: 'Wave', tone: 'accent' },
    { key: 'vault', icon: 'vault', label: 'Vault', tone: 'good' },
    { key: 'cores', icon: 'core', label: 'Cores', tone: 'core' },
  ];
  const stats = {};

  for (const def of STAT_DEFS) {
    const box = el('div', `stat tone-${def.tone}`);
    const head = el('div', 'stat-head');
    head.append(glyph(def.icon), el('span', 'k', def.label));
    const value = el('b', 'v', '0');
    const meter = el('i', 'meter');
    const fill = el('i', 'meter-fill');
    meter.append(fill);
    box.append(head, value, meter);
    dom.stats.append(box);
    stats[def.key] = { box, value, meter, fill };
  }
  setHidden(stats.credits.meter, true);
  setHidden(stats.wave.meter, true);
  setHidden(stats.cores.meter, true);

  function syncHud() {
    setText(stats.credits.value, formatNumber(state.credits));

    const boss = game.isBossWave(state.wave);
    setText(stats.wave.value, state.wave);
    stats.wave.box.classList.toggle('is-boss', boss);

    const hpRatio = Math.max(0, state.vaultHp / BALANCE.vault.maxHp);
    setText(stats.vault.value, Math.max(0, Math.ceil(state.vaultHp)));
    setStyle(stats.vault.fill, 'transform', `scaleX(${hpRatio.toFixed(3)})`);
    stats.vault.box.classList.toggle('is-hurt', hpRatio <= 0.35);

    setText(stats.cores.value, state.cores);
    setText(stats.coresMult, `×${game.prestigeMult().toFixed(2)}`);
  }

  // The cores tile carries its multiplier next to the count.
  stats.coresMult = el('span', 'suffix');
  stats.cores.value.after(stats.coresMult);

  // A boss wave gets a star next to the number rather than inside it, so the
  // digits stay in the same place from wave to wave.
  const bossStar = glyph('star', 'glyph boss-star');
  stats.wave.value.after(bossStar);

  // ------------------------------------------------------------- wave bar --
  function syncWaveBar() {
    const boss = game.isBossWave(state.wave);
    setText(dom.waveName, boss ? `Boss wave ${state.wave}` : `Wave ${state.wave}`);
    if (state.phase === 'prep') {
      setText(dom.waveNote, `next in ${state.phaseTimer.toFixed(1)}s`);
    } else {
      const left = state.queue.length + state.enemies.length;
      setText(dom.waveNote, `${left} left`);
    }
    setStyle(dom.waveFill, 'transform', `scaleX(${game.waveProgress().toFixed(3)})`);
    dom.waveFill.classList.toggle('is-prep', state.phase === 'prep');
    dom.waveFill.classList.toggle('is-boss', boss);

    if (rosterWave !== state.wave) {
      rosterWave = state.wave;
      dom.roster.replaceChildren();
      for (const entry of game.waveRoster(state.wave)) {
        const item = el('span', 'foe' + (entry.key === 'boss' ? ' is-boss' : ''));
        const label = `${entry.def.name} — ${formatNumber(entry.hp)} hp`;
        item.title = label;
        item.setAttribute('aria-label', label);
        item.append(tile(enemySpriteUrl(entry.key, 26), 'foe-art'));
        item.append(el('span', 'foe-hp', formatNumber(entry.hp)));
        dom.roster.append(item);
      }
    }
  }

  // ------------------------------------------------------------- controls --
  const pauseIcons = { pause: glyph('pause'), play: glyph('play') };
  const pauseLabel = dom.pause.querySelector('.label');
  const pauseSub = dom.pause.querySelector('.sub');
  const speedLabel = dom.speed.querySelector('.label');
  dom.pause.querySelector('.ico').append(pauseIcons.pause, pauseIcons.play);
  dom.speed.querySelector('.ico').append(glyph('speed'));

  function syncControls() {
    const paused = state.paused;
    setText(pauseLabel, paused ? 'Resume' : 'Pause');
    setText(pauseSub, paused ? 'the world is frozen' : 'stop the clock');
    setHidden(pauseIcons.pause, paused);
    setHidden(pauseIcons.play, !paused);
    dom.pause.classList.toggle('on', paused);
    dom.pause.setAttribute('aria-pressed', String(paused));
    setText(speedLabel, `${state.speed}×`);
    dom.speed.classList.toggle('on', state.speed > 1);
  }

  // ---------------------------------------------------------------- cards --
  function costTag(getCost, { hint } = {}) {
    const wrap = el('div', 'buy');
    const cost = el('span', 'cost');
    cost.append(glyph('credits'));
    const amount = el('b');
    cost.append(amount);
    wrap.append(cost);
    if (hint) wrap.append(el('span', 'micro', hint));
    bind(() => {
      const value = getCost();
      setText(amount, formatNumber(value));
      cost.classList.toggle('no', state.credits < value);
    });
    return wrap;
  }

  function statChips(specs) {
    const row = el('div', 'chips');
    for (const spec of specs) {
      const c = chip(spec.icon);
      c.node.title = spec.title;
      row.append(c.node);
      bind(() => setText(c.value, spec.read()));
    }
    return row;
  }

  function towerCard(key) {
    const def = BALANCE.towers[key];
    const card = el('button', 'row card tower');
    card.type = 'button';
    card.style.setProperty('--tint', def.color);
    card.setAttribute('aria-label', `${def.name}: ${def.blurb}`);

    const body = el('div', 'body');
    const head = el('div', 'headline');
    head.append(el('span', 'name', def.name));
    const owned = el('span', 'badge');
    head.append(owned);
    body.append(head, el('div', 'sub', def.blurb));
    body.append(statChips([
      { icon: 'damage', title: 'damage per second', read: () => {
        const s = game.towerStats({ type: key });
        return formatNumber(s.damage * s.fireRate);
      } },
      { icon: 'rate', title: 'shots per second', read: () => rate(game.towerStats({ type: key }).fireRate) },
      { icon: 'range', title: 'range', read: () => Math.round(game.towerStats({ type: key }).range) },
    ]));

    card.append(tile(towerSpriteUrl(key, 46)), body, costTag(() => game.towerCost(key), { hint: 'hold to drag' }));

    bind(() => {
      const count = state.towers.filter((t) => t.type === key).length;
      setText(owned, count ? `×${count}` : '');
      setHidden(owned, count === 0);
      card.classList.toggle('poor', state.credits < game.towerCost(key));
      card.classList.toggle('on', state.buildType === key);
      card.setAttribute('aria-pressed', String(state.buildType === key));
    });

    card.addEventListener('click', () => {
      audio.unlock();
      state.buildType = state.buildType === key ? null : key;
      state.selected = null;
      sync();
    });
    makeDraggable(card, key);
    return card;
  }

  // The block that appears when a tower on the map is selected. Built once and
  // repointed at whichever tower is selected, so selecting never rebuilds.
  function selectionCard() {
    const wrap = el('div', 'selection');
    const card = el('div', 'card selected');
    const art = tile(towerSpriteUrl('turret', 46));
    const body = el('div', 'body');
    const head = el('div', 'headline');
    const name = el('span', 'name');
    head.append(name, el('span', 'badge live', 'selected'));
    body.append(head, el('div', 'sub', 'the ring on the map shows its range'));

    const chips = el('div', 'chips');
    const dps = chip('damage');
    const kills = chip('kills');
    const range = chip('range');
    chips.append(dps.node, kills.node, range.node);
    body.append(chips);
    card.append(art, body);

    const sell = el('button', 'row sell danger');
    sell.type = 'button';
    sell.append(glyph('sell'), el('span', 'label', 'Sell tower'));
    const refund = el('span', 'refund');
    sell.append(refund);
    sell.addEventListener('click', () => {
      audio.unlock();
      if (state.selected == null) return;
      const res = game.sellTower(state.selected);
      if (res.ok) { audio.play('sell'); toast(`Sold for ${formatNumber(res.refund)} credits`); }
      sync();
    });

    wrap.append(card, sell);

    bind(() => {
      const tower = state.selected != null ? game.towerById(state.selected) : null;
      setHidden(wrap, !tower);
      if (!tower) return;
      const def = BALANCE.towers[tower.type];
      const stats = game.towerStats(tower);
      setStyle(card, '--tint', def.color);
      art.style.backgroundImage = `url(${towerSpriteUrl(tower.type, 46)})`;
      setText(name, def.name);
      setText(dps.value, formatNumber(stats.damage * stats.fireRate));
      setText(kills.value, formatNumber(tower.kills));
      setText(range.value, Math.round(stats.range));
      setText(refund, `+${formatNumber(Math.floor(tower.spent * BALANCE.economy.sellRefund))}`);
    });
    return wrap;
  }

  function upgradeCard(key) {
    const def = BALANCE.upgrades[key];
    const card = el('button', 'row card upgrade');
    card.type = 'button';
    const art = el('i', 'tile glyph-tile');
    art.append(glyph(key === 'damage' ? 'damage' : key === 'rate' ? 'rate' : 'range'));

    const body = el('div', 'body');
    const head = el('div', 'headline');
    head.append(el('span', 'name', def.name));
    const level = el('span', 'badge');
    head.append(level);
    body.append(head, el('div', 'sub', def.blurb));

    const chips = el('div', 'chips');
    const now = el('span', 'chip flat');
    const nowValue = el('b');
    now.append(el('span', 'k', 'now'), nowValue);
    const next = el('span', 'chip flat next');
    const nextValue = el('b');
    next.append(el('span', 'k', 'next'), nextValue);
    chips.append(now, next);
    body.append(chips);

    card.append(art, body, costTag(() => game.upgradeCost(key)));

    bind(() => {
      const lv = state.upgrades[key];
      const cost = game.upgradeCost(key);
      setText(level, `Lv ${lv}`);
      setText(nowValue, `×${game.upgradeMult(key).toFixed(2)}`);
      setText(nextValue, `×${(1 + (lv + 1) * def.effect).toFixed(2)}`);
      card.classList.toggle('poor', state.credits < cost);
      card.disabled = state.credits < cost;
    });

    card.addEventListener('click', () => {
      audio.unlock();
      if (game.buyUpgrade(key).ok) audio.play('upgrade');
      sync();
    });
    return card;
  }

  function statTile(icon, label, read) {
    const box = el('div', 'mini');
    const head = el('div', 'mini-head');
    head.append(glyph(icon), el('span', null, label));
    const value = el('b');
    box.append(head, value);
    bind(() => setText(value, read()));
    return box;
  }

  function toggleRow(icons, read, onClick, extra = '') {
    const btn = el('button', `row toggle ${extra}`.trim());
    btn.type = 'button';
    const marks = {};
    const ico = el('i', 'ico');
    for (const name of icons) {
      marks[name] = glyph(name);
      ico.append(marks[name]);
    }
    const label = el('span', 'label');
    btn.append(ico, label);
    bind(() => {
      const cur = read();
      for (const name of icons) setHidden(marks[name], name !== cur.icon);
      setText(label, cur.label);
      btn.classList.toggle('off', !!cur.off);
      btn.disabled = !!cur.disabled;
      btn.setAttribute('aria-pressed', String(!cur.off));
    });
    btn.addEventListener('click', () => { audio.unlock(); onClick(); sync(); });
    return btn;
  }

  // ---------------------------------------------------------------- panel --
  function buildTab() {
    const frag = document.createDocumentFragment();
    const hint = el('p', 'hint');
    frag.append(hint);
    bind(() => {
      const picked = state.selected != null ? game.towerById(state.selected) : null;
      setText(hint, picked
        ? `Tap another tower to inspect it, or the map to deselect.`
        : state.buildType
          ? `Now tap a free spot to place the ${BALANCE.towers[state.buildType].name}.`
          : 'Drag a tower onto the map, or tap it and then tap a spot.');
    });
    frag.append(selectionCard());
    for (const key of Object.keys(BALANCE.towers)) frag.append(towerCard(key));
    return frag;
  }

  function upgradeTab() {
    const frag = document.createDocumentFragment();
    frag.append(el('p', 'hint', 'Applies to every tower you own and every one you build later.'));
    for (const key of Object.keys(BALANCE.upgrades)) frag.append(upgradeCard(key));
    return frag;
  }

  function prestigeTab() {
    const frag = document.createDocumentFragment();
    const p = BALANCE.prestige;

    const hero = el('div', 'card hero');
    hero.append(tile(vaultSpriteUrl(46)));
    const body = el('div', 'body');
    const head = el('div', 'headline');
    const mult = el('span', 'name big');
    head.append(mult, el('span', 'badge live', 'damage & income'));
    const sub = el('div', 'sub');
    const track = el('i', 'meter wide');
    const fill = el('i', 'meter-fill core');
    track.append(fill);
    const scale = el('div', 'meter-row');
    const earned = el('span', 'micro');
    const target = el('span', 'micro');
    scale.append(earned, target);
    body.append(head, sub, track, scale);
    hero.append(body);
    frag.append(hero);

    bind(() => {
      const have = game.pendingCores();
      // Earnings needed for one more core, inverted from the cores formula.
      const need = p.divisor * Math.pow(have + 1, 1 / p.exponent);
      const from = have === 0 ? 0 : p.divisor * Math.pow(have, 1 / p.exponent);
      const span = Math.max(1, need - from);
      const done = Math.max(0, Math.min(1, (state.runEarned - from) / span));
      setText(mult, `×${game.prestigeMult().toFixed(2)}`);
      setText(sub, `${state.cores} core${state.cores === 1 ? '' : 's'} banked`);
      setStyle(fill, 'transform', `scaleX(${done.toFixed(3)})`);
      setText(earned, `${formatNumber(state.runEarned)} this run`);
      setText(target, `next core at ${formatNumber(need)}`);
    });

    const doPrestige = el('button', 'row card action');
    doPrestige.type = 'button';
    const icoWrap = el('i', 'tile glyph-tile core');
    icoWrap.append(glyph('core'));
    const pBody = el('div', 'body');
    const pHead = el('div', 'headline');
    const pName = el('span', 'name');
    pHead.append(pName);
    const pSub = el('div', 'sub');
    pBody.append(pHead, pSub);
    doPrestige.append(icoWrap, pBody);
    bind(() => {
      const pending = game.pendingCores();
      setText(pName, pending > 0 ? `Prestige for ${pending} core${pending === 1 ? '' : 's'}` : 'Prestige');
      setText(pSub, pending >= p.minCoresToPrestige
        ? 'Wipes towers, upgrades, credits and waves. Cores are permanent.'
        : `Earn ${formatNumber(p.divisor)} in one run to bank your first core.`);
      doPrestige.disabled = pending < p.minCoresToPrestige;
    });
    doPrestige.addEventListener('click', () => {
      audio.unlock();
      const pending = game.pendingCores();
      if (!confirm(`Prestige now for ${pending} core(s)? This wipes the current run.`)) return;
      const res = game.prestige();
      if (res.ok) { setTab('build'); toast(`Banked ${res.cores} core${res.cores === 1 ? '' : 's'}`); }
    });
    frag.append(doPrestige);

    const grid = el('div', 'grid');
    grid.append(
      statTile('wave', 'Best wave', () => state.bestWave),
      statTile('kills', 'Kills', () => formatNumber(state.kills)),
      statTile('core', 'Prestiges', () => state.prestiges),
      statTile('credits', 'Income', () => `${formatNumber(state.incomeRate)}/s`),
    );
    frag.append(grid);

    frag.append(el('p', 'hint', `Away for up to ${formatDuration(BALANCE.offline.capHours * 3600)}`
      + ` keeps earning at ${Math.round(BALANCE.offline.efficiency * 100)}% of your recent rate.`));

    const split = el('div', 'split');
    split.append(
      toggleRow(['sound', 'mute'], () => ({
        icon: state.muted ? 'mute' : 'sound',
        label: state.muted ? 'Muted' : 'Sound',
        off: state.muted,
      }), () => {
        state.muted = !state.muted;
        if (!state.muted) audio.play('upgrade');
        game.save();
      }),
      toggleRow(['music'], () => ({
        icon: 'music',
        label: state.musicOff ? 'No music' : 'Music',
        off: state.musicOff,
        disabled: state.muted,
      }), () => {
        state.musicOff = !state.musicOff;
        game.save();
      }),
      toggleRow(['trash'], () => ({ icon: 'trash', label: 'Wipe' }), () => {
        if (!confirm('Delete all progress? This cannot be undone.')) return;
        game.hardReset();
        setTab('build');
      }, 'danger'),
    );
    frag.append(split);
    return frag;
  }

  const TABS = { build: buildTab, upgrade: upgradeTab, prestige: prestigeTab };

  function rebuild() {
    updaters = [];
    dom.panel.replaceChildren(TABS[tab]());
    dom.panel.scrollTop = 0;
  }

  function setTab(next) {
    if (!TABS[next]) return;
    tab = next;
    for (const btn of dom.tabs.querySelectorAll('button[data-tab]')) {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    }
    dom.panel.setAttribute('aria-labelledby', `tab-${tab}`);
    rebuild();
    sync();
  }

  function sync() {
    syncHud();
    syncWaveBar();
    syncControls();
    for (const fn of updaters) fn();
  }

  return {
    setTab,
    rebuild,
    sync,
    get tab() { return tab; },
  };
}
