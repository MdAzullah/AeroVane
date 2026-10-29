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
    // The two routes occupy distinct air corridors: a closer, slower pass and
    // a quieter distant pass. Curved control points keep the movement from
    // reading like a screen-saver moving on a straight line.
    const band = lane === 0 ? [75, 210] : [335, 510];
    const rightToLeft = Math.random() < .5;
    const leftX = -170;
    const rightX = 1770;
    const startX = rightToLeft ? rightX : leftX;
    const endX = rightToLeft ? leftX : rightX;
    const span = endX - startX;
    const startY = rand(...band);
    const endY = rand(...band);
    const drift = rand(-58, 58);
    return {
      p0: { x: startX, y: startY },
      p1: { x: startX + span * rand(.26, .34), y: startY + drift },
      p2: { x: startX + span * rand(.66, .74), y: endY - drift },
      p3: { x: endX, y: endY },
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
      duration: rand(16500, 24500),
      scale: lane === 0 ? rand(.88, 1.06) : rand(.52, .7),
      bobPhase: rand(0, Math.PI * 2),
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
    // Linear route progress gives aircraft a believable cruise speed; the
    // Bézier curve provides the gentle steering changes.
    const t = raw;
    const { p0, p1, p2, p3 } = item.route;
    const x = cubic(p0.x, p1.x, p2.x, p3.x, t);
    const y = cubic(p0.y, p1.y, p2.y, p3.y, t) + Math.sin(raw * Math.PI * 4 + item.bobPhase) * (item.lane === 0 ? 1.6 : .7);
    const dx = derivative(p0.x, p1.x, p2.x, p3.x, t);
    const dy = derivative(p0.y, p1.y, p2.y, p3.y, t);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const fade = Math.max(0, Math.min(1, raw / .075, (1 - raw) / .11));
    const visibility = fade * (item.lane === 0 ? .74 : .46);

    slot.style.opacity = String(visibility);
    slot.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${item.scale.toFixed(3)})`);

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
