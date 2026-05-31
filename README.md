# Manual Transmission Speed Simulator

A simple static web app that simulates vehicle speed based on engine RPM and a 6-speed manual gear selection.

## How it works
- Drag the RPM slider to simulate revving the engine up to 7500 RPM.
- Choose a gear (1st through 6th) to apply the corresponding gear ratio.
- The app calculates speed based on the gear ratio, final drive, and wheel size.

## Files
- `index.html` — page structure
- `styles.css` — layout and styling
- `script.js` — RPM/gear calculations and speedometer animation

## Run locally
Open `index.html` in your browser.

## Controls
- Drag the RPM slider
- Use the right arrow key to accelerate
- Use the left arrow key to decelerate
- Click a gear button to change gears; RPM will be recalculated so speed stays the same
- Horsepower and torque are shown using the real CSV file at `assets/data/porsche_911_power_torque_curve.csv`
- If the chart does not load when opening `index.html` directly in the browser, serve the folder with a local web server

## Notes
- Gear ratios are modeled as:
  - 1st: 3.91
  - 2nd: 2.29
  - 3rd: 1.55
  - 4th: 1.30
  - 5th: 1.08
  - 6th: 0.88
- Final drive ratio is `3.44`.
- Wheel diameter is modeled as `26 in`.
