/* Flightradar concepts: four ways to show a plane flying over a 72×16 display.
 * Departure board, scrolling ticker, route journey, and cockpit HUD.
 *
 * Each design: { name, note, draw(t, u) -> element list }. Elements use device
 * API shapes. Helpers: u.measure, u.adv, u.lerp(c1,c2,k), u.pulse(t, period).
 */

const FLT = { cs: "KLM1234", type: "B738", from: "AMS", to: "LHR", alt: "FL350", spd: "450kt", fromCity: "Amsterdam", toCity: "London" };

const T = (txt, o) => Object.assign({ type: "text", text: txt, x: 0, y: 0, font: "normal", color: "0xFFFFFFFF" }, o);
const solid = (x, y, w, h, color) => Object.assign({ type: "rectangle", x, y, width: w, height: h, border_width: 0, fill: "solid", fill_colors: [color] });
const a8 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0").toUpperCase();
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

window.DESIGNS = [
  {
    name: "Split-flap",
    note: "Data-dense amber departure board with character reveal flap-in and swapping altitude/speed.",
    draw(t, u) {
      const els = [];
      const bright = "0xF0F0DCFF", dim = "0x6C6C63FF";

      // Line 1: callsign flaps in left→right at the start of each 8s cycle, then holds
      const cyc = 8.0, tc = t % cyc;
      let cx = 0;
      for (let i = 0; i < FLT.cs.length; i++) {
        const revealTime = 0.15 + i * 0.08;
        const ch = tc < revealTime
          ? "ABCDEFGH0123456789"[(i * 7 + Math.floor(t * 30)) % 18]
          : FLT.cs[i];
        els.push(T(ch, { x: cx, y: 0, font: "small", color: bright, align: "top_left" }));
        cx += u.adv(FLT.cs[i], "small");
      }
      // Line 1 right: aircraft type
      els.push(T(FLT.type, { x: 72, y: 0, font: "small", color: dim, align: "top_right" }));

      // Separator
      els.push(solid(0, 7, 72, 1, "0x262623FF"));

      // Line 2: route left
      els.push(T(FLT.from + ">" + FLT.to, { x: 0, y: 9, font: "small", color: bright, align: "top_left" }));

      // Flap cell right: alternates alt ↔ spd every 3s, with a brief blank on the flip
      const fp = (t % 6) / 6;
      let flapText = "";
      if (fp < 0.47) flapText = FLT.alt;
      else if (fp < 0.5) flapText = "";
      else if (fp < 0.97) flapText = FLT.spd;
      if (flapText) {
        els.push(T(flapText, { x: 72, y: 9, font: "small", color: bright, align: "top_right" }));
      }

      return els;
    },
  },
  {
    name: "Ticker",
    note: "One line, airport-ticker style: the whole flight scrolls across the display and loops seamlessly.",
    draw(t, u) {
      const els = [];
      const font = "normal";
      const sep = "     ";
      const msg = FLT.cs + sep + FLT.from + ">" + FLT.to + sep + FLT.alt + sep + FLT.spd + sep + FLT.type + sep;
      const W = u.measure(msg, font);
      const speed = 24;                       // px per second
      const off = (t * speed) % W;
      // Two copies spaced W apart -> seamless wrap
      for (let k = 0; k < 2; k++) {
        els.push(T(msg, { x: Math.round(-off + k * W), y: 8, font, color: "0xF0F0DCFF", align: "mid_left" }));
      }
      return els;
    },
  },
  {
    name: "Journey",
    note: "The plane travels a route line from origin to destination, arcing up to cruise then back down.",
    draw(t, u) {
      const els = [];
      const sky = "0x50C8FFFF", dimSky = "0x1E4A66FF", white = "0xF0F0F0FF", dimTxt = "0x8AA0B0FF";

      // Top row: callsign left, type right
      els.push(T(FLT.cs, { x: 0, y: 0, font: "tiny", color: white, align: "top_left" }));
      els.push(T(FLT.type, { x: 72, y: 0, font: "tiny", color: dimTxt, align: "top_right" }));

      // Route endpoints
      els.push(T(FLT.from, { x: 0, y: 8, font: "tiny", color: sky, align: "mid_left" }));
      els.push(T(FLT.to, { x: 72, y: 8, font: "tiny", color: sky, align: "mid_right" }));

      // Route line: solid where travelled, dotted ahead
      const x0 = 15, x1 = 57, baseY = 9;
      const p = (t % 6.0) / 6.0;
      const px = Math.round(x0 + (x1 - x0) * p);
      const py = baseY - Math.round(Math.sin(p * Math.PI) * 3); // climb then descend
      for (let x = x0; x <= x1; x++) {
        if (x <= px || x % 2 === 0) els.push(solid(x, baseY, 1, 1, dimSky));
      }
      // Endpoint pins
      els.push(solid(x0, baseY - 1, 1, 3, sky));
      els.push(solid(x1, baseY - 1, 1, 3, sky));

      // Plane marker
      els.push(solid(px - 1, py, 3, 1, white)); // fuselage
      els.push(solid(px, py - 1, 1, 1, white));  // tail fin
      els.push(solid(px + 1, py, 1, 1, sky));     // nose accent

      // Bottom row: altitude + speed centered
      const bottom = FLT.alt + "  " + FLT.spd;
      const bw = u.measure(bottom, "tiny");
      els.push(T(bottom, { x: Math.round((72 - bw) / 2), y: 11, font: "tiny", color: dimTxt, align: "top_left" }));

      return els;
    },
  },
  {
    name: "HUD",
    note: "Cockpit head-up display: scrolling heading tape, corner brackets, speed and altitude flanking the callsign.",
    draw(t, u) {
      const els = [];
      const bright = "0x40E0FFFF", dim = "0x1C6E80FF";

      // Corner brackets (L-shaped)
      els.push(solid(0, 0, 3, 1, dim), solid(0, 0, 1, 3, dim));
      els.push(solid(69, 0, 3, 1, dim), solid(71, 0, 1, 3, dim));
      els.push(solid(0, 15, 3, 1, dim), solid(0, 13, 1, 3, dim));
      els.push(solid(69, 15, 3, 1, dim), solid(71, 13, 1, 3, dim));

      // Heading tape scrolling left, with a bright centre caret
      const scroll = Math.round(t * 10) % 6;
      for (let x = 18; x <= 54; x++) {
        if ((x + scroll) % 6 === 0) els.push(solid(x, 0, 1, 2, dim));
      }
      els.push(solid(36, 0, 1, 3, bright));

      // Callsign centred
      const cw = u.measure(FLT.cs, "small");
      const cx0 = Math.round((72 - cw) / 2);
      els.push(T(FLT.cs, { x: cx0, y: 4, font: "small", color: bright, align: "top_left" }));

      // Speed (left) and altitude (right), HUD convention
      els.push(T(FLT.spd, { x: 1, y: 7, font: "tiny", color: bright, align: "mid_left" }));
      els.push(T(FLT.alt, { x: 71, y: 7, font: "tiny", color: bright, align: "mid_right" }));

      // Route along the bottom
      const route = FLT.from + ">" + FLT.to;
      const rw = u.measure(route, "tiny");
      els.push(T(route, { x: Math.round((72 - rw) / 2), y: 11, font: "tiny", color: dim, align: "top_left" }));

      // Faint scan bar drifting down (HUD flicker)
      const scanY = Math.floor((t * 6) % 16);
      els.push(solid(4, scanY, 64, 1, "0x40E0FF12"));

      return els;
    },
  },
];
