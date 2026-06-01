/* =========================================================
   Porsche flat-six engine sound synthesizer (Web Audio API)
   ---------------------------------------------------------
   No audio files required — the engine note is generated live
   and its pitch/timbre track the current RPM.

   A 4-stroke flat-six fires 3 times per crank revolution, so the
   fundamental "firing" frequency is (RPM / 60) * 3. We stack a few
   detuned sawtooth oscillators on that fundamental, push them through
   a waveshaper for the raspy boxer rasp, and open a lowpass filter as
   revs climb so the engine "wakes up" toward redline.
   ========================================================= */

const EngineAudio = (() => {
  let ctx = null;
  let started = false;
  let enabled = false;

  // Oscillator bank + processing nodes
  let oscillators = [];
  let oscGain = null;     // master gain for the oscillator bank
  let toneFilter = null;  // lowpass that opens with RPM
  let shaper = null;      // waveshaper for harmonic grit
  let masterGain = null;  // overall output volume
  let subOsc = null;      // low rumble
  let subGain = null;

  let currentRpm = 800;
  let rafId = null;

  // Relative pitch multiples for the oscillator bank (firing-order harmonics).
  const HARMONICS = [
    { mult: 1, type: 'sawtooth', gain: 0.55, detune: 0 },
    { mult: 1, type: 'sawtooth', gain: 0.45, detune: 8 },
    { mult: 2, type: 'sawtooth', gain: 0.3, detune: -6 },
    { mult: 0.5, type: 'square', gain: 0.25, detune: 0 },
    { mult: 3, type: 'triangle', gain: 0.12, detune: 4 },
  ];

  function makeDistortionCurve(amount) {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = amount;
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function firingFrequency(rpm) {
    // Flat-six fires 3x per revolution.
    return (rpm / 60) * 3;
  }

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.0;
    masterGain.connect(ctx.destination);

    // Oscillator bank -> shaper -> lowpass -> oscGain -> master
    shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(6);
    shaper.oversample = '4x';

    toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 700;
    toneFilter.Q.value = 6;

    oscGain = ctx.createGain();
    oscGain.gain.value = 0.5;

    shaper.connect(toneFilter);
    toneFilter.connect(oscGain);
    oscGain.connect(masterGain);

    const baseFreq = firingFrequency(currentRpm);
    oscillators = HARMONICS.map((h) => {
      const osc = ctx.createOscillator();
      osc.type = h.type;
      osc.frequency.value = baseFreq * h.mult;
      osc.detune.value = h.detune;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      osc.connect(g);
      g.connect(shaper);
      osc.start();
      return { osc, gain: g, config: h };
    });

    // Low-frequency rumble for body
    subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = baseFreq;
    subGain = ctx.createGain();
    subGain.gain.value = 0.25;
    subOsc.connect(subGain);
    subGain.connect(masterGain);
    subOsc.start();

    started = true;
  }

  function rpmToParams(rpm) {
    const freq = firingFrequency(rpm);
    const norm = Math.min(Math.max((rpm - 800) / (7500 - 800), 0), 1);
    // Filter opens up as revs climb -> brighter, angrier note.
    const cutoff = 500 + norm * 4200;
    // Slightly louder at higher revs.
    const volume = 0.12 + norm * 0.16;
    return { freq, cutoff, volume };
  }

  function applyRpm(rpm, smoothing = 0.08) {
    if (!started || !ctx) return;
    const now = ctx.currentTime;
    const { freq, cutoff, volume } = rpmToParams(rpm);

    oscillators.forEach(({ osc, config }) => {
      osc.frequency.setTargetAtTime(freq * config.mult, now, smoothing);
    });
    if (subOsc) subOsc.frequency.setTargetAtTime(freq, now, smoothing);
    if (toneFilter) toneFilter.frequency.setTargetAtTime(cutoff, now, smoothing);
    if (masterGain && enabled) masterGain.gain.setTargetAtTime(volume, now, smoothing);
  }

  // Tiny continuous wobble so a steady RPM still sounds alive (idle lope).
  function animate() {
    if (!enabled) return;
    const t = ctx ? ctx.currentTime : 0;
    const lope = Math.sin(t * (currentRpm < 1500 ? 6 : 12)) * (currentRpm < 1500 ? 4 : 2);
    if (toneFilter) {
      const { cutoff } = rpmToParams(currentRpm);
      toneFilter.frequency.setTargetAtTime(cutoff + lope * 20, ctx.currentTime, 0.05);
    }
    rafId = requestAnimationFrame(animate);
  }

  async function enable() {
    if (!started) build();
    if (ctx.state === 'suspended') await ctx.resume();
    enabled = true;
    applyRpm(currentRpm, 0.2);
    if (masterGain) {
      const { volume } = rpmToParams(currentRpm);
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
      if (enabled) {
        disable();
      } else {
        enable();
      }
      return enabled;
    },
    isEnabled() {
      return enabled;
    },
  };
})();
