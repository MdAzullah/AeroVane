/** Play a short two-tone critical alert. Browsers may suppress it until a user gesture. */
export function playCriticalAlert(): void {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
  gain.connect(context.destination);

  for (const [frequency, delay] of [[880, 0], [660, 0.22]] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(context.currentTime + delay);
    oscillator.stop(context.currentTime + delay + 0.18);
  }
  window.setTimeout(() => { void context.close(); }, 700);
}
