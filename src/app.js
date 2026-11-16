// Network Diagram app, version 1: record, save, share, export.
//
// Hard rule (DIAGRAM_APP_SPEC.md, section 2): this file holds no rack plan. No expected addresses, VLANs,
// port assignments, routes or policies. Everything drawn comes from what the team typed. The only built-in
// facts are device kinds, the switch's port names and the firewall's interface names, which students
// already have on the reference pages.
"use strict";
(() => {
const SCHEMA = 1;
const KEY = "cyberhub-diagram";
const VB = { w: 1600, h: 800 };
const SW_PORTS = ["XG1","XG2","XG3","XG4","XG5","XG6","XG7","XG8","XG9","XG10","XG11","XG12","OOB"];
const FW_IFS = ["wan1", "internal", "dmz", "guest Wi-Fi"];
const SERVICES = ["ALL", "PING", "HTTP", "HTTPS", "SSH", "FTP", "DNS"];
const ACCESS = ["PING", "HTTPS", "SSH", "HTTP"];
const KINDS = {
  isp: "ISP router", firewall: "Firewall", switch: "Switch", hypervisor: "Hypervisor", nas: "NAS",
  pi: "Raspberry Pi", laptop: "Laptop", vm: "Virtual machine", generic: "Device",
};
const ENDPOINT = new Set(["hypervisor", "nas", "pi", "laptop", "vm", "generic"]);
const BOX_W = 270;
// Every rack has the same devices, so the layout is fixed. Teams add only laptops and virtual machines.
const FIXED = ["isp", "fw", "sw", "hv", "nas", "lap", "pi", "isplap", "guest"];
const removable = (d) => d.kind === "vm" || !FIXED.includes(d.id);

const $ = (id) => document.getElementById(id);
const svg = $("svg"), panel = $("panel"), listView = $("v-list");
const NS = "http://www.w3.org/2000/svg";

// ------------------------------------------------------------------ document
let uid = 0;
const newId = (p) => p + Date.now().toString(36) + (uid++).toString(36);
const ep = () => ({ address: "", mask: "", gateway: "", dhcp: false });
function blankDoc() {
  return {
    v: SCHEMA, meta: { company: "", updated: null },
    devices: [
      { id: "isp", kind: "isp", name: "ISP router", x: 30, y: 340, address: "", mask: "" },
      { id: "fw", kind: "firewall", name: "Firewall", x: 360, y: 340,
        interfaces: FW_IFS.map((n) => ({ name: n, address: "", mask: "", access: [], ...(n === "guest Wi-Fi" ? { ssid: "" } : {}) })),
        routes: [], vips: [], policies: [] },
      { id: "sw", kind: "switch", name: "Core switch", x: 740, y: 340, vlans: [], svis: [], routes: [],
        ports: SW_PORTS.map((n) => ({ name: n, mode: "", pvid: "", tagged: [], shutdown: false })), dhcpPools: [] },
      { id: "hv", kind: "hypervisor", name: "Hypervisor", x: 1200, y: 30, ...ep() },
      { id: "nas", kind: "nas", name: "NAS", x: 1200, y: 380, ...ep() },
      { id: "lap", kind: "laptop", name: "Team laptop (Data)", x: 1200, y: 510, ...ep() },
      { id: "pi", kind: "pi", name: "Vulnerable Pi", x: 1200, y: 640, ...ep() },
      { id: "isplap", kind: "laptop", name: "ISP-side laptop", x: 30, y: 600, ...ep() },
      { id: "guest", kind: "laptop", name: "Guest laptop", x: 360, y: 640, ...ep() },
    ],
    links: [],
  };
}
let doc = blankDoc();
const dev = (id) => doc.devices.find((d) => d.id === id);
const vmsOf = (id) => doc.devices.filter((d) => d.kind === "vm" && d.host === id);
const portsFor = (d) => d.kind === "switch" ? SW_PORTS : d.kind === "firewall" ? FW_IFS : d.kind === "isp" ? ["LAN"] : [];

// Bring an older or hand-edited document up to the current shape.
function normalize(x) {
  const d = blankDoc();
  if (!x || typeof x !== "object" || !Array.isArray(x.devices)) throw new Error("not a diagram");
  d.meta = { company: String(x.meta?.company ?? ""), updated: x.meta?.updated ?? null };
  d.devices = x.devices.filter((v) => v && KINDS[v.kind]).map((v) => {
    const o = { ...v, id: String(v.id || newId("d")), name: String(v.name ?? KINDS[v.kind]) };
    if (o.kind !== "vm") { o.x = +o.x || 40; o.y = +o.y || 40; }
    if (ENDPOINT.has(o.kind)) { for (const [k, val] of Object.entries(ep())) if (o[k] === undefined) o[k] = val; }
    if (o.kind === "vm" && o.vlanTag === undefined) o.vlanTag = "";
    if (o.kind === "switch") {
      for (const k of ["vlans", "svis", "routes", "dhcpPools"]) o[k] = Array.isArray(o[k]) ? o[k] : [];
      const have = new Map((o.ports || []).map((p) => [p.name, p]));
      o.ports = SW_PORTS.map((n) => ({ name: n, mode: "", pvid: "", tagged: [], shutdown: false, ...(have.get(n) || {}) }));
    }
    if (o.kind === "firewall") {
      for (const k of ["routes", "vips", "policies"]) o[k] = Array.isArray(o[k]) ? o[k] : [];
      const have = new Map((o.interfaces || []).map((p) => [p.name, p]));
      o.interfaces = FW_IFS.map((n) => ({ name: n, address: "", mask: "", access: [], ...(n === "guest Wi-Fi" ? { ssid: "" } : {}), ...(have.get(n) || {}) }));
    }
    if (o.kind === "isp") { o.address ??= ""; o.mask ??= ""; }
    return o;
  });
  // Every rack has the same devices: put back any that an older version let a team delete.
  for (const f of blankDoc().devices) if (!d.devices.some((v) => v.id === f.id)) d.devices.push(f);
  const ids = new Set(d.devices.map((v) => v.id));
  d.links = (Array.isArray(x.links) ? x.links : []).filter((l) => l && ids.has(l.a?.device) && ids.has(l.b?.device))
    .map((l) => ({ id: String(l.id || newId("l")), a: { device: l.a.device, port: String(l.a.port || "") }, b: { device: l.b.device, port: String(l.b.port || "") } }));
  return d;
}

// ------------------------------------------------------------------ address helpers (format only, never values)
const isIP = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((n) => +n <= 255);
function maskToPrefix(m) {
  m = String(m).trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(m) && +m <= 32) return String(+m);
  if (isIP(m)) {
    const bits = m.split(".").map((n) => (+n).toString(2).padStart(8, "0")).join("");
    if (/^1*0*$/.test(bits)) return String(bits.indexOf("0") === -1 ? 32 : bits.indexOf("0"));
  }
  return null;
}
const isCIDR = (s) => { const [a, p, ...r] = String(s).split("/"); return !r.length && isIP(a) && p !== undefined && maskToPrefix(p) !== null; };
const withPrefix = (a, m) => a ? a + (m ? "/" + m : "") : "";

// ------------------------------------------------------------------ history and saving
let hist = [], hi = -1, sharedJSON = null, saveFailed = false;
const snapshot = () => JSON.stringify(doc);
const contentOf = (j) => { try { const o = JSON.parse(j); delete o.meta.updated; return JSON.stringify(o); } catch { return j; } };
function commit() {
  const s = snapshot();
  if (hist[hi] === s) return;
  hist = hist.slice(0, hi + 1); hist.push(s);
  if (hist.length > 120) hist.shift();
  hi = hist.length - 1;
  doc.meta.updated = new Date().toISOString();
  save(); updateButtons();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(doc)); saveFailed = false; }
  catch { saveFailed = true; }
  const el = $("saved");
  el.classList.toggle("warn", saveFailed);
  el.textContent = saveFailed ? "Not saved: this browser blocks storage. Copy the share link to keep your work."
    : "Saved in this browser at " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function updateButtons() {
  $("b-undo").disabled = hi <= 0; $("b-redo").disabled = hi >= hist.length - 1;
  $("b-share").querySelector(".dot").hidden = sharedJSON === null ? !hasContent() : contentOf(sharedJSON) === contentOf(snapshot());
}
function restore(j) { doc = JSON.parse(j); doc.meta.updated = new Date().toISOString(); save(); if (sel && !findSel()) sel = null; renderAll(); updateButtons(); }
const undo = () => { if (hi > 0) restore(hist[--hi]); };
const redo = () => { if (hi < hist.length - 1) restore(hist[++hi]); };
function hasContent() {
  return doc.links.length > 0 || doc.devices.some((d) => d.address || d.gateway || d.svis?.length || d.vlans?.length ||
    d.interfaces?.some((i) => i.address) || d.kind === "vm");
}

