// Inline SVG icons (stroke=currentColor), matching the real interface's i-bi-* set.
const s = (inner, sw = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const icons = {
  wifi: s('<path d="M2 9c6-5 14-5 20 0M5 12.5c4-3.3 10-3.3 14 0M8.5 16c2-1.6 5-1.6 7 0"/><circle cx="12" cy="19" r="1"/>'),
  chip: s('<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  hexagon: s('<path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  palette: s('<path d="M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.5 0-.5-.3-.8-.3-1.2 0-.7.6-1.3 1.3-1.3H16a5 5 0 005-5c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>'),
  sound: s('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a4 4 0 010 7M18 6a7 7 0 010 12"/>'),
  soundOff: s('<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/>'),
  brightness: s('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  brightnessAuto: s('<circle cx="12" cy="12" r="4"/><path d="M12 3v1M12 20v1M20 12h1M3 12h1"/>'),
  globe: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/>'),
  matter: s('<path d="M3 10v4M7 8v8M12 5v14M17 8v8M21 10v4"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>'),
  plus: s('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 2),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  list: s('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  text: s('<path d="M4 6h16M4 6v-.5M9 6v13M15 6v13"/>'),
  square: s('<rect x="4" y="6" width="16" height="12" rx="2"/>'),
  image: s('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-6 6"/>'),
  film: s('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  trash: s('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>'),
  usb: s('<circle cx="12" cy="20" r="1.6" fill="currentColor" stroke="none"/><path d="M12 20V6M12 6l-2.2 3M12 6l2.2 3M12 13l-4-2.2v-2M12 11l4-2.2V6.5"/>'),
  battery: s('<rect x="2" y="8" width="17" height="9" rx="2"/><path d="M21 11v3"/><rect x="4" y="10" width="11" height="5" rx="1" fill="currentColor" stroke="none"/>'),
  play: s('<polygon points="5,3 19,12 5,21" fill="currentColor" stroke="none"/>'),
  flask: s('<path d="M9.5 3h5M10 3v5.2L4.8 17.6a2 2 0 001.8 2.9h10.8a2 2 0 001.8-2.9L14 8.2V3M7.2 14.5h9.6"/>'),
}

// Header battery states, taken verbatim from the firmware web app's "busy" iconify
// collection (assets/frontend-build, 28×24). Shell/pin at 0.3, charge level at 0.2 opacity.
const b = (inner) => `<svg viewBox="0 0 28 24" fill="none">${inner}</svg>`
const BATT_SHELL = '<path d="M23 18V19H3V18H23ZM25 16V8C25 6.89543 24.1046 6 23 6H3C1.89543 6 1 6.89543 1 8V16C1 17.1046 1.89543 18 3 18V19C1.39489 19 0.0842144 17.7394 0.00390625 16.1543L0 16V8C1.28853e-07 6.34315 1.34315 5 3 5H23L23.1543 5.00391C24.7394 5.08421 26 6.39489 26 8V16L25.9961 16.1543C25.9184 17.6883 24.6883 18.9184 23.1543 18.9961L23 19V18C24.1046 18 25 17.1046 25 16Z" fill="currentColor" fill-opacity="0.3"/><path d="M27 9H28V15H27V9Z" fill="currentColor" fill-opacity="0.3"/>'
export const batteryIcons = {
  charging: b('<defs><linearGradient id="paint0_linear_3674_35354" x1="24" y1="12" x2="2" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0.6"/></linearGradient><linearGradient id="paint1_linear_3674_35354" x1="24" y1="12" x2="2" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0.6"/></linearGradient></defs><g fill="none"><path d="M27 9H28V15H27V9Z" fill="currentColor" fill-opacity="0.3"/><path d="M12.1963 6H3C1.89543 6 1 6.89543 1 8V16C1 17.1046 1.89543 18 3 18H11V19H3C1.39489 19 0.0842144 17.7394 0.00390625 16.1543L0 16V8C1.28853e-07 6.34315 1.34315 5 3 5H12.8213L12.1963 6Z" fill="currentColor" fill-opacity="0.3"/><path d="M23.1543 5.00391C24.7394 5.08421 26 6.39489 26 8V16L25.9961 16.1543C25.9184 17.6883 24.6883 18.9184 23.1543 18.9961L23 19H13.1787L13.8037 18H23C24.1046 18 25 17.1046 25 16V8C25 6.89543 24.1046 6 23 6H15V5H23L23.1543 5.00391Z" fill="currentColor" fill-opacity="0.3"/><path d="M8.15234 12.4697C7.95977 12.7778 7.94903 13.1665 8.125 13.4844C8.30123 13.8023 8.63647 14 9 14H11V17H3.16699C2.52266 17 2 16.4773 2 15.833V8.16699C2 7.52266 2.52266 7 3.16699 7H11.5713L8.15234 12.4697Z" fill="url(#paint0_linear_3674_35354)" fill-opacity="0.2"/><path d="M22.833 7C23.4773 7 24 7.52266 24 8.16699V15.833C24 16.4773 23.4773 17 22.833 17H14.4287L17.8477 11.5303C18.0402 11.2222 18.051 10.8335 17.875 10.5156C17.6988 10.1977 17.3635 10 17 10H15V7H22.833Z" fill="url(#paint1_linear_3674_35354)" fill-opacity="0.2"/><path d="M9 13L14 5V11H17L12 19V13H9" fill="#00C16A"/></g>'),
  full: b(`<g fill="none">${BATT_SHELL}<rect x="2" y="7" width="22" height="10" rx="1.16667" fill="currentColor" fill-opacity="0.2"/></g>`),
  discharging1: b(`<g fill="none">${BATT_SHELL}<path d="M2 8C2 7.44772 2.44772 7 3 7H21V17H3C2.44771 17 2 16.5523 2 16V8Z" fill="currentColor" fill-opacity="0.2"/></g>`),
  discharging2: b(`<g fill="none">${BATT_SHELL}<path d="M2 8C2 7.44772 2.44772 7 3 7H15V17H3C2.44772 17 2 16.5523 2 16V8Z" fill="currentColor" fill-opacity="0.2"/></g>`),
  discharging3: b(`<g fill="none">${BATT_SHELL}<path d="M2 7.99997C2 7.44769 2.44771 6.99998 2.99998 6.99997L9 6.99988V16.9999L3.00002 17C2.44772 17 2 16.5523 2 16V7.99997Z" fill="currentColor" fill-opacity="0.2"/></g>`),
  error: b('<g fill="none"><path d="M27 9H28V15H27V9Z" fill="currentColor" fill-opacity="0.3"/><path d="M3 6C1.89543 6 1 6.89543 1 8V16C1 17.1046 1.89543 18 3 18H11V19H3C1.39489 19 0.0842144 17.7394 0.00390625 16.1543L0 16V8C1.28853e-07 6.34315 1.34315 5 3 5H23L23.1543 5.00391C24.7394 5.08421 26 6.39489 26 8V16L25.9961 16.1543C25.9184 17.6883 24.6883 18.9184 23.1543 18.9961L23 19H15V18H23C24.1046 18 25 17.1046 25 16V8C25 6.89543 24.1046 6 23 6H3Z" fill="currentColor" fill-opacity="0.3"/><path d="M12 8H14V15H12V8Z" fill="#FF6060"/><path d="M12 17H14V19H12V17Z" fill="#FF6060"/></g>'),
}
