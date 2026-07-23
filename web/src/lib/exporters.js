/* Export a draw payload as ready-to-paste code (JSON / curl / Python via
   apps/busybar.py). Pure functions, no DOM — kwargs equal to the busybar.py
   builder defaults are omitted so the Python reads like hand-written app code. */

export function toJson(payload) {
  return JSON.stringify(payload, null, 2);
}

export function toCurl(payload, origin) {
  const json = JSON.stringify(payload).replace(/'/g, "'\\''");
  return `curl -X POST ${origin}/api/display/draw -H 'Content-Type: application/json' -d '${json}'`;
}

export function toPython(payload) {
  const { application_name, priority, elements } = payload;
  if (!elements || !elements.length) return `from busybar import BusyBar\n\nbar = BusyBar()\n`;

  const used = new Set();
  for (const el of elements) if (["text", "rectangle", "image"].includes(el.type)) used.add(el.type);

  let code = `from busybar import BusyBar, ${Array.from(used).sort().join(", ")}\n\n`;
  code += `bar = BusyBar()\n`;
  const lines = elements.map((el) => {
    if (el.type === "text") return pyText(el);
    if (el.type === "rectangle") return pyRect(el);
    if (el.type === "image") return pyImage(el);
    return "    # unknown element";
  });
  code += `bar.display_draw("${application_name}", [\n${lines.join(",\n")}\n]`;
  if (priority !== undefined) code += `, priority=${priority}`;
  return code + ")\n";
}

function pyText(el) {
  const args = [`"${esc(el.text)}"`];
  if (el.x !== 0) args.push(`x=${el.x}`);
  if (el.y !== 0) args.push(`y=${el.y}`);
  if (el.font && el.font !== "normal") args.push(`font="${el.font}"`);
  if (el.color && el.color !== "0xFFFFFFFF") args.push(`color="${el.color}"`);
  if (el.align) args.push(`align="${el.align}"`);
  if (el.display && el.display !== "front") args.push(`display="${el.display}"`);
  return `    text(${args.join(", ")})`;
}

function pyRect(el) {
  const args = [el.x, el.y, el.width || 0, el.height || 0];
  if (el.radius !== undefined) args.push(`radius=${el.radius}`);
  if (el.border_width !== undefined) args.push(`border_width=${el.border_width}`);
  if (el.border_color !== undefined) args.push(`border_color="${el.border_color}"`);
  if (el.fill != null) args.push(`fill="${el.fill}"`);
  if (el.fill_colors && el.fill_colors.length) args.push(`fill_colors=[${el.fill_colors.map((c) => `"${c}"`).join(", ")}]`);
  if (el.align) args.push(`align="${el.align}"`);
  if (el.display && el.display !== "front") args.push(`display="${el.display}"`);
  return `    rectangle(${args.join(", ")})`;
}

function pyImage(el) {
  const args = [];
  if (el.path !== undefined) args.push(`path="${esc(el.path)}"`);
  if (el.stock_path !== undefined) args.push(`stock_path="${esc(el.stock_path)}"`);
  if (el.x !== 0) args.push(`x=${el.x}`);
  if (el.y !== 0) args.push(`y=${el.y}`);
  if (el.opacity !== undefined) args.push(`opacity=${el.opacity}`);
  if (el.color !== undefined) args.push(`color="${el.color}"`);
  if (el.align) args.push(`align="${el.align}"`);
  if (el.display && el.display !== "front") args.push(`display="${el.display}"`);
  return `    image(${args.join(", ")})`;
}

function esc(s) {
  return (s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