// ------------------------------------------------------------------ selection
let sel = null; // {type:'dev'|'link', id}
const findSel = () => sel && (sel.type === "dev" ? dev(sel.id) : doc.links.find((l) => l.id === sel.id));
function select(s) { sel = s; renderSvg(); renderPanel(); }

// ------------------------------------------------------------------ drawing
// The layout follows the lab's traffic path, top to bottom: ISP router, firewall, core switch, then the hosts.
// The switch and firewall are drawn with their real ports; cables plug into the port they were recorded on.
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const text = (parent, x, y, cls, s, anchor) => { const t = el("text", { x, y, class: cls, "text-anchor": anchor }, parent); t.textContent = s; return t; };

function valueLines(d) {
  const L = [];
  if (d.kind === "isp") { if (d.address) L.push(withPrefix(d.address, d.mask)); }
  else if (d.kind === "firewall") { for (const i of d.interfaces) if (i.address) L.push(`${i.name} ${withPrefix(i.address, i.mask)}`); }
  else if (d.kind === "switch") {
    const s = d.svis.filter((v) => v.address || v.vlan);
    s.slice(0, 6).forEach((v) => L.push(`VLAN ${v.vlan || "?"} ${withPrefix(v.address, v.mask)}`.trim()));
    if (s.length > 6) L.push(`+${s.length - 6} more SVIs`);
    d.routes.filter((r) => r.dest).slice(0, 2).forEach((r) => L.push(`${r.dest} via ${r.nextHop || "?"}`));
    if (d.routes.length > 2) L.push(`+${d.routes.length - 2} more routes`);
  } else if (ENDPOINT.has(d.kind)) {
    if (d.address) L.push(withPrefix(d.address, d.mask)); else if (d.dhcp) L.push("DHCP");
    if (d.gateway) L.push("gw " + d.gateway);
  }
  return L;
}

// Geometry
const VM_H = 42, PORT_W = 60, PORT_H = 54, PITCH = 66, OOB_GAP = 16, TAB_W = 64, TAB_H = 22;
const SW_TEXT_W = 270, SW_W = 20 + 12 * PITCH + OOB_GAP + PORT_W + 26 + SW_TEXT_W;
const HOST_W = 260, HOST_PITCH = 290, FW_W = 400;
function boxSize(d) {
  const lines = valueLines(d).length;
  if (d.kind === "switch") return { w: SW_W, h: Math.max(130, 46 + lines * 19) };
  if (d.kind === "firewall") return { w: FW_W, h: Math.max(110, 66 + lines * 19) };
  let h = 42 + lines * 19 + (lines ? 8 : 0);
  if (d.kind === "hypervisor") h += vmsOf(d.id).length * (VM_H + 6) + (vmsOf(d.id).length ? 6 : 0);
  return { w: d.kind === "isp" ? FW_W : HOST_W, h: Math.max(h, 80) };
}
const center = (d) => { const { w, h } = boxSize(d); return [d.x + w / 2, d.y + h / 2]; };
// Switch port square, in canvas coordinates
function portRect(sw, name) {
  const i = SW_PORTS.indexOf(name);
  if (i < 0) return null;
  const { h } = boxSize(sw);
  const x = sw.x + 20 + i * PITCH + (name === "OOB" ? OOB_GAP : 0);
  return { x, y: sw.y + (h - PORT_H) / 2, w: PORT_W, h: PORT_H, cx: x + PORT_W / 2 };
}
// Firewall interface tabs and the ISP router's LAN tab sit on the box edges
function tabRect(d, name) {
  const { w, h } = boxSize(d);
  if (d.kind === "isp" && name === "LAN") return { x: d.x + 30, y: d.y + h - TAB_H / 2, w: TAB_W, h: TAB_H, side: "bottom" };
  if (d.kind !== "firewall") return null;
  if (name === "wan1") return { x: d.x + 30, y: d.y - TAB_H / 2, w: TAB_W, h: TAB_H, side: "top" };
  if (name === "internal") return { x: d.x + 30, y: d.y + h - TAB_H / 2, w: TAB_W, h: TAB_H, side: "bottom" };
  if (name === "dmz") return { x: d.x + 30 + PITCH, y: d.y + h - TAB_H / 2, w: TAB_W, h: TAB_H, side: "bottom" };
  if (name === "guest Wi-Fi") return { x: d.x + w - 45, y: d.y + h / 2 - TAB_H / 2, w: 90, h: TAB_H, side: "right" };
  return null;
}

