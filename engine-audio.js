/* =========================================================
   Porsche flat-six turbo engine sound (Web Audio API)
   ---------------------------------------------------------
   No audio files. The engine note is generated live and tracks RPM.

   Realistic engines are NOT a steady tone — they are a rapid train of
   combustion PULSES. A 4-stroke flat-six fires 3 times per crank
   revolution, so the firing rate is (RPM / 60) * 3 (40 Hz at idle,
   ~375 Hz near redline). We build the engine by amplitude-modulating
   a harmonic + noise "body" with a sharp pulse at that firing rate,
   which produces the boxer "blare/buzz" instead of a sci-fi drone.
   On top we layer a turbo spool whistle and an intake whoosh that
   rise with load, plus a low sub rumble.
   ========================================================= */

const EngineAudio = (() => {
  let ctx = null;
  let started = false;
  let enabled = false;

  // Graph nodes
  let masterGain = null;     // overall output
  let amGain = null;         // gain that gets pulse-modulated (the firing)
  let bodyFilter = null;     // lowpass that opens with RPM
  let engineGain = null;     // engine tone level into master

  let toneOscs = [];         // pitched harmonics feeding the AM stage
  let noiseSrc = null;       // looping noise -> bandpass (combustion grit)
  let noiseBand = null;
  let noiseGain = null;

  let modOsc = null;         // pulse modulator at firing frequency
  let modShaper = null;      // shapes saw -> sharp pulse
  let modDepth = null;       // pulse depth into amGain.gain

  let subOsc = null;         // low rumble
  let subGain = null;

  let turboOsc = null;       // spool whistle
  let turboGain = null;
  let turboFilter = null;
  let whooshGain = null;     // filtered noise intake whoosh
  let whooshFilter = null;

  let currentRpm = 800;
  let rafId = null;

  const IDLE_RPM = 800;
  const MAX_RPM = 7500;

  // Drop the tonal pitch a full octave for a deeper, throatier note.
  const PITCH_SCALE = 0.5;

  // Pitched harmonics of the firing frequency. Weighted toward the low
  // end (strong fundamental + sub-octave) for a throaty, bassy growl
  // instead of a buzzy high-pitched tone.
  const HARMONICS = [
    { mult: 0.5, type: 'sawtooth', gain: 0.55, detune: 0 },
    { mult: 1, type: 'sawtooth', gain: 0.5, detune: 2 },
    { mult: 2, type: 'sawtooth', gain: 0.16, detune: -2 },
    { mult: 3, type: 'square', gain: 0.05, detune: 0 },
  ];

  function firingFrequency(rpm) {
    return (rpm / 60) * 3 * PITCH_SCALE; // flat-six fires 3x per revolution, octave down
  }

  function norm(rpm) {
    return Math.min(Math.max((rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0), 1);
  }

  // Turns a -1..1 sawtooth into a sharp one-sided pulse (the firing spike).
  function makePulseCurve() {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1; // -1..1
      const pos = Math.max(0, x);       // keep only positive half
      curve[i] = Math.pow(pos, 3);      // exponent => spike sharpness
    }
    return curve;
  }

  function makeNoiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      // slightly low-passed (brown-ish) noise reads as mechanical, not hiss
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      data[i] = last * 3.2;
    }
    return buf;
  }

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.0;
    masterGain.connect(ctx.destination);

    // ---- Engine body: harmonics + noise -> AM gain -> body filter ----
    bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = 380;
    bodyFilter.Q.value = 4;

    engineGain = ctx.createGain();
    engineGain.gain.value = 0.9;

    amGain = ctx.createGain();
    amGain.gain.value = 0.18; // baseline; pulse modulation rides on top

    amGain.connect(bodyFilter);
    bodyFilter.connect(engineGain);
    engineGain.connect(masterGain);

    const baseFreq = firingFrequency(currentRpm);

    toneOscs = HARMONICS.map((h) => {
      const osc = ctx.createOscillator();
      osc.type = h.type;
      osc.frequency.value = baseFreq * h.mult;
      osc.detune.value = h.detune;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      osc.connect(g);
      g.connect(amGain);
      osc.start();
      return { osc, config: h };
    });

    // Combustion grit: looping noise through a bandpass into the AM stage
    const noiseBuf = makeNoiseBuffer();
    noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 180;
    noiseBand.Q.value = 0.8;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.45;
    noiseSrc.connect(noiseBand);
    noiseBand.connect(noiseGain);
    noiseGain.connect(amGain);
    noiseSrc.start();

    // ---- Pulse modulator (the firing) drives amGain.gain ----
    modOsc = ctx.createOscillator();
    modOsc.type = 'sawtooth';
    modOsc.frequency.value = baseFreq;
    modShaper = ctx.createWaveShaper();
    modShaper.curve = makePulseCurve();
    modDepth = ctx.createGain();
    modDepth.gain.value = 0.85; // how punchy each firing pulse is
    modOsc.connect(modShaper);
    modShaper.connect(modDepth);
    modDepth.connect(amGain.gain);
    modOsc.start();

    // ---- Sub rumble for body ----
    subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = baseFreq;
    subGain = ctx.createGain();
    subGain.gain.value = 0.38;
    subOsc.connect(subGain);
    subGain.connect(masterGain);
    subOsc.start();

    // ---- Turbo spool whistle ----
    turboFilter = ctx.createBiquadFilter();
    turboFilter.type = 'bandpass';
    turboFilter.frequency.value = 3000;
    turboFilter.Q.value = 8;
    turboGain = ctx.createGain();
    turboGain.gain.value = 0.0;
    turboOsc = ctx.createOscillator();
    turboOsc.type = 'triangle';
    turboOsc.frequency.value = 2000;
    turboOsc.connect(turboFilter);
    turboFilter.connect(turboGain);
    turboGain.connect(masterGain);
    turboOsc.start();

    // ---- Intake/turbo whoosh (filtered noise) ----
    whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = 'highpass';
    whooshFilter.frequency.value = 2500;
    whooshGain = ctx.createGain();
    whooshGain.gain.value = 0.0;
    const whooshSrc = ctx.createBufferSource();
    whooshSrc.buffer = noiseBuf;
    whooshSrc.loop = true;
    whooshSrc.connect(whooshFilter);
    whooshFilter.connect(whooshGain);
    whooshGain.connect(masterGain);
    whooshSrc.start();

    started = true;
  }

  function applyRpm(rpm, smoothing = 0.06) {
    if (!started || !ctx) return;
    const now = ctx.currentTime;
    const freq = firingFrequency(rpm);
    const n = norm(rpm);

    // Pitched parts track the firing frequency.
    toneOscs.forEach(({ osc, config }) => {
      osc.frequency.setTargetAtTime(freq * config.mult, now, smoothing);
    });
    if (subOsc) subOsc.frequency.setTargetAtTime(freq, now, smoothing);
    if (modOsc) modOsc.frequency.setTargetAtTime(freq, now, smoothing);

    // Body brightens and noise opens up as revs climb, but stays darker
    // overall to keep the deep, throaty character.
    if (bodyFilter) bodyFilter.frequency.setTargetAtTime(300 + n * 2400, now, smoothing);
    if (noiseBand) noiseBand.frequency.setTargetAtTime(150 + n * 900, now, smoothing);

    // Turbo spools in with load: pitch + volume rise sharply past mid-range.
    // Kept lower and quieter so it doesn't thin out the throaty low end.
    const spool = Math.pow(n, 2);
    if (turboOsc) turboOsc.frequency.setTargetAtTime(1100 + n * 4200, now, smoothing);
    if (turboFilter) turboFilter.frequency.setTargetAtTime(1800 + n * 3500, now, smoothing);
    if (turboGain) turboGain.gain.setTargetAtTime(0.008 + spool * 0.03, now, 0.12);
    if (whooshGain) whooshGain.gain.setTargetAtTime(spool * 0.035, now, 0.12);

    // Overall level rises modestly with revs.
    const volume = 0.14 + n * 0.16;
    if (masterGain && enabled) masterGain.gain.setTargetAtTime(volume, now, smoothing);
  }

  // Idle lope: tiny modulation so a steady low RPM still feels alive.
  function animate() {
    if (!enabled) return;
    const t = ctx ? ctx.currentTime : 0;
    if (modDepth && currentRpm < 1600) {
      const lope = 0.85 + Math.sin(t * 7) * 0.12;
      modDepth.gain.setTargetAtTime(lope, ctx.currentTime, 0.05);
    } else if (modDepth) {
      modDepth.gain.setTargetAtTime(0.85, ctx.currentTime, 0.08);
    }
    rafId = requestAnimationFrame(animate);
  }

  async function enable() {
    if (!started) build();
    if (ctx.state === 'suspended') await ctx.resume();
    enabled = true;
    applyRpm(currentRpm, 0.2);
    if (masterGain) {
      const volume = 0.14 + norm(currentRpm) * 0.16;
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.15);
    }
    cancelAnimationFrame(rafId);
    animate();
  }

  function disable() {
    enabled = false;
    cancelAnimationFrame(rafId);
    if (masterGain && ctx) {
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.12);
    }
  }

  return {
    setRpm(rpm) {
      currentRpm = rpm;
      applyRpm(rpm);
    },
    toggle() {
      if (enabled) disable();
      else enable();
      return enabled;
    },
    isEnabled() {
      return enabled;
    },
  };
})();
