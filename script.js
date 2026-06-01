const rpmRange = document.getElementById('rpmRange');
const rpmValue = document.getElementById('rpmValue');
const rpmStatus = document.getElementById('rpmStatus');
const rpmChip = document.getElementById('rpmChip');
const rpmChipValue = document.getElementById('rpmChipValue');
const rpmDown = document.getElementById('rpmDown');
const rpmUp = document.getElementById('rpmUp');
const hpValue = document.getElementById('hpValue');
const torqueValue = document.getElementById('torqueValue');
const powerCurvePathHp = document.getElementById('powerCurvePathHp');
const powerCurvePathTorque = document.getElementById('powerCurvePathTorque');
const powerCurveHandleHp = document.getElementById('powerCurveHandleHp');
const powerCurveHandleTorque = document.getElementById('powerCurveHandleTorque');
const gearButtons = document.querySelectorAll('.gate-slot');
const gearRatioDisplay = document.getElementById('gearRatio');
const speedValue = document.getElementById('speedValue');
const speedKmh = document.getElementById('speedKmh');
const needle = document.getElementById('needle');
const tachNeedle = document.getElementById('tachNeedle');
const tachGauge = document.querySelector('.gauge.tach');
const soundToggle = document.getElementById('soundToggle');

const gearRatios = {
  1: 3.91,
  2: 2.29,
  3: 1.55,
  4: 1.30,
  5: 1.08,
  6: 0.88,
};

let curveData = [];
const curveWidth = 300;
const curveHeight = 100;
const curveLeft = 10;
const curveTop = 20;
const maxHorsepower = 480;
const maxTorque = 410;

const finalDriveRatio = 3.44;
const wheelDiameterMeters = 0.66;
const wheelCircumferenceMeters = Math.PI * wheelDiameterMeters;
const maxRpm = 7500;
const minRpm = 800;
const rpmStep = 100;
const maxSpeedMph = 160;
const redlineRpm = 6800;

/* ---------------- Gauge tick generation ---------------- */
// Sweep runs from -90deg (left) to +90deg (right) over the top, matching the needle.
function fractionToAngle(fraction) {
  return -90 + Math.min(Math.max(fraction, 0), 1) * 180;
}

function buildTicks(container, { max, minorStep, labelStep, redlineFrom, labelDivisor = 1 }) {
  if (!container) return;
  container.innerHTML = '';
  for (let value = 0; value <= max + 0.0001; value += minorStep) {
    const fraction = value / max;
    const angle = fractionToAngle(fraction);
    const isMajor = Math.abs(value % labelStep) < 0.0001 || Math.abs((value % labelStep) - labelStep) < 0.0001;
    const isRedline = redlineFrom != null && value >= redlineFrom - 0.0001;

    const tick = document.createElement('div');
    tick.className = 'tick';
    if (isMajor) tick.classList.add('major');
    if (isRedline) tick.classList.add('redline');
    tick.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    container.appendChild(tick);

    if (isMajor) {
      const rad = (angle * Math.PI) / 180;
      const r = 36; // percent radius for the number
      const x = 50 + r * Math.sin(rad);
      const y = 50 - r * Math.cos(rad);
      const num = document.createElement('span');
      num.className = 'tick-num';
      if (isRedline) num.classList.add('redline');
      num.style.left = `${x}%`;
      num.style.top = `${y}%`;
      num.textContent = String(Math.round(value / labelDivisor));
      container.appendChild(num);
    }
  }
}

function buildGaugeTicks() {
  buildTicks(document.querySelector('[data-ticks="speedo"]'), {
    max: 160,
    minorStep: 20,
    labelStep: 40,
  });
  buildTicks(document.querySelector('[data-ticks="tach"]'), {
    max: 8000,
    minorStep: 500,
    labelStep: 1000,
    redlineFrom: 7000,
    labelDivisor: 1000,
  });
}