// Positions are fixed: every rack has the same devices.
function hosts() {
  return [...["hv", "nas", "pi", "lap"].map(dev).filter(Boolean),
    ...doc.devices.filter((d) => d.kind !== "vm" && !FIXED.includes(d.id))];
}
let lanes = new Map(); // link id -> y of its horizontal run below the switch
function layout() {
  const sw = dev("sw"), fw = dev("fw"), isp = dev("isp");
  const SWX = 60;
  if (isp) { isp.x = SWX - 12; isp.y = 30; }
  const ispB = isp ? isp.y + boxSize(isp).h : 30;
  if (fw) { fw.x = SWX - 12; fw.y = ispB + 74; }
  const fwB = fw ? fw.y + boxSize(fw).h : ispB;
  const side = (id, ref) => { const d = dev(id); if (d && ref) { d.x = ref.x + boxSize(ref).w + 150; d.y = ref.y + (boxSize(ref).h - boxSize(d).h) / 2; } };
  side("isplap", isp); side("guest", fw);
  if (sw) { sw.x = SWX; sw.y = fwB + 84; }
  const swB = sw ? sw.y + boxSize(sw).h : fwB + 84;
  const H = hosts();
  H.forEach((d, i) => { d.x = SWX + i * HOST_PITCH; });
  // Lanes for cables running down from the switch, so their horizontal runs never overlap.
  lanes = new Map();
  if (sw) {
    const down = doc.links.map((l) => {
      const [s, o] = l.a.device === "sw" ? [l.a, l.b] : l.b.device === "sw" ? [l.b, l.a] : [null, null];
      const od = o && dev(o.device);
      if (!s || !od || !H.includes(od)) return null;
      const pr = portRect(sw, s.port), from = pr ? pr.cx : sw.x + SW_W / 2, to = od.x + HOST_W / 2 + spreadOffset(od, l);
      return Math.abs(from - to) < 2 ? null : { l, from, to, lo: Math.min(from, to), hi: Math.max(from, to), left: to < from };
    }).filter(Boolean);
    const order = [...down.filter((c) => c.left).sort((a, b) => a.to - b.to), ...down.filter((c) => !c.left).sort((a, b) => b.to - a.to)];
    const used = [];
    for (const c of order) {
      let k = 0;
      while ((used[k] || []).some((u) => c.lo < u.hi + 14 && u.lo < c.hi + 14)) k++;
      (used[k] ||= []).push(c); lanes.set(c.l.id, k);
    }
    const n = used.length;
    for (const [id, k] of lanes) lanes.set(id, swB + 30 + k * 20);
    const hostY = swB + 30 + Math.max(0, n - 1) * 20 + 46;
    H.forEach((d) => { d.y = hostY; });
    VB.w = Math.max(1320, SWX + H.length * HOST_PITCH + 30);
  }
  const bottom = Math.max(...doc.devices.filter((d) => d.kind !== "vm").map((d) => d.y + boxSize(d).h));
  VB.h = bottom + (hasContent() ? 40 : 90);
  svg.setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`);
}
// Several cables meeting one host side are spread apart
function spreadOffset(d, l) {
  // only cables arriving from above or below share a side
  const mine = doc.links.filter((x) => (x.a.device === d.id || x.b.device === d.id) && (() => {
    const o = dev(x.a.device === d.id ? x.b.device : x.a.device); if (!o) return false;
    const [, oy] = center(o); return oy + 10 < d.y || oy - 10 > d.y + boxSize(d).h; })());
  if (mine.length < 2) return 0;
  const i = mine.indexOf(l);
  return (i - (mine.length - 1) / 2) * 26;
}

// Where a cable meets a device: the recorded port if there is one, else the side facing the other end
function anchor(d, port, other, l) {
  const { w, h } = boxSize(d), [ox, oy] = center(other);
  if (d.kind === "switch") {
    const pr = portRect(d, port);
    if (pr) return oy < d.y ? { x: pr.cx, y: pr.y, side: "top" } : { x: pr.cx, y: pr.y + pr.h, side: "bottom" };
  }
  const t = tabRect(d, port);
  if (t && !(d.kind === "isp" && oy < d.y + h)) {
    if (t.side === "top") return { x: t.x + t.w / 2, y: t.y, side: "top" };
    if (t.side === "bottom") return { x: t.x + t.w / 2, y: t.y + t.h, side: "bottom" };
    return { x: t.x + t.w, y: t.y + t.h / 2, side: "right" };
  }
  const off = (oy + 10 < d.y || oy - 10 > d.y + h) ? spreadOffset(d, l) : 0;
  if (oy + 10 < d.y) return { x: d.x + w / 2 + off, y: d.y, side: "top" };
  if (oy - 10 > d.y + h) return { x: d.x + w / 2 + off, y: d.y + h, side: "bottom" };
  return ox < d.x ? { x: d.x, y: d.y + h / 2 + off, side: "left" } : { x: d.x + w, y: d.y + h / 2 + off, side: "right" };
}
function route(A, B, laneY) {
  const V = (s) => s === "top" || s === "bottom";
  let pts;
  if (V(A.side) && V(B.side)) {
    if (Math.abs(A.x - B.x) < 2) pts = [A, B];
    else { const y = laneY ?? (A.y + B.y) / 2; pts = [A, { x: A.x, y }, { x: B.x, y }, B]; }
  } else if (!V(A.side) && !V(B.side)) {
    if (Math.abs(A.y - B.y) < 2) pts = [A, B];
    else { const x = (A.x + B.x) / 2; pts = [A, { x, y: A.y }, { x, y: B.y }, B]; }
  } else if (V(A.side)) pts = [A, { x: A.x, y: B.y }, B];
  else pts = [A, { x: B.x, y: A.y }, B];
  // rounded corners
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const r = Math.min(10, Math.hypot(p.x - a.x, p.y - a.y) / 2, Math.hypot(b.x - p.x, b.y - p.y) / 2);
    const ux = Math.sign(p.x - a.x), uy = Math.sign(p.y - a.y), vx = Math.sign(b.x - p.x), vy = Math.sign(b.y - p.y);
    d += ` L${p.x - ux * r},${p.y - uy * r} Q${p.x},${p.y} ${p.x + vx * r},${p.y + vy * r}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${z.x},${z.y}`;
}
const isWifi = (l) => [l.a, l.b].some((e) => e.port === "guest Wi-Fi");
function portMode(p) {
  if (p.shutdown) return ["off", ""];
  if (p.mode === "access") return ["access", p.pvid || ""];
  if (p.mode === "trunk") { const v = [p.pvid, p.tagged.join(",")].filter(Boolean).join("|"); return ["trunk", v.length > 9 ? v.slice(0, 8) + "…" : v]; }
  return ["", ""];
}

function drawInto(root, ui) {
  layout();
  // Devices first, cables on top: a cable runs across the switch's face into its port square.
  const gd = el("g", {}, root), gl = el("g", {}, root);
  for (const l of doc.links) {
    const A = dev(l.a.device), B = dev(l.b.device);
    if (!A || !B || A.kind === "vm" || B.kind === "vm") continue;
    const pa = anchor(A, l.a.port, B, l), pb = anchor(B, l.b.port, A, l);
    const path = route(pa, pb, lanes.get(l.id));
    const g = el("g", { class: "lk" + (ui && sel?.type === "link" && sel.id === l.id ? " sel" : ""), "data-link": l.id }, gl);
    el("path", { d: path, class: "d-link" + (isWifi(l) ? " wifi" : "") }, g);
    if (ui) el("path", { d: path, class: "hit" }, g);
  }
  for (const d of doc.devices) {
    if (d.kind === "vm") continue;
    const { w, h } = boxSize(d);
    const g = el("g", { class: "dev k-" + d.kind + (ui && sel?.type === "dev" && sel.id === d.id ? " sel" : ""), "data-dev": d.id,
      transform: `translate(${d.x},${d.y})`, ...(ui ? { tabindex: 0, role: "button", "aria-label": `${d.name}, ${KINDS[d.kind]}` } : {}) }, gd);
    el("rect", { width: w, height: h, rx: 10, class: "d-box" + (d.kind === "isp" ? " fixed" : "") }, g);
    const lines = valueLines(d);
    if (d.kind === "switch") {
      const tx = w - SW_TEXT_W + 6;
      el("line", { x1: tx - 14, y1: 14, x2: tx - 14, y2: h - 14, class: "d-div" }, g);
      text(g, tx, 30, "d-name", d.name, "start");
      lines.forEach((s, i) => text(g, tx, 52 + i * 19, "d-val", s, "start"));
      for (const p of d.ports) {
        const r = portRect(d, p.name), [mode, vl] = portMode(p);
        const pg = el("g", { class: "port" + (p.shutdown ? " off" : ""), ...(ui ? { "data-port": p.name, "data-pdev": d.id } : {}) }, g);
        el("rect", { x: r.x - d.x, y: r.y - d.y, width: r.w, height: r.h, rx: 5, class: "d-port" }, pg);
        text(pg, r.cx - d.x, r.y - d.y + 16, "d-pname", p.name, "middle");
        if (mode) text(pg, r.cx - d.x, r.y - d.y + 31, "d-pmode", mode, "middle");
        if (vl) text(pg, r.cx - d.x, r.y - d.y + 45, "d-pvl", vl, "middle");
        if (ui) pg.appendChild(Object.assign(document.createElementNS(NS, "title"), { textContent: `${p.name}: drag to a device to record a cable` }));
      }
      continue;
    }
    const alone = !lines.length && !(d.kind === "hypervisor" && vmsOf(d.id).length);
    text(g, w / 2, alone ? h / 2 + 6 : 30, "d-name", d.name || KINDS[d.kind], "middle");
    lines.forEach((s, i) => text(g, w / 2, 53 + i * 19, "d-val", s, "middle"));
    if (d.kind === "hypervisor") {
      let y = 44 + lines.length * 19 + (lines.length ? 8 : 0) + 2;
      for (const v of vmsOf(d.id)) {
        const vg = el("g", { class: "vm" + (ui && sel?.type === "dev" && sel.id === v.id ? " sel" : ""), "data-vm": v.id,
          ...(ui ? { tabindex: 0, role: "button", "aria-label": `${v.name}, virtual machine` } : {}) }, g);
        el("rect", { x: 12, y, width: w - 24, height: VM_H, rx: 6, class: "d-vm" }, vg);
        const det = [v.vlanTag ? "tag " + v.vlanTag : "", withPrefix(v.address, v.mask)].filter(Boolean).join("  ");
        text(vg, 22, y + 17, "d-vmname", v.name, "start");
        if (det) text(vg, 22, y + 34, "d-val", det, "start");
        y += VM_H + 6;
      }
    }
    const tabs = d.kind === "firewall" ? FW_IFS : d.kind === "isp" ? ["LAN"] : [];
    for (const name of tabs) {
      const t = tabRect(d, name);
      const tg = el("g", { class: "port", ...(ui ? { "data-port": name, "data-pdev": d.id } : {}) }, g);
      el("rect", { x: t.x - d.x, y: t.y - d.y, width: t.w, height: t.h, rx: 4, class: "d-tab" }, tg);
      text(tg, t.x - d.x + t.w / 2, t.y - d.y + 15, "d-tabname", name, "middle");
      if (ui) tg.appendChild(Object.assign(document.createElementNS(NS, "title"), { textContent: `${name}: drag to a device to record a cable` }));
    }
  }
}
function renderSvg() {
  svg.replaceChildren();
  drawInto(svg, true);
  const sw = dev("sw");
  const gx = (dev("guest")?.x ?? 600) + HOST_W + 60, g = el("g", { class: "ghint" }, svg);
  const tips = hasContent()
    ? ["Solid line: cable.  Dashed line: Wi-Fi."]
    : ["Solid line: cable.  Dashed line: Wi-Fi.", "", "To record a cable, drag from a switch port,",
      "a firewall interface or any device", "to the device on the other end.",
      "", "Select a device to enter its settings.", "Record only what you have built."];
  tips.forEach((s, i) => text(g, gx, 50 + i * 22, "ghint", s));
}

// ------------------------------------------------------------------ canvas interaction
const toSvg = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
let drag = null;
function dropTarget(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const p = t?.closest("[data-port]"), g = t?.closest("[data-dev]");
  return g ? { device: g.dataset.dev, port: p ? p.dataset.port : "" } : null;
}
svg.addEventListener("pointerdown", (e) => {
  const port = e.target.closest("[data-port]"), vmEl = e.target.closest("[data-vm]"), box = e.target.closest("[data-dev]");
  if (vmEl) { select({ type: "dev", id: vmEl.dataset.vm }); return; }
  // Press on a port or a device: a click selects it, a drag records a cable from it.
  if (port || box) {
    const from = port ? { device: port.dataset.pdev, port: port.dataset.port } : { device: box.dataset.dev, port: "" };
    const p = toSvg(e);
    drag = { from, sx: e.clientX, sy: e.clientY, line: el("line", { x1: p.x, y1: p.y, x2: p.x, y2: p.y, class: "temp", style: "display:none" }, svg) };
    svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  const lk = e.target.closest("[data-link]");
  if (lk) { select({ type: "link", id: lk.dataset.link }); return; }
  if (sel) select(null);
});
svg.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const p = toSvg(e);
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
  drag.line.style.display = "";
  drag.line.setAttribute("x2", p.x); drag.line.setAttribute("y2", p.y);
  svg.querySelectorAll(".drop").forEach((n) => n.classList.remove("drop"));
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const target = t?.closest("[data-port]") || t?.closest("[data-dev]");
  if (target && (target.dataset.dev || target.dataset.pdev) !== drag.from.device) target.classList.add("drop");
});
svg.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const dr = drag; drag = null;
  dr.line.remove();
  const to = dropTarget(e);
  if (Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 6) { select({ type: "dev", id: dr.from.device }); return; }
  if (to && to.device !== dr.from.device) addLink(dr.from, to); else renderSvg();
});
svg.addEventListener("keydown", (e) => {
  const g = e.target.closest?.("[data-vm]") || e.target.closest?.("[data-dev]");
  if (!g) return;
  const id = g.dataset.vm || g.dataset.dev;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault(); select({ type: "dev", id });
    svg.querySelector(g.dataset.vm ? `[data-vm="${id}"]` : `[data-dev="${id}"]`)?.focus();
  }
});
function addLink(a, b) {
  const used = (e) => e.port && doc.links.some((l) => [l.a, l.b].some((x) => x.device === e.device && x.port === e.port));
  if (used(a) || used(b)) toast(`${used(a) ? a.port : b.port} already has a cable. Recorded anyway; check the port.`);
  const l = { id: newId("l"), a: { ...a }, b: { ...b } };
  doc.links.push(l); commit(); select({ type: "link", id: l.id });
  if (!used(a) && !used(b)) toast(portsFor(dev(a.device)).length && !a.port || portsFor(dev(b.device)).length && !b.port
    ? "Cable recorded. Choose the port it uses." : "Cable recorded.");
}

// ------------------------------------------------------------------ form helpers
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (k === "value") n.value = v;
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
};
// A text field bound to obj[key]. kind: 'ip' | 'cidr' | 'mask' | 'num' | 'list' | undefined
function inp(obj, key, { kind, ph, label, onAfter, size } = {}) {
  const val = kind === "list" ? (obj[key] || []).join(", ") : (obj[key] ?? "");
  const hint = h("span", { class: "hint", hidden: true });
  const check = (s) => {
    let bad = "";
    if (s && kind === "ip" && !isIP(s) && !isCIDR(s)) bad = "Not an IPv4 address";
    if (s && kind === "cidr" && !isCIDR(s) && !isIP(s)) bad = "Use an address with a prefix, like a.b.c.d/nn";
    if (s && kind === "mask" && maskToPrefix(s) === null) bad = "Use a prefix like /nn or a dotted mask";
    if (s && kind === "num" && !/^\d+$/.test(s)) bad = "Use a number";
    if (s && kind === "list" && !/^\s*\d+(\s*,\s*\d+)*\s*$/.test(s)) bad = "Use numbers separated by commas";
    hint.hidden = !bad; hint.textContent = bad;
  };
  const i = h("input", { value: val, placeholder: ph || "", "aria-label": label || key, size,
    spellcheck: false, autocomplete: "off",
    oninput: (e) => { set(e.target.value, false); check(e.target.value.trim()); renderSvg(); },
    onchange: (e) => {
      let s = e.target.value.trim();
      if (kind === "ip" && s.includes("/") && "mask" in obj) { const [a, p] = s.split("/"); if (isIP(a) && maskToPrefix(p) !== null) { obj.mask = maskToPrefix(p); s = a; } }
      if (kind === "mask" && maskToPrefix(s) !== null) s = maskToPrefix(s);
      set(s, true); e.target.value = kind === "list" ? (obj[key] || []).join(", ") : obj[key];
      check(s); commit(); renderSvg(); onAfter?.(); if (kind === "ip" && "mask" in obj) renderPanel();
    } });
  function set(s, final) {
    if (kind === "list") obj[key] = s.split(",").map((x) => x.trim()).filter(Boolean);
    else obj[key] = final ? s.trim() : s;
  }
  check(String(val));
  return h("span", { style: "display:block" }, i, hint);
}
const field = (label, input) => h("label", { class: "f" }, h("span", {}, label), input);
function chk(obj, key, label) {
  return h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!obj[key],
    onchange: (e) => { obj[key] = e.target.checked; commit(); renderSvg(); } }), label);
}
function multi(obj, key, options) {
  return h("div", { class: "checks" }, options.map((o) => h("label", { class: "check" }, h("input", { type: "checkbox",
    checked: (obj[key] || []).includes(o), onchange: (e) => {
      const s = new Set(obj[key] || []); e.target.checked ? s.add(o) : s.delete(o); obj[key] = options.filter((x) => s.has(x)); commit(); renderSvg();
    } }), o)));
}
function selectBox(obj, key, options, label, blank = "Not set") {
  return h("select", { "aria-label": label, onchange: (e) => { obj[key] = e.target.value; commit(); renderSvg(); } },
    h("option", { value: "" }, blank), options.map((o) => h("option", { value: o, selected: obj[key] === o }, o)));
}
// Editable rows. cols: [{key, label, kind, ph, w}]
function rows(arr, cols, make, label, rerender) {
  const t = h("table", { class: "t" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { style: c.w ? `width:${c.w}` : "" }, c.label)), h("th", {}))),
    h("tbody", {}, arr.map((r, i) => h("tr", {},
      cols.map((c) => h("td", {}, c.render ? c.render(r) : inp(r, c.key, { kind: c.kind, ph: c.ph, label: `${label} ${i + 1} ${c.label}` }))),
      h("td", {}, h("button", { class: "rowx small", title: "Remove row", "aria-label": `Remove ${label} ${i + 1}`,
        onclick: () => { arr.splice(i, 1); commit(); renderSvg(); rerender(); } }, "✕"))))));
  return [t, h("button", { class: "small", onclick: () => { arr.push(make()); commit(); rerender(); } }, "Add " + label)];
}

// ------------------------------------------------------------------ editors
function editor(d, rerender) {
  const out = [];
  out.push(field("Name", inp(d, "name", { label: "Name", ph: "Device name" })));
  if (ENDPOINT.has(d.kind)) {
    out.push(h("div", { class: "row2" }, field("Address", inp(d, "address", { kind: "ip", ph: "a.b.c.d", label: "Address" })),
      field("Mask", inp(d, "mask", { kind: "mask", ph: "/nn", label: "Mask" }))));
    out.push(field("Gateway", inp(d, "gateway", { kind: "ip", ph: "a.b.c.d", label: "Gateway" })));
    if (d.kind === "vm") out.push(field("VLAN tag (blank means untagged)", inp(d, "vlanTag", { kind: "num", ph: "none", label: "VLAN tag" })));
    out.push(chk(d, "dhcp", "Gets its address by DHCP"));
    if (d.kind === "vm") {
      const hosts = doc.devices.filter((x) => x.kind === "hypervisor");
      if (hosts.length > 1) out.push(field("Runs on", h("select", { onchange: (e) => { d.host = e.target.value; commit(); renderSvg(); } },
        hosts.map((x) => h("option", { value: x.id, selected: d.host === x.id }, x.name)))));
    }
    if (d.kind === "hypervisor") {
      out.push(h("div", { class: "sec" }, "Virtual machines"));
      const v = vmsOf(d.id);
      out.push(v.length ? h("p", {}, v.map((x, i) => [i ? ", " : "", h("a", { href: "#", onclick: (e) => { e.preventDefault(); select({ type: "dev", id: x.id }); } }, x.name)]))
        : h("p", { class: "muted" }, "None yet."));
      out.push(h("button", { class: "small", onclick: () => addVM(d.id) }, "Add a virtual machine"));
    }
  }
  if (d.kind === "isp") out.push(h("div", { class: "row2" }, field("Address", inp(d, "address", { kind: "ip", ph: "a.b.c.d", label: "Address" })),
    field("Mask", inp(d, "mask", { kind: "mask", ph: "/nn", label: "Mask" }))));
  if (d.kind === "switch") {
    out.push(h("div", { class: "sec" }, "VLANs"), ...rows(d.vlans, [{ key: "id", label: "ID", kind: "num", w: "30%" }, { key: "name", label: "Name" }], () => ({ id: "", name: "" }), "VLAN", rerender));
    out.push(h("div", { class: "sec" }, "VLAN interfaces (SVIs)"), ...rows(d.svis, [{ key: "vlan", label: "VLAN", kind: "num", w: "20%" }, { key: "address", label: "Address", kind: "ip", ph: "a.b.c.d" }, { key: "mask", label: "Mask", kind: "mask", w: "20%", ph: "/nn" }], () => ({ vlan: "", address: "", mask: "" }), "SVI", rerender));
    out.push(h("div", { class: "sec" }, "Static routes"), ...rows(d.routes, [{ key: "dest", label: "Destination", kind: "cidr", ph: "a.b.c.d/nn" }, { key: "nextHop", label: "Next hop", kind: "ip", ph: "a.b.c.d" }], () => ({ dest: "", nextHop: "" }), "route", rerender));
    out.push(h("div", { class: "sec" }, "Ports"));
    out.push(h("table", { class: "t" }, h("thead", {}, h("tr", {}, ["Port", "Mode", "Untagged", "Tagged", "Off"].map((c) => h("th", {}, c)))),
      h("tbody", {}, d.ports.map((p) => h("tr", {}, h("td", { class: "n" }, p.name),
        h("td", {}, selectBox(p, "mode", ["access", "trunk"], `${p.name} mode`, "—")),
        h("td", {}, inp(p, "pvid", { kind: "num", label: `${p.name} untagged VLAN` })),
        h("td", {}, p.mode === "trunk" ? inp(p, "tagged", { kind: "list", label: `${p.name} tagged VLANs` }) : h("span", { class: "muted" }, "")),
        h("td", {}, h("input", { type: "checkbox", "aria-label": `${p.name} shut down`, checked: p.shutdown,
          onchange: (e) => { p.shutdown = e.target.checked; commit(); renderSvg(); } })))))));
    // mode changes show or hide the tagged column
    out.at(-1).querySelectorAll("select").forEach((s) => s.addEventListener("change", rerender));
    out.push(h("div", { class: "sec" }, "DHCP pools"), ...rows(d.dhcpPools, [{ key: "vlan", label: "VLAN", kind: "num", w: "16%" }, { key: "start", label: "Start", kind: "ip", ph: "a.b.c.d" }, { key: "end", label: "End", kind: "ip", ph: "a.b.c.d" }, { key: "router", label: "Router", kind: "ip", ph: "a.b.c.d" }], () => ({ vlan: "", start: "", end: "", router: "" }), "pool", rerender));
  }
  if (d.kind === "firewall") {
    out.push(h("div", { class: "sec" }, "Interfaces"));
    for (const i of d.interfaces) {
      out.push(h("div", { class: "card-b" }, h("h3", {}, i.name),
        h("div", { class: "row2" }, field("Address", inp(i, "address", { kind: "ip", ph: "a.b.c.d", label: `${i.name} address` })),
          field("Mask", inp(i, "mask", { kind: "mask", ph: "/nn", label: `${i.name} mask` }))),
        i.name === "guest Wi-Fi" ? field("SSID", inp(i, "ssid", { label: "SSID" })) : null,
        h("span", { class: "f" }, h("span", {}, "Administrative access")), multi(i, "access", ACCESS)));
    }
    out.push(h("div", { class: "sec" }, "Static routes"), ...rows(d.routes, [{ key: "dest", label: "Destination", kind: "cidr", ph: "a.b.c.d/nn" }, { key: "gateway", label: "Gateway", kind: "ip", ph: "a.b.c.d" },
      { key: "interface", label: "Interface", w: "28%", render: (r) => selectBox(r, "interface", FW_IFS, "Route interface", "—") }], () => ({ dest: "", gateway: "", interface: "" }), "route", rerender));
    out.push(h("div", { class: "sec" }, "Virtual IPs (port forwards)"), ...rows(d.vips, [{ key: "name", label: "Name" }, { key: "external", label: "External", kind: "ip", ph: "a.b.c.d" }, { key: "port", label: "Port", kind: "num", w: "16%" }, { key: "mapped", label: "Mapped to", kind: "ip", ph: "a.b.c.d" }], () => ({ name: "", external: "", port: "", mapped: "" }), "VIP", rerender));
    out.push(h("div", { class: "sec" }, "Policies"));
    d.policies.forEach((p, n) => {
      out.push(h("div", { class: "card-b" },
        h("h3", {}, h("span", {}, `Policy ${n + 1}`), h("button", { class: "small danger", onclick: () => { d.policies.splice(n, 1); commit(); renderSvg(); rerender(); } }, "Remove")),
        field("Name", inp(p, "name", { label: `Policy ${n + 1} name` })),
        h("div", { class: "row2" }, field("From", selectBox(p, "from", FW_IFS, "From interface", "—")), field("To", selectBox(p, "to", FW_IFS, "To interface", "—"))),
        h("div", { class: "row2" }, field("Source (blank is any)", inp(p, "source", { kind: "cidr", ph: "any", label: "Source" })), field("Destination (blank is any)", inp(p, "dest", { kind: "cidr", ph: "any", label: "Destination" }))),
        h("span", { class: "f" }, h("span", {}, "Services")), multi(p, "services", SERVICES),
        h("div", { class: "checks" }, chk(p, "nat", "NAT"), chk(p, "log", "Logging"))));
    });
    out.push(h("button", { class: "small", onclick: () => { d.policies.push({ name: "", from: "", to: "", source: "", dest: "", services: [], nat: false, log: false }); commit(); rerender(); } }, "Add policy"));
  }
  return out;
}
function linkEditor(l) {
  const A = dev(l.a.device), B = dev(l.b.device);
  const end = (e, D) => {
    const ports = portsFor(D);
    if (!ports.length) return h("p", {}, h("b", {}, D.name), h("span", { class: "muted" }, " (one network port)"));
    const used = new Set(doc.links.filter((x) => x !== l).flatMap((x) => [x.a, x.b]).filter((x) => x.device === D.id).map((x) => x.port));
    return field(D.name + (D.kind === "firewall" ? " interface" : " port"), h("select", { onchange: (ev) => { e.port = ev.target.value; commit(); renderSvg(); } },
      h("option", { value: "" }, "Choose…"), ports.map((p) => h("option", { value: p, selected: e.port === p }, p + (used.has(p) ? "  (already used)" : "")))));
  };
  return [end(l.a, A), end(l.b, B),
    h("p", { class: "muted" }, "A guest Wi-Fi link is drawn dashed. Switch port settings are edited on the switch.")];
}

function addVM(hostId) {
  const host = hostId || doc.devices.find((x) => x.kind === "hypervisor")?.id;
  if (!host) { toast("Add a hypervisor first."); return; }
  const v = { id: newId("vm"), kind: "vm", host, name: "New VM", ...ep(), vlanTag: "" };
  doc.devices.push(v); commit(); select({ type: "dev", id: v.id });
  setTimeout(() => panel.querySelector("input")?.select(), 0);
}
function addDevice(kind) {
  const d = { id: newId("d"), kind, name: "Laptop " + (doc.devices.filter((x) => x.kind === "laptop").length + 1), x: 0, y: 0, ...ep() };
  doc.devices.push(d); commit(); select({ type: "dev", id: d.id });
  setTimeout(() => panel.querySelector("input")?.select(), 0);
}
function removeDevice(d) {
  ask("Delete " + d.name + "?", [h("p", {}, d.kind === "hypervisor" && vmsOf(d.id).length ? "This also deletes its virtual machines and every cable connected to it." : "This also deletes every cable connected to it."), h("p", { class: "muted" }, "You can undo this.")],
    [["Cancel"], ["Delete", () => {
      const gone = new Set([d.id, ...vmsOf(d.id).map((v) => v.id)]);
      doc.devices = doc.devices.filter((x) => !gone.has(x.id));
      doc.links = doc.links.filter((l) => !gone.has(l.a.device) && !gone.has(l.b.device));
      commit(); select(null);
    }, "danger"]]);
}

// What to record, lab by lab. Mirrors the "Update your network diagram" box on each Cyber Hub page. No values.
const WHEN = [
  ["Cyber Hub 00", "Open the app, type your company name, copy the share link and paste it on your Team Log cover page."],
  ["Cyber Hub 02", "ISP router address, firewall interface addresses and static routes, and the ISP router to wan1 cable."],
  ["Cyber Hub 03", "Firewall policies, virtual IPs and administrative access; the guest Wi-Fi interface, its SSID and the guest laptop."],
  ["Cyber Hub 04", "The switch's VLANs, VLAN interfaces (SVIs) and static route."],
  ["Cyber Hub 05", "Every switch port's settings, the DHCP pools, the firewall to switch cables, and your laptop's cable."],
  ["Cyber Hub 06", "The NAS: address, gateway and its cable."],
  ["Cyber Hub 07", "The hypervisor: address, gateway and its cable."],
  ["Cyber Hub 08", "The web server VM, and the ISP-side laptop with its cable."],
  ["Cyber Hub 09", "The FTP server VM."],
  ["Cyber Hub 10", "The scanner VM and its firewall policy."],
  ["Cyber Hub 11", "The vulnerable Pi: address and its cable."],
  ["Cyber Hub 13", "Every fix you made. Then export a PNG for your SSP."],
];
const whenList = () => h("ol", { class: "when" }, WHEN.map(([k, v]) => h("li", {}, h("b", {}, k + ": "), v)));
function help() {
  ask("How to use the Network Diagram", [
    h("p", {}, "Your team records the network it has built on the rack: every cable, address, VLAN, route and policy. Each Cyber Hub page has an \u201cUpdate your network diagram\u201d box that says what to add."),
    h("div", { class: "sec" }, "Record a cable"),
    h("p", {}, "Drag from a switch port, a firewall interface tab or any device, and drop it on the device at the other end. Dropping on a port records that port too."),
    h("div", { class: "sec" }, "Enter settings"),
    h("p", {}, "Select a device to fill in its settings. List view shows everything as forms, which is faster for the switch ports."),
    h("div", { class: "sec" }, "Save and share"),
    h("p", {}, "The diagram saves in this browser, but the share link is the real save. After each update, choose Copy share link and paste it on your Team Log cover page, replacing the old one. Export PNG makes the image for your SSP."),
    h("div", { class: "sec" }, "When to update it"), whenList(),
    h("p", { class: "muted" }, "Record only what you have built. The app never checks your work against the right answers: test on the rack."),
  ], [["Close"]]);
}

function renderPanel() {
  const top = panel.scrollTop;
  const s = findSel();
  const kids = [];
  if (!s) {
    kids.push(h("h2", {}, "Your network diagram"),
      h("p", {}, "Record what your team has built on the rack: every cable, address, VLAN, route and policy. Update it at the end of every lab."),
      h("p", {}, "Select a device to enter its settings. To record a cable, drag from a switch port, a firewall interface or any device to the device on the other end."),
      h("div", { class: "sec" }, "Add"),
      h("div", { class: "add" }, h("button", { onclick: () => addVM() }, "Virtual machine"), h("button", { onclick: () => addDevice("laptop") }, "Laptop")),
      h("div", { class: "sec" }, "When to update it"), whenList(),
      h("p", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); help(); } }, "How to use the Network Diagram")),
      h("div", { class: "sec" }, "Summary"),
      h("p", { class: "muted" }, `${doc.devices.filter((d) => d.kind !== "vm").length} devices, ${doc.devices.filter((d) => d.kind === "vm").length} virtual machines, ${doc.links.length} cables.`));
  } else if (sel.type === "dev") {
    kids.push(h("h2", {}, s.name || KINDS[s.kind]), h("p", { class: "kind" }, KINDS[s.kind] + (s.kind === "vm" ? " on " + (dev(s.host)?.name || "?") : "")));
    kids.push(...editor(s, renderPanel));
    kids.push(h("div", { class: "foot" },
      s.kind !== "vm" ? h("button", { onclick: () => { const g = svg.querySelector(`[data-dev="${s.id}"] .handle`); toast("Drag from a switch port, a firewall interface or the device itself to the other end. You can also use List view."); g?.focus?.(); } }, "How do I connect it?") : null,
      removable(s) ? h("button", { class: "danger", onclick: () => removeDevice(s) }, "Delete " + (s.kind === "vm" ? "VM" : "laptop")) : null));
  } else {
    kids.push(h("h2", {}, "Cable"), h("p", { class: "kind" }, `${dev(s.a.device)?.name} to ${dev(s.b.device)?.name}`));
    kids.push(...linkEditor(s));
    kids.push(h("div", { class: "foot" }, h("button", { class: "danger", onclick: () => { doc.links = doc.links.filter((x) => x !== s); commit(); select(null); } }, "Delete cable")));
  }
  panel.replaceChildren(...kids);
  panel.scrollTop = top;
}

// ------------------------------------------------------------------ list view
function renderList() {
  const top = listView.scrollTop;
  const cards = [];
  const real = doc.devices.filter((d) => d.kind !== "vm");
  for (const d of real) {
    cards.push(h("div", { class: "card-b" }, h("h3", {}, h("span", {}, d.name), h("span", { class: "muted", style: "font-weight:400;font-size:12px" }, KINDS[d.kind])), ...editor(d, renderList),
      removable(d) ? h("button", { class: "small danger", onclick: () => removeDevice(d) }, "Delete laptop") : null));
    for (const v of vmsOf(d.id)) cards.push(h("div", { class: "card-b" }, h("h3", {}, h("span", {}, v.name), h("span", { class: "muted", style: "font-weight:400;font-size:12px" }, "VM on " + d.name)), ...editor(v, renderList),
      h("button", { class: "small danger", onclick: () => removeDevice(v) }, "Delete VM")));
  }
  const opt = (sid, cur) => real.map((d) => h("option", { value: d.id, selected: cur === d.id }, d.name));
  const portSel = (end) => {
    const D = dev(end.device), ports = portsFor(D);
    if (!ports.length) return h("span", { class: "muted" }, "—");
    return h("select", { "aria-label": "Port", onchange: (e) => { end.port = e.target.value; commit(); renderSvg(); } }, h("option", { value: "" }, "Choose…"), ports.map((p) => h("option", { value: p, selected: end.port === p }, p)));
  };
  const devSel = (end) => h("select", { "aria-label": "Device", onchange: (e) => { end.device = e.target.value; end.port = ""; commit(); renderSvg(); renderList(); } }, opt(end.device, end.device));
  const links = h("div", { class: "card-b", style: "grid-column:1/-1" }, h("h3", {}, "Cables"),
    h("table", { class: "t" }, h("thead", {}, h("tr", {}, ["Device", "Port", "Device", "Port", ""].map((c) => h("th", {}, c)))),
      h("tbody", {}, doc.links.map((l, i) => h("tr", {}, h("td", {}, devSel(l.a)), h("td", {}, portSel(l.a)), h("td", {}, devSel(l.b)), h("td", {}, portSel(l.b)),
        h("td", {}, h("button", { class: "rowx small", "aria-label": `Remove cable ${i + 1}`, onclick: () => { doc.links.splice(i, 1); commit(); renderSvg(); renderList(); } }, "✕")))))),
    h("button", { class: "small", onclick: () => { if (real.length < 2) return; doc.links.push({ id: newId("l"), a: { device: real[0].id, port: "" }, b: { device: real[1].id, port: "" } }); commit(); renderSvg(); renderList(); } }, "Add cable"));
  listView.replaceChildren(h("h2", {}, "Everything on the diagram"),
    h("p", { class: "muted" }, "The same information as the diagram, as forms. Changes here show on the diagram right away."),
    h("div", { class: "add" }, h("button", { class: "small", onclick: () => { addVM(); setView("list"); } }, "Add a virtual machine"), h("button", { class: "small", onclick: () => { addDevice("laptop"); setView("list"); } }, "Add a laptop")),
    h("div", { class: "grid" }, links, ...cards));
  listView.scrollTop = top;
}
let view = "canvas";
function setView(v) {
  view = v;
  $("t-canvas").setAttribute("aria-selected", v === "canvas"); $("t-list").setAttribute("aria-selected", v === "list");
  $("v-canvas").hidden = v !== "canvas"; panel.hidden = v !== "canvas"; listView.hidden = v !== "list";
  if (v === "list") renderList(); else { renderSvg(); renderPanel(); }
}
function renderAll() { $("company").value = doc.meta.company || ""; renderSvg(); if (view === "list") renderList(); else renderPanel(); }

// ------------------------------------------------------------------ share links
const b64u = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pipe(bytes, Stream, fmt) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(fmt))).arrayBuffer()); }
async function encode(o) {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  if (typeof CompressionStream === "function") { try { return "z." + b64u(await pipe(bytes, CompressionStream, "deflate-raw")); } catch {} }
  return "j." + b64u(bytes);
}
async function decode(s) {
  const [k, data] = [s.slice(0, 2), s.slice(2)];
  let bytes = unb64u(data);
  if (k === "z.") bytes = await pipe(bytes, DecompressionStream, "deflate-raw");
  else if (k !== "j.") throw new Error("unknown link");
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function share() {
  const url = location.origin + location.pathname + "#d=" + await encode(doc);
  sharedJSON = snapshot(); updateButtons();
  try { await navigator.clipboard.writeText(url); toast("Share link copied. Paste it on your Team Log cover page."); }
  catch {
    ask("Copy your share link", [h("p", {}, "Select the link and copy it, then paste it on your Team Log cover page."), h("textarea", { readonly: true, value: url, onfocus: (e) => e.target.select() })], [["Done"]]);
    setTimeout(() => $("m-body").querySelector("textarea")?.select(), 0);
  }
}

// ------------------------------------------------------------------ export
function contentBox() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of doc.devices) { if (d.kind === "vm") continue; const { w, h } = boxSize(d); x0 = Math.min(x0, d.x); y0 = Math.min(y0, d.y); x1 = Math.max(x1, d.x + w); y1 = Math.max(y1, d.y + h); }
  if (x0 === Infinity) return { x: 0, y: 0, w: VB.w, h: VB.h };
  const pad = 40; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(VB.w, x1 + pad); y1 = Math.min(VB.h, y1 + pad);
  return { x: x0, y: y0, w: Math.max(640, x1 - x0), h: y1 - y0 };
}
async function exportPng() {
  const B = contentBox(), W = B.w, HD = 70, H = B.h + HD;
  const out = document.createElementNS(NS, "svg");
  out.setAttribute("xmlns", NS); out.setAttribute("width", W); out.setAttribute("height", H); out.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
    .map((r) => r.cssText).filter((t) => /^\.d-/.test(t)).join("\n").replace(/var\(--navy\)/g, "#003366");
  el("style", {}, out).textContent = css;
  el("rect", { width: W, height: H, fill: "#ffffff" }, out);
  text(out, 30, 34, "d-title", (doc.meta.company || "Company") + " network diagram");
  text(out, 30, 54, "d-sub", "Updated " + new Date(doc.meta.updated || Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
  const g = el("g", { transform: `translate(${-B.x},${HD - B.y})` }, out);
  drawInto(g, false);
  const src = new XMLSerializer().serializeToString(out);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2;
    const ctx = c.getContext("2d"); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    download(blob, fileBase() + ".png");
    toast("PNG downloaded. Paste it into your Team Log or SSP.");
  } catch { toast("This browser couldn't make the PNG. Try Print, then Save as PDF."); }
  finally { URL.revokeObjectURL(url); }
}
const fileBase = () => ((doc.meta.company || "network").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "network") + "-diagram-" + new Date().toISOString().slice(0, 10);
function download(blob, name) { const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

// ------------------------------------------------------------------ small UI
let toastT;
function toast(s) { const t = $("toast"); t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3800); }
function ask(title, body, buttons) {
  const m = $("modal"), prev = document.activeElement;
  $("m-title").textContent = title; $("m-body").replaceChildren(...body);
  const close = () => { m.hidden = true; prev?.focus?.(); };
  $("m-acts").replaceChildren(...buttons.map(([label, fn, cls]) => h("button", { class: cls || (fn ? "primary" : ""), onclick: () => { close(); fn?.(); } }, label)));
  m.hidden = false; $("m-acts").lastChild?.focus({ preventScroll: true }); m.querySelector(".card").scrollTop = 0;
  m.onkeydown = (e) => { if (e.key === "Escape") close(); };
}
function load(o, why) {
  doc = normalize(o); sel = null; hist = []; hi = -1; commit(); renderAll(); if (why) toast(why);
}

// ------------------------------------------------------------------ wiring
$("t-canvas").onclick = () => setView("canvas");
$("t-list").onclick = () => setView("list");
$("b-undo").onclick = undo; $("b-redo").onclick = redo;
$("b-help").onclick = help;
$("b-share").onclick = share; $("b-png").onclick = exportPng;
const more = $("more");
$("b-more").onclick = (e) => { e.stopPropagation(); more.hidden = !more.hidden; $("b-more").setAttribute("aria-expanded", !more.hidden); };
document.addEventListener("click", () => { more.hidden = true; $("b-more").setAttribute("aria-expanded", false); });
$("b-json").onclick = () => download(new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" }), fileBase() + ".json");
$("b-open").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try { const o = JSON.parse(await f.text()); ask("Open " + f.name + "?", [h("p", {}, "This replaces the diagram on screen. Copy its share link first if you want to keep it.")], [["Cancel"], ["Open", () => load(o, "Opened " + f.name)]]); }
  catch { toast("That file isn't a diagram backup."); }
};
$("b-print").onclick = () => { setView("canvas"); setTimeout(() => print(), 50); };
$("b-reset").onclick = () => ask("Reset the diagram?", [h("p", {}, "This clears every cable, address and setting and leaves the devices empty. Copy the share link first if you want to keep this version."), h("p", { class: "muted" }, "You can undo this.")],
  [["Cancel"], ["Reset", () => { const co = doc.meta.company; doc = blankDoc(); doc.meta.company = co; sel = null; sharedJSON = null; commit(); renderAll(); }, "danger"]]);
$("company").addEventListener("input", (e) => { doc.meta.company = e.target.value; });
$("company").addEventListener("change", commit);
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input,textarea,select")) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
  if (e.key === "Escape" && sel) select(null);
});
window.addEventListener("hashchange", () => start());

async function start() {
  let local = null;
  try { const s = localStorage.getItem(KEY); if (s) local = normalize(JSON.parse(s)); } catch {}
  const m = location.hash.match(/^#d=(.+)$/);
  if (m) {
    let linked;
    try { linked = normalize(await decode(m[1])); } catch { history.replaceState(null, "", location.pathname + location.search); toast("That share link is incomplete or damaged."); }
    if (linked) {
      history.replaceState(null, "", location.pathname + location.search);
      sharedJSON = JSON.stringify(linked);
      const differs = local && contentOf(JSON.stringify(local)) !== contentOf(JSON.stringify(linked));
      const localHasWork = local && (local.links.length || local.devices.some((d) => d.address || d.svis?.length || d.interfaces?.some((i) => i.address) || d.kind === "vm"));
      if (differs && localHasWork) {
        doc = local; renderAll(); commit();
        ask("Which diagram do you want?", [h("p", {}, "This browser already holds a different diagram" + (local.meta.company ? ` (${local.meta.company})` : "") + "."),
          h("p", {}, "Opening the link replaces it. If you need the one in this browser, cancel and copy its share link first.")],
          [["Keep this browser's diagram", () => { sharedJSON = null; updateButtons(); }], ["Open the link", () => { load(linked, "Opened the shared diagram."); sharedJSON = snapshot(); updateButtons(); }]]);
        return;
      }
      load(linked, "Opened the shared diagram."); sharedJSON = snapshot(); updateButtons();
      return;
    }
  }
  doc = local || blankDoc(); sel = null; hist = []; hi = -1; commit(); renderAll();
}
start();
})();
