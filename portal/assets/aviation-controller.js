(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const SVG_VARIANTS = ['.drone-bank', '.vtol-bank', '.hexa-bank', '.heli-bank', '.plane-bank', '.wing-bank'];
  const slots = [...document.querySelectorAll('.flight-object')];
  const state = new Map();
  const rand = (min, max) => min + Math.random() * (max - min);

  const cubic = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return u ** 3 * p0 + 3 * u ** 2 * t * p1 + 3 * u * t ** 2 * p2 + t ** 3 * p3;
  };
  const derivative = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return 3 * u ** 2 * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t ** 2 * (p3 - p2);
  };

  function createRoute(lane) {
    const band = lane === 0 ? [55, 155] : [265, 365];
    const rightToLeft = Math.random() < .5;
    const leftX = rand(670, 790);
    const rightX = rand(1680, 1790);
    const startX = rightToLeft ? rightX : leftX;
    const endX = rightToLeft ? leftX : rightX;
    const span = endX - startX;
    return {
      p0: { x: startX, y: rand(...band) },
      p1: { x: startX + span * rand(.24, .36), y: rand(...band) },
      p2: { x: startX + span * rand(.62, .78), y: rand(...band) },
      p3: { x: endX, y: rand(...band) },
    };
  }

  function pickVariant(slot) {
    const active = new Set([...state.values()].filter(item => item.flying).map(item => item.variant));
    const previous = state.get(slot)?.variant;
    let choices = SVG_VARIANTS.filter(selector => !active.has(selector) && selector !== previous);
    if (!choices.length) choices = SVG_VARIANTS.filter(selector => !active.has(selector));
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function mountVariant(slot, selector) {
    SVG_VARIANTS.forEach(candidate => {
      slot.querySelectorAll(candidate).forEach(node => {
        node.setAttribute('hidden', '');
        node.style.display = 'none';
      });
    });
    const node = document.querySelector(selector);
    if (!node) return false;
    node.removeAttribute('hidden');
    node.style.display = '';
    slot.appendChild(node);
    return true;
  }

  function availableLane(slot) {
    const occupied = new Set([...state.entries()]
      .filter(([other, item]) => other !== slot && item.flying)
      .map(([, item]) => item.lane));
    const choices = [0, 1].filter(lane => !occupied.has(lane));
    return choices.length ? choices[Math.floor(Math.random() * choices.length)] : Math.floor(Math.random() * 2);
  }

  function launch(slot, now) {
    const variant = pickVariant(slot);
    if (!mountVariant(slot, variant)) return;
    const lane = availableLane(slot);
    state.set(slot, {
      flying: true,
      variant,
      lane,
      route: createRoute(lane),
      startedAt: now,
      duration: rand(13500, 20500),
      waitingUntil: 0,
    });
  }

  function update(slot, now) {
    let item = state.get(slot);
    if (!item || !item.flying) {
      if (!item || now >= item.waitingUntil) launch(slot, now);
      else slot.style.opacity = '0';
      return;
    }

    const raw = Math.min(1, (now - item.startedAt) / item.duration);
    const t = raw * raw * (3 - 2 * raw);
    const { p0, p1, p2, p3 } = item.route;
    const x = cubic(p0.x, p1.x, p2.x, p3.x, t);
    const y = cubic(p0.y, p1.y, p2.y, p3.y, t);
    const dx = derivative(p0.x, p1.x, p2.x, p3.x, t);
    const dy = derivative(p0.y, p1.y, p2.y, p3.y, t);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const fade = Math.max(0, Math.min(1, raw / .08, (1 - raw) / .1));

    slot.style.opacity = String(fade * (item.lane === 0 ? .72 : .58));
    slot.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)})`);

    if (raw >= 1) {
      slot.style.opacity = '0';
      item.flying = false;
      item.waitingUntil = now + rand(1200, 4200);
    }
  }

  const now = performance.now();
  slots.forEach((slot, index) => state.set(slot, {
    flying: false,
    variant: null,
    lane: index % 2,
    waitingUntil: now + (index === 0 ? rand(200, 900) : rand(2600, 4800)),
  }));

  const frame = time => {
    slots.forEach(slot => update(slot, time));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