/* ---------------- Power curve data ---------------- */
function getSelectedGear() {
  const selected = document.querySelector('.gate-slot.selected');
  return selected ? selected.dataset.gear : '1';
}

function parseCurveCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    const [rpm, hp, torque_ftlb] = line.split(',').map(Number);
    return { rpm, hp, torque: torque_ftlb };
  }).sort((a, b) => a.rpm - b.rpm);
}

function interpolateValue(rpm, key) {
  if (!curveData.length) return 0;
  const points = curveData;
  if (rpm <= points[0].rpm) {
    return interpolate(points[0], points[1], rpm, key);
  }
  if (rpm >= points[points.length - 1].rpm) {
    const end = points.length - 1;
    return interpolate(points[end - 1], points[end], rpm, key);
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (rpm >= a.rpm && rpm <= b.rpm) {
      return interpolate(a, b, rpm, key);
    }
  }
  return points[points.length - 1][key];
}

function interpolate(a, b, rpm, key) {
  const t = (rpm - a.rpm) / (b.rpm - a.rpm);
  return a[key] + t * (b[key] - a[key]);
}

function torqueAtRpm(rpm) {
  const clamped = Math.min(maxRpm, Math.max(minRpm, rpm));
  return interpolateValue(clamped, 'torque');
}

function horsepowerAtRpm(rpm) {
  const clamped = Math.min(maxRpm, Math.max(minRpm, rpm));
  return interpolateValue(clamped, 'hp');
}

function buildPowerCurve() {
  if (!curveData.length) return;
  const hpPath = curveData.map((point, index) => {
    const x = curveLeft + ((point.rpm - minRpm) / (maxRpm - minRpm)) * curveWidth;
    const y = curveTop + curveHeight - (point.hp / maxHorsepower) * curveHeight;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  const torquePath = curveData.map((point, index) => {
    const x = curveLeft + ((point.rpm - minRpm) / (maxRpm - minRpm)) * curveWidth;
    const y = curveTop + curveHeight - (point.torque / maxTorque) * curveHeight;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  powerCurvePathHp.setAttribute('d', hpPath);
  powerCurvePathTorque.setAttribute('d', torquePath);
}

function updatePowerCurveHandle(rpm) {
  if (!curveData.length) return;
  const normalized = (rpm - minRpm) / (maxRpm - minRpm);
  const x = curveLeft + normalized * curveWidth;
  const yHp = curveTop + curveHeight - (horsepowerAtRpm(rpm) / maxHorsepower) * curveHeight;
  const yTorque = curveTop + curveHeight - (torqueAtRpm(rpm) / maxTorque) * curveHeight;
  powerCurveHandleHp.setAttribute('cx', x);
  powerCurveHandleHp.setAttribute('cy', yHp);
  powerCurveHandleTorque.setAttribute('cx', x);
  powerCurveHandleTorque.setAttribute('cy', yTorque);
}

async function loadCurveData() {
  try {
    const response = await fetch('./assets/data/porsche_911_power_torque_curve.csv');
    const raw = await response.text();
    curveData = parseCurveCsv(raw);
    buildPowerCurve();
  } catch (error) {
    console.error('Unable to load power curve CSV:', error);
  }
}

/* ---------------- RPM control ---------------- */
function setRpm(value) {
  const clamped = Math.min(maxRpm, Math.max(minRpm, value));
  rpmRange.value = clamped;
  updateDashboard();
}

function adjustRpm(delta) {
  setRpm(Number(rpmRange.value) + delta);
}

/* ---------------- Speed math ---------------- */
function calculateSpeed(rpm, gear) {
  const gearRatio = gearRatios[gear];
  const wheelRpm = rpm / (gearRatio * finalDriveRatio);
  const speedMps = (wheelRpm / 60) * wheelCircumferenceMeters;
  const speedKmhValue = speedMps * 3.6;
  const speedMphValue = speedKmhValue / 1.60934;
  return {
    speedMph: speedMphValue,
    speedKmh: speedKmhValue,
    gearRatio,
  };
}

function rpmForSpeed(speedMph, gear) {
  const gearRatio = gearRatios[gear];
  const speedMps = speedMph * 1.60934 / 3.6;
  const wheelRpm = (speedMps / wheelCircumferenceMeters) * 60;
  return speedMps > 0 ? wheelRpm * gearRatio * finalDriveRatio : minRpm;
}

function rpmLabel(rpm) {
  if (rpm >= redlineRpm) return 'redline';
  if (rpm >= 5200) return 'power band';
  if (rpm <= 1100) return 'idle';
  return 'cruising';
}

/* ---------------- Dashboard ---------------- */
function updateDashboard() {
  const rpm = Number(rpmRange.value);
  const gear = getSelectedGear();
  const { speedMph, speedKmh, gearRatio } = calculateSpeed(rpm, gear);
  const torque = torqueAtRpm(rpm);
  const hp = horsepowerAtRpm(rpm);

  // Tachometer readout shows RPM in thousands with one decimal.
  rpmValue.textContent = (rpm / 1000).toFixed(1);
  rpmStatus.textContent = rpmLabel(rpm);
  rpmChipValue.textContent = rpm.toLocaleString();
  gearRatioDisplay.textContent = gearRatio.toFixed(2);
  speedValue.textContent = Math.round(speedMph);
  speedKmh.textContent = Math.round(speedKmh);
  torqueValue.textContent = Math.round(torque);
  hpValue.textContent = Math.round(hp);
  updatePowerCurveHandle(rpm);

  // Slider fill
  const fillPct = ((rpm - minRpm) / (maxRpm - minRpm)) * 100;
  rpmRange.style.setProperty('--fill', `${fillPct}%`);

  // Speedometer needle (0 .. maxSpeedMph -> -90 .. +90)
  const speedFraction = Math.min(Math.max(speedMph / maxSpeedMph, 0), 1);
  needle.style.transform = `translateX(-50%) rotate(${fractionToAngle(speedFraction)}deg)`;

  // Tachometer needle (0 .. 8000 RPM -> -90 .. +90)
  const tachFraction = Math.min(Math.max(rpm / 8000, 0), 1);
  tachNeedle.style.transform = `translateX(-50%) rotate(${fractionToAngle(tachFraction)}deg)`;

  // Redline warning state
  const atRedline = rpm >= redlineRpm;
  tachGauge.classList.toggle('redline-active', atRedline);
  rpmChip.classList.toggle('redline', atRedline);

  // Engine sound tracks RPM
  if (typeof EngineAudio !== 'undefined') {
    EngineAudio.setRpm(rpm);
  }
}

/* ---------------- Events ---------------- */
rpmRange.addEventListener('input', updateDashboard);
rpmUp.addEventListener('click', () => adjustRpm(rpmStep));
rpmDown.addEventListener('click', () => adjustRpm(-rpmStep));

if (soundToggle) {
  soundToggle.addEventListener('click', () => {
    const on = EngineAudio.toggle();
    EngineAudio.setRpm(Number(rpmRange.value));
    soundToggle.classList.toggle('active', on);
    soundToggle.setAttribute('aria-pressed', String(on));
    soundToggle.querySelector('.sound-label').textContent = on ? 'Sound on' : 'Sound off';
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    adjustRpm(rpmStep);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    adjustRpm(-rpmStep);
  }
});

gearButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const currentGear = getSelectedGear();
    const currentSpeed = calculateSpeed(Number(rpmRange.value), currentGear).speedMph;
    gearButtons.forEach((btn) => btn.classList.remove('selected'));
    button.classList.add('selected');
    const newGear = button.dataset.gear;
    const newRpm = Math.round(rpmForSpeed(currentSpeed, newGear));
    setRpm(newRpm);
    updateDashboard();
  });
});

buildGaugeTicks();
loadCurveData().then(() => updateDashboard());
updateDashboard();
