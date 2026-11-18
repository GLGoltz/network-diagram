// Network Diagram app: record, save, share, export.
//
// Hard rule (DIAGRAM_APP_SPEC.md, section 2): this file holds no rack plan. No expected addresses, VLANs,
// port assignments, routes or policies. Everything drawn comes from what the team typed. The only built-in
// facts are the devices in the rack, the switch's port names and the firewall's interface names, which
// students already have on the reference pages.
"use strict";
(() => {
const SCHEMA = 2;
const KEY = "cyberhub-diagram";
const LOGO_MAX = 40000; // characters of data URL; the logo rides in the share link, so it stays small
const VB = { w: 1540, h: 900 };
const SW_PORTS = ["XG1","XG2","XG3","XG4","XG5","XG6","XG7","XG8","XG9","XG10","XG11","XG12","OOB"];
const FW_IFS = ["wan1", "internal", "dmz", "guest Wi-Fi"];
const SERVICES = ["ALL", "PING", "HTTP", "HTTPS", "SSH", "FTP", "DNS"];
const KINDS = {
  isp: "Provider", firewall: "Firewall", switch: "Switch", hypervisor: "Hypervisor", nas: "NAS",
  pi: "Raspberry Pi", laptop: "Laptop", vm: "Virtual machine",
};
const ENDPOINT = new Set(["hypervisor", "nas", "pi", "laptop", "vm"]);

const $ = (id) => document.getElementById(id);
const svg = $("svg"), panel = $("panel"), tableView = $("v-table");
const NS = "http://www.w3.org/2000/svg";

// ------------------------------------------------------------------ document
// Every rack has the same devices, so the set is fixed: nothing is added, deleted or moved.
let uid = 0;
const newId = (p) => p + Date.now().toString(36) + (uid++).toString(36);
const ep = () => ({ hostname: "", address: "", mask: "", gateway: "", dhcp: false });
const vm = (id, name) => ({ id, kind: "vm", host: "hv", name, ...ep(), vlanTag: "" });
function blankDoc() {
  return {
    v: SCHEMA, meta: { company: "", updated: null },
    devices: [
      { id: "isp", kind: "isp", name: "Provider (instructor rack)", address: "", mask: "" },
      { id: "isplap", kind: "laptop", name: "Internet laptop", ...ep() },
      { id: "fw", kind: "firewall", name: "Firewall", hostname: "",
        interfaces: FW_IFS.map((n) => ({ name: n, address: "", mask: "", ...(n === "guest Wi-Fi" ? { ssid: "" } : {}) })),
        routes: [], vips: [], policies: [] },
      { id: "guest", kind: "laptop", name: "Guest laptop", ...ep() },
      { id: "sw", kind: "switch", name: "Core switch", hostname: "", oob: { address: "", mask: "" }, svis: [], routes: [], dhcpPools: [],
        ports: SW_PORTS.map((n) => ({ name: n, mode: "", pvid: "", tagged: [], shutdown: false })) },
      { id: "hv", kind: "hypervisor", name: "Hypervisor", ...ep() },
      vm("vmweb", "Web server"), vm("vmftp", "FTP server"), vm("vmscan", "Scanner"),
      { id: "nas", kind: "nas", name: "NAS", ...ep() },
      { id: "admin", kind: "laptop", name: "Admin laptop", ...ep() },
      { id: "pi", kind: "pi", name: "Vulnerable Pi", ...ep() },
      { id: "lap", kind: "laptop", name: "Team laptop", ...ep() },
    ],
    links: [],
  };
}
let doc = blankDoc();
const dev = (id) => doc.devices.find((d) => d.id === id);
const vmsOf = (id) => doc.devices.filter((d) => d.kind === "vm" && d.host === id);
const ISP_PORTS = ["Uplink", "Internet Wi-Fi"];
// The one network port on each single-port device, named as the device names it
const NIC = { hv: "NIC 1", nas: "LAN 1", pi: "eth0", admin: "Ethernet", lap: "Ethernet", isplap: "Wi-Fi", guest: "Wi-Fi" };
const portsFor = (d) => d.kind === "switch" ? SW_PORTS : d.kind === "firewall" ? FW_IFS : d.kind === "isp" ? ISP_PORTS : [];
const nicOf = (d) => NIC[d.id] || "NIC";

// Bring an older or hand-edited document into the fixed device set, keeping what the team entered.
function normalize(x) {
  if (!x || typeof x !== "object" || !Array.isArray(x.devices)) throw new Error("not a diagram");
  const d = blankDoc();
  const logo = typeof x.meta?.logo === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(x.meta.logo) && x.meta.logo.length <= LOGO_MAX ? x.meta.logo : "";
  d.meta = { company: String(x.meta?.company ?? ""), updated: x.meta?.updated ?? null, ...(logo ? { logo } : {}) };
  const old = new Map(x.devices.filter((v) => v && v.id).map((v) => [String(v.id), v]));
  d.devices = d.devices.map((base) => {
    const v = old.get(base.id);
    if (!v || v.kind !== base.kind) return base;
    const o = { ...base };
    o.name = String(v.name || base.name);
    for (const k of ["hostname", "address", "mask", "gateway", "vlanTag"]) if (k in base && v[k] != null) o[k] = String(v[k]);
    if ("dhcp" in base) o.dhcp = !!v.dhcp;
    if (base.kind === "switch") {
      for (const k of ["svis", "routes", "dhcpPools"]) o[k] = Array.isArray(v[k]) ? v[k] : [];
      o.oob = { address: String(v.oob?.address || ""), mask: String(v.oob?.mask || "") };
      const have = new Map((v.ports || []).map((p) => [p.name, p]));
      o.ports = base.ports.map((p) => { const q = have.get(p.name) || {}; return { ...p, mode: q.mode || "", pvid: String(q.pvid || ""), tagged: Array.isArray(q.tagged) ? q.tagged : [], shutdown: !!q.shutdown }; });
    }
    if (base.kind === "firewall") {
      for (const k of ["routes", "vips", "policies"]) o[k] = Array.isArray(v[k]) ? v[k] : [];
      const have = new Map((v.interfaces || []).map((p) => [p.name, p]));
      o.interfaces = base.interfaces.map((i) => { const q = have.get(i.name) || {}; return { ...i, address: q.address || "", mask: q.mask || "", ...("ssid" in i ? { ssid: q.ssid || "" } : {}) }; });
    }
    return o;
  });
  const ids = new Set(d.devices.filter((v) => v.kind !== "vm").map((v) => v.id));
  d.links = (Array.isArray(x.links) ? x.links : []).filter((l) => l && ids.has(l.a?.device) && ids.has(l.b?.device) && l.a.device !== l.b.device)
    .map((l) => {
      // Saves from before the instructor-rack upstream used LAN, LAN 1 and LAN 2 on the ISP router.
      const OLD = { "LAN 1": "Uplink", "LAN 2": "Internet Wi-Fi", "Internet": "Internet Wi-Fi" };
      const fix = (e, o) => ({ device: e.device, port: e.device === "isp" ? (OLD[e.port] || (ISP_PORTS.includes(e.port) ? e.port : o.device === "fw" ? "Uplink" : "Internet Wi-Fi")) : String(e.port || "") });
      return { id: String(l.id || newId("l")), a: fix(l.a, l.b), b: fix(l.b, l.a) };
    });
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
  const s = $("saved");
  s.classList.toggle("warn", saveFailed);
  s.textContent = saveFailed ? "Not saved: this browser blocks storage. Copy the share link to keep your work."
    : "Saved in this browser at " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function updateButtons() {
  $("b-undo").disabled = hi <= 0; $("b-redo").disabled = hi >= hist.length - 1;
  $("b-share").querySelector(".dot").hidden = sharedJSON === null ? !hasContent() : contentOf(sharedJSON) === contentOf(snapshot());
}
function restore(j) { doc = JSON.parse(j); doc.meta.updated = new Date().toISOString(); save(); if (sel && !findSel()) sel = null; renderAll(); updateButtons(); }
const undo = () => { if (hi > 0) restore(hist[--hi]); };
const redo = () => { if (hi < hist.length - 1) restore(hist[++hi]); };
const hasContent = (o = doc) => o.links.length > 0 || o.devices.some((d) => d.address || d.gateway || d.dhcp || d.svis?.length ||
  d.interfaces?.some((i) => i.address) || d.oob?.address || d.ports?.some((p) => p.mode || p.shutdown) || d.policies?.length);

// ------------------------------------------------------------------ selection
let sel = null; // {type:'dev'|'link', id}
const findSel = () => sel && (sel.type === "dev" ? dev(sel.id) : doc.links.find((l) => l.id === sel.id));
function select(s) { sel = s; renderSvg(); renderPanel(); }

// ------------------------------------------------------------------ drawing
// The layout follows the lab's traffic path, top to bottom: provider, firewall, core switch, then the hosts.
// The switch and firewall are drawn with their real ports, and cables plug into the port they were recorded on.
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
    if (d.oob?.address) L.push(`OOB ${withPrefix(d.oob.address, d.oob.mask)}`);
    const s = d.svis.filter((v) => v.address || v.vlan);
    s.slice(0, 6).forEach((v) => L.push(`VLAN ${v.vlan || "?"} ${withPrefix(v.address, v.mask)}`.trim()));
    if (s.length > 6) L.push(`+${s.length - 6} more VLAN interfaces`);
    d.routes.filter((r) => r.dest).slice(0, 2).forEach((r) => L.push(`${r.dest} via ${r.nextHop || "?"}`));
    if (d.routes.length > 2) L.push(`+${d.routes.length - 2} more routes`);
  } else if (ENDPOINT.has(d.kind)) {
    if (d.hostname && d.kind !== "vm") L.push(d.hostname);
    if (d.address) L.push(withPrefix(d.address, d.mask)); else if (d.dhcp) L.push("DHCP");
    if (d.gateway) L.push("gw " + d.gateway);
  }
  return L;
}

// Geometry
const VM_H = 42, PORT_W = 60, PORT_H = 54, PITCH = 66, OOB_GAP = 16, TAB_W = 64, TAB_H = 22;
const SW_TEXT_W = 270, SW_W = 20 + 12 * PITCH + OOB_GAP + PORT_W + 26 + SW_TEXT_W;
const HOST_W = 260, HOST_PITCH = 290, FW_W = 400, SIDE_W = 260;
const HOSTS = ["hv", "nas", "admin", "pi", "lap"];
function boxSize(d) {
  const lines = valueLines(d).length;
  if (d.kind === "switch") return { w: SW_W, h: Math.max(130, 46 + lines * 19) };
  if (d.kind === "firewall") return { w: FW_W, h: Math.max(110, 66 + lines * 19) };
  let h = 42 + lines * 19 + (lines ? 8 : 0);
  if (d.kind === "hypervisor") h += vmsOf(d.id).length * (VM_H + 6) + 6;
  return { w: d.kind === "isp" ? FW_W : d.id === "isplap" || d.id === "guest" ? SIDE_W : HOST_W, h: Math.max(h, 80) };
}
const rectOf = (d) => { const { w, h } = boxSize(d); return { x: d.x, y: d.y, w, h }; };
const center = (d) => { const r = rectOf(d); return [r.x + r.w / 2, r.y + r.h / 2]; };
function portRect(sw, name) {
  const i = SW_PORTS.indexOf(name);
  if (i < 0) return null;
  const { h } = boxSize(sw);
  const x = sw.x + 20 + i * PITCH + (name === "OOB" ? OOB_GAP : 0);
  return { x, y: sw.y + (h - PORT_H) / 2, w: PORT_W, h: PORT_H, cx: x + PORT_W / 2 };
}
// Firewall interface tabs and the provider's Uplink and Internet Wi-Fi tabs sit on the box edges
function tabRect(d, name) {
  const { w, h } = boxSize(d);
  if (d.kind === "isp") {
    if (name === "Uplink") return { x: d.x + 30, y: d.y + h - TAB_H / 2, w: TAB_W, h: TAB_H, side: "bottom" };
    if (name === "Internet Wi-Fi") return { x: d.x + w - 50, y: d.y + h / 2 - TAB_H / 2, w: 100, h: TAB_H, side: "right" };
    return null;
  }
  if (ENDPOINT.has(d.kind) && d.kind !== "vm") {
    const tw = 74;
    if (d.id === "isplap" || d.id === "guest") return { x: d.x - tw + 32, y: d.y + h / 2 - TAB_H / 2, w: tw, h: TAB_H, side: "left" };
    return { x: d.x + w / 2 - tw / 2, y: d.y - TAB_H / 2, w: tw, h: TAB_H, side: "top" };
  }
  if (d.kind !== "firewall") return null;
  if (name === "wan1") return { x: d.x + 30, y: d.y - TAB_H / 2, w: TAB_W, h: TAB_H, side: "top" };
  if (name === "internal") return { x: d.x + 30, y: d.y + h - TAB_H / 2, w: TAB_W, h: TAB_H, side: "bottom" };
  if (name === "dmz") return { x: d.x + 30 + PITCH, y: d.y + h - TAB_H / 2, w: TAB_W, h: TAB_H, side: "bottom" };
  if (name === "guest Wi-Fi") return { x: d.x + w - 45, y: d.y + h / 2 - TAB_H / 2, w: 90, h: TAB_H, side: "right" };
  return null;
}

function layout() {
  const SWX = 60, put = (id, x, y) => { const d = dev(id); if (d) { d.x = x; d.y = y; } };
  const isp = dev("isp"), fw = dev("fw"), sw = dev("sw");
  put("isp", SWX - 12, 30);
  put("fw", SWX - 12, isp.y + boxSize(isp).h + 80);
  const besides = (id, ref) => { const d = dev(id); d.x = ref.x + boxSize(ref).w + 190; d.y = ref.y + (boxSize(ref).h - boxSize(d).h) / 2; };
  besides("isplap", isp); besides("guest", fw);
  put("sw", SWX, fw.y + boxSize(fw).h + 90);
  HOSTS.forEach((id, i) => put(id, SWX + i * HOST_PITCH, 0));
  routeAll();
}

// ------------------------------------------------------------------ cable routing
// Each cable leaves its port straight out, then runs at right angles around every box. Cables from the switch down
// to the hosts get their own horizontal lane, so they never overlap.
let routes = new Map(); // link id -> {pts, ends:[anchor, anchor]}
function anchor(d, port, other) {
  const r = rectOf(d), [ox, oy] = center(other);
  if (d.kind === "switch") {
    const pr = portRect(d, port);
    if (pr) return oy < d.y ? { x: pr.cx, y: pr.y, side: "top", inner: d.y, port: true } : { x: pr.cx, y: pr.y + pr.h, side: "bottom", inner: d.y + r.h, port: true };
  }
  const t = tabRect(d, portsFor(d).length ? port : nicOf(d));
  if (t) {
    if (t.side === "top") return { x: t.x + t.w / 2, y: t.y, side: "top", port: true };
    if (t.side === "bottom") return { x: t.x + t.w / 2, y: t.y + t.h, side: "bottom", port: true };
    if (t.side === "left") return { x: t.x, y: t.y + t.h / 2, side: "left", port: true };
    return { x: t.x + t.w, y: t.y + t.h / 2, side: "right", port: true };
  }
  if (oy < r.y) return { x: r.x + r.w / 2, y: r.y, side: "top" };
  if (oy > r.y + r.h) return { x: r.x + r.w / 2, y: r.y + r.h, side: "bottom" };
  return ox < r.x ? { x: r.x, y: r.y + r.h / 2, side: "left" } : { x: r.x + r.w, y: r.y + r.h / 2, side: "right" };
}
const DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const STUB = 18, CLEAR = 12;
// The point where a cable has left its device: past the box edge (a switch port's cable crosses the switch's face first)
function stubEnd(a) {
  const [dx, dy] = DIR[a.side];
  if (a.inner !== undefined) return { x: a.x, y: a.inner + dy * STUB };
  return { x: a.x + dx * STUB, y: a.y + dy * STUB };
}
function blocks() {
  return doc.devices.filter((d) => d.kind !== "vm").map((d) => { const r = rectOf(d); return { x0: r.x - CLEAR, y0: r.y - CLEAR, x1: r.x + r.w + CLEAR, y1: r.y + r.h + CLEAR }; });
}
const segHits = (ax, ay, bx, by, b) => {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  return x0 < b.x1 - 0.5 && x1 > b.x0 + 0.5 && y0 < b.y1 - 0.5 && y1 > b.y0 + 0.5;
};
// Shortest right-angle path between two free points, avoiding the boxes, preferring few bends.
function astar(s, t, sDir, B) {
  const xs = [...new Set([s.x, t.x, 8, VB.w - 8, ...B.flatMap((b) => [b.x0, b.x1])].map((v) => Math.round(v)))].sort((a, b) => a - b);
  const ys = [...new Set([s.y, t.y, 8, VB.h - 8, ...B.flatMap((b) => [b.y0, b.y1])].map((v) => Math.round(v)))].sort((a, b) => a - b);
  const inside = (x, y) => B.some((b) => x > b.x0 + 0.5 && x < b.x1 - 0.5 && y > b.y0 + 0.5 && y < b.y1 - 0.5);
  const key = (i, j, d) => (i * ys.length + j) * 4 + d;
  const si = xs.indexOf(Math.round(s.x)), sj = ys.indexOf(Math.round(s.y)), ti = xs.indexOf(Math.round(t.x)), tj = ys.indexOf(Math.round(t.y));
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const startD = D4.findIndex(([a, b]) => a === sDir[0] && b === sDir[1]);
  const dist = new Map(), prev = new Map(), heap = [];
  const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const k0 = key(si, sj, startD < 0 ? 0 : startD); dist.set(k0, 0); push(0, k0);
  while (heap.length) {
    const [c, k] = pop();
    if (c > (dist.get(k) ?? Infinity)) continue;
    const d = k % 4, ij = (k - d) / 4, i = Math.floor(ij / ys.length), j = ij % ys.length;
    if (i === ti && j === tj) {
      const pts = []; let cur = k;
      while (cur !== undefined) { const cd = cur % 4, cij = (cur - cd) / 4; pts.push({ x: xs[Math.floor(cij / ys.length)], y: ys[cij % ys.length] }); cur = prev.get(cur); }
      return pts.reverse();
    }
    D4.forEach(([dx, dy], nd) => {
      if (dx === -D4[d][0] && dy === -D4[d][1]) return;
      const ni = i + dx, nj = j + dy;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) return;
      const ax = xs[i], ay = ys[j], bx = xs[ni], by = ys[nj];
      if (inside(bx, by) || B.some((b) => segHits(ax, ay, bx, by, b))) return;
      const nc = c + Math.abs(bx - ax) + Math.abs(by - ay) + (nd !== d ? 40 : 0);
      const nk = key(ni, nj, nd);
      if (nc < (dist.get(nk) ?? Infinity)) { dist.set(nk, nc); prev.set(nk, k); push(nc, nk); }
    });
  }
  return [s, { x: s.x, y: t.y }, t];
}
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && Math.abs(out.at(-1).x - p.x) < 0.5 && Math.abs(out.at(-1).y - p.y) < 0.5) continue;
    if (out.length >= 2) { const a = out.at(-2), b = out.at(-1); if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5)) out.pop(); }
    out.push(p);
  }
  return out;
}
function routeAll() {
  routes = new Map();
  const sw = dev("sw"), swR = rectOf(sw), hostSet = new Set(HOSTS);
  // 1. Hosts row: below the switch, leaving room for one lane per crossing cable.
  const down = [];
  for (const l of doc.links) {
    const [s, o] = l.a.device === "sw" ? [l.a, l.b] : l.b.device === "sw" ? [l.b, l.a] : [null, null];
    if (!s || !hostSet.has(o.device)) continue;
    const pr = portRect(sw, s.port), od = dev(o.device);
    const from = pr ? pr.cx : swR.x + swR.w / 2, to = od.x + HOST_W / 2;
    down.push({ l, from, to, lo: Math.min(from, to), hi: Math.max(from, to), left: to < from });
  }
  const order = [...down.filter((c) => c.left).sort((a, b) => a.to - b.to), ...down.filter((c) => !c.left).sort((a, b) => b.to - a.to)];
  const used = [];
  for (const c of order) c.lane = undefined;
  for (const c of order) {
    if (Math.abs(c.from - c.to) < 1) { c.lane = -1; continue; }
    // An inner cable sits below every outer cable it overlaps, which keeps the fan-out free of crossings.
    const over = order.filter((u) => u !== c && u.lane >= 0 && c.lo < u.hi + 14 && u.lo < c.hi + 14);
    const k = over.length ? Math.max(...over.map((u) => u.lane)) + 1 : 0;
    (used[k] ||= []).push(c); c.lane = k;
  }
  const laneY = (k) => swR.y + swR.h + STUB + 10 + k * 20;
  const hostY = laneY(Math.max(0, used.length - 1)) + 44;
  HOSTS.forEach((id) => { dev(id).y = hostY; });
  const bottom = Math.max(...doc.devices.filter((d) => d.kind !== "vm").map((d) => d.y + boxSize(d).h));
  VB.w = SWX_END(); VB.h = bottom + 40;
  // 2. Route every cable.
  const B = blocks();
  for (const l of doc.links) {
    const A = dev(l.a.device), Bd = dev(l.b.device);
    if (!A || !Bd) continue;
    const pa = anchor(A, l.a.port, Bd), pb = anchor(Bd, l.b.port, A);
    const sa = stubEnd(pa), sb = stubEnd(pb);
    const lane = down.find((c) => c.l === l);
    let mid;
    if (lane && lane.lane >= 0 && pa.side !== pb.side) {
      const y = laneY(lane.lane);
      mid = [sa, { x: sa.x, y }, { x: sb.x, y }, sb];
    } else if (lane) mid = [sa, sb];
    else mid = astar(sa, sb, DIR[pa.side], B);
    routes.set(l.id, { pts: simplify([pa, ...mid, pb]), ends: [pa, pb] });
  }
  svg.setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`);
}
const SWX_END = () => Math.max(60 + SW_W + 40, 60 + HOSTS.length * HOST_PITCH + 20, dev("guest").x + SIDE_W + 300);
function pathOf(pts) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const r = Math.min(12, Math.hypot(p.x - a.x, p.y - a.y) / 2, Math.hypot(b.x - p.x, b.y - p.y) / 2);
    const ux = Math.sign(p.x - a.x), uy = Math.sign(p.y - a.y), vx = Math.sign(b.x - p.x), vy = Math.sign(b.y - p.y);
    d += ` L${p.x - ux * r},${p.y - uy * r} Q${p.x},${p.y} ${p.x + vx * r},${p.y + vy * r}`;
  }
  const z = pts.at(-1);
  return d + ` L${z.x},${z.y}`;
}
const isWifi = (l) => [l.a, l.b].some((e) => e.port === "guest Wi-Fi" || e.port === "Internet Wi-Fi");
function portMode(p) {
  if (p.shutdown) return ["off", ""];
  if (p.mode === "access") return ["access", p.pvid || ""];
  if (p.mode === "trunk") { const v = [p.pvid, p.tagged.join(",")].filter(Boolean).join("|"); return ["trunk", v.length > 9 ? v.slice(0, 8) + "…" : v]; }
  return ["", ""];
}
// A plug where a cable meets a port or a device
function plug(g, a, wifi) {
  if (wifi) { el("circle", { cx: a.x, cy: a.y, r: 4.5, class: "d-plug" }, g); return; }
  const [dx, dy] = DIR[a.side], v = dx === 0;
  const w = v ? 16 : 11, h = v ? 11 : 16;
  el("rect", { x: a.x - w / 2 + dx * 3, y: a.y - h / 2 + dy * 3, width: w, height: h, rx: 2.5, class: "d-plug" }, g);
}

function drawInto(root, ui) {
  layout();
  const lw = 150, lh = 80, lx = VB.w - lw - 20, ly = 16;
  if (doc.meta.logo) {
    const g = el("g", ui ? { "data-logo": "1", class: "logo-slot", tabindex: 0, role: "button", "aria-label": "Company logo. Select to change or remove it." } : {}, root);
    el("image", { href: doc.meta.logo, x: lx, y: ly, width: lw, height: lh, preserveAspectRatio: "xMaxYMin meet", class: "d-logo" }, g);
    if (ui) el("rect", { x: lx, y: ly, width: lw, height: lh, class: "logo-hit" }, g);
  } else if (ui) {
    // A placeholder only on screen; exports leave the corner empty until a logo is added.
    const g = el("g", { "data-logo": "1", class: "logo-slot empty", tabindex: 0, role: "button", "aria-label": "Upload your company logo" }, root);
    el("rect", { x: lx, y: ly, width: lw, height: lh, rx: 8, class: "logo-ph" }, g);
    text(g, lx + lw / 2, ly + 36, "logo-ph-t", "Upload logo", "middle");
    text(g, lx + lw / 2, ly + 56, "logo-ph-s", "PNG or JPG", "middle");
  }
  const connected = new Set(doc.links.flatMap((l) => [l.a, l.b]).filter((e) => e.port).map((e) => e.device + "|" + e.port));
  const gd = el("g", {}, root), gl = el("g", {}, root);
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
        const r = portRect(d, p.name), [mode, vl] = portMode(p), on = connected.has(d.id + "|" + p.name);
        const pg = el("g", { class: "port" + (p.shutdown ? " off" : "") + (on ? " on" : ""), ...(ui ? { "data-port": p.name, "data-pdev": d.id } : {}) }, g);
        el("rect", { x: r.x - d.x, y: r.y - d.y, width: r.w, height: r.h, rx: 5, class: "d-port" }, pg);
        text(pg, r.cx - d.x, r.y - d.y + 19, "d-pname", p.name, "middle");
        if (mode) text(pg, r.cx - d.x, r.y - d.y + 33, "d-pmode", mode, "middle");
        if (vl) text(pg, r.cx - d.x, r.y - d.y + 46, "d-pvl", vl, "middle");
      }
      continue;
    }
    const alone = !lines.length && d.kind !== "hypervisor";
    text(g, w / 2, alone ? h / 2 + 6 : 30, "d-name", d.name, "middle");
    lines.forEach((s, i) => text(g, w / 2, 53 + i * 19, "d-val", s, "middle"));
    if (d.kind === "hypervisor") {
      let y = 44 + lines.length * 19 + (lines.length ? 8 : 0) + 2;
      for (const v of vmsOf(d.id)) {
        const vg = el("g", { class: "vm" + (ui && sel?.type === "dev" && sel.id === v.id ? " sel" : ""), "data-vm": v.id,
          ...(ui ? { tabindex: 0, role: "button", "aria-label": `${v.name}, virtual machine` } : {}) }, g);
        el("rect", { x: 12, y, width: w - 24, height: VM_H, rx: 6, class: "d-vm" }, vg);
        const det = [v.vlanTag ? "tag " + v.vlanTag : "", withPrefix(v.address, v.mask) || (v.dhcp ? "DHCP" : "")].filter(Boolean).join("  ");
        text(vg, 22, y + (det ? 17 : 26), "d-vmname", v.name, "start");
        if (v.hostname) text(vg, w - 22, y + (det ? 17 : 26), "d-vmhost", v.hostname, "end");
        if (det) text(vg, 22, y + 34, "d-val", det, "start");
        y += VM_H + 6;
      }
    }
    const single = !portsFor(d).length, tabs = single ? [nicOf(d)] : portsFor(d);
    for (const name of tabs) {
      const t = tabRect(d, name), on = single ? doc.links.some((l) => l.a.device === d.id || l.b.device === d.id) : connected.has(d.id + "|" + name);
      const tg = el("g", { class: "port" + (on ? " on" : ""), ...(ui ? { "data-port": name, "data-pdev": d.id } : {}) }, g);
      el("rect", { x: t.x - d.x, y: t.y - d.y, width: t.w, height: t.h, rx: 4, class: "d-tab" }, tg);
      text(tg, t.x - d.x + t.w / 2, t.y - d.y + 15, "d-tabname", name, "middle");
    }
  }
  for (const l of doc.links) {
    const r = routes.get(l.id);
    if (!r) continue;
    const path = pathOf(r.pts), wifi = isWifi(l);
    const g = el("g", { class: "lk" + (ui && sel?.type === "link" && sel.id === l.id ? " sel" : ""), "data-link": l.id }, gl);
    if (!wifi) el("path", { d: path, class: "d-case" }, g);
    el("path", { d: path, class: "d-link" + (wifi ? " wifi" : "") }, g);
    r.ends.forEach((a) => plug(g, a, wifi));
    if (ui) el("path", { d: path, class: "hit" }, g);
  }
}
function renderSvg() {
  svg.replaceChildren();
  drawInto(svg, true);
  if (view === "table") renderTable();
  const gx = dev("isplap").x + SIDE_W + 70;
  const tips = hasContent() ? ["Solid line: cable.  Dashed line: Wi-Fi."]
    : ["Solid line: cable.  Dashed line: Wi-Fi.", "", "To record a cable, drag from a labeled port", "to the device at the other end.",
      "Select a device to enter its settings."];
  const g = el("g", {}, svg);
  tips.forEach((s, i) => text(g, gx, 56 + i * 22, "ghint", s));
}

// ------------------------------------------------------------------ canvas interaction
const toSvg = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
let drag = null;
function dropTarget(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const p = t?.closest?.("[data-port]"), g = t?.closest?.("[data-dev]");
  if (!g) return null;
  const d = dev(g.dataset.dev);
  return { device: d.id, port: p && portsFor(d).length ? p.dataset.port : "" };
}
function logoClick() {
  if (!doc.meta.logo) { $("logofile").click(); return; }
  ask("Company logo", [h("img", { src: doc.meta.logo, alt: "Your company logo", class: "logoprev" })],
    [["Cancel"], ["Remove logo", () => { delete doc.meta.logo; commit(); renderAll(); }, "danger"], ["Change logo", () => $("logofile").click(), "primary"]]);
}
svg.addEventListener("click", (e) => { if (e.target.closest("[data-logo]")) logoClick(); });
svg.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest?.("[data-logo]")) { e.preventDefault(); logoClick(); } });
svg.addEventListener("pointerdown", (e) => {
  if (e.target.closest("[data-logo]")) return;
  const port = e.target.closest("[data-port]"), vmEl = e.target.closest("[data-vm]"), box = e.target.closest("[data-dev]");
  if (vmEl) { select({ type: "dev", id: vmEl.dataset.vm }); return; }
  // Cables start only at a port. A click on a port or a box selects the device.
  if (box && !port) { select({ type: "dev", id: box.dataset.dev }); return; }
  if (port) {
    const pd = dev(port.dataset.pdev);
    const from = { device: pd.id, port: portsFor(pd).length ? port.dataset.port : "" };
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
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
  const p = toSvg(e);
  drag.line.style.display = "";
  drag.line.setAttribute("x2", p.x); drag.line.setAttribute("y2", p.y);
  svg.querySelectorAll(".drop").forEach((n) => n.classList.remove("drop"));
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const target = t?.closest?.("[data-port]") || t?.closest?.("[data-dev]");
  if (target && (target.dataset.dev || target.dataset.pdev) !== drag.from.device) target.classList.add("drop");
});
const endDrag = (e) => {
  if (!drag) return;
  const dr = drag; drag = null;
  dr.line.remove();
  if (e.type === "pointercancel") { renderSvg(); return; }
  if (Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 6) { select({ type: "dev", id: dr.from.device }); return; }
  const to = dropTarget(e);
  if (to && to.device !== dr.from.device) addLink(dr.from, to); else renderSvg();
};
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);
svg.addEventListener("keydown", (e) => {
  const g = e.target.closest?.("[data-vm]") || e.target.closest?.("[data-dev]");
  if (!g || (e.key !== "Enter" && e.key !== " ")) return;
  const id = g.dataset.vm || g.dataset.dev;
  e.preventDefault(); select({ type: "dev", id });
  svg.querySelector(g.dataset.vm ? `[data-vm="${id}"]` : `[data-dev="${id}"]`)?.focus();
});
// A port, or a device with a single network port, holds one cable. A new cable replaces the old one.
function occupied(end, except) {
  const d = dev(end.device);
  if (!d) return [];
  const single = !portsFor(d).length;
  if (!single && !end.port) return [];
  return doc.links.filter((l) => l !== except && [l.a, l.b].some((x) => x.device === end.device && (single || x.port === end.port)));
}
function addLink(a, b) {
  const auto = (e) => { const d = dev(e.device); if (portsFor(d).length && !e.port) { const free = portsFor(d).find((p) => !occupied({ device: d.id, port: p }).length); if (d.kind === "isp" && free) e.port = free; } };
  auto(a); auto(b);
  const gone = [...new Set([...occupied(a), ...occupied(b)])];
  doc.links = doc.links.filter((l) => !gone.includes(l));
  const l = { id: newId("l"), a: { ...a }, b: { ...b } };
  doc.links.push(l); commit(); select({ type: "link", id: l.id });
  const needPort = (e) => portsFor(dev(e.device)).length && !e.port;
  toast(gone.length ? "Replaced the old cable. Undo brings it back." : needPort(a) || needPort(b) ? "Cable recorded. Choose the port it uses." : "Cable recorded.");
}
function setPort(l, end, port) {
  end.port = port;
  const gone = occupied(end, l);
  if (gone.length) { doc.links = doc.links.filter((x) => !gone.includes(x)); toast("Replaced the old cable on " + port + ". Undo brings it back."); }
  commit(); renderSvg();
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
function inp(obj, key, { kind, ph, label } = {}) {
  const val = kind === "list" ? (obj[key] || []).join(", ") : (obj[key] ?? "");
  const hint = h("span", { class: "hint", hidden: true });
  const check = (s) => {
    let bad = "";
    if (s && kind === "ip" && !isIP(s) && !isCIDR(s)) bad = "Not an IPv4 address";
    if (s && kind === "cidr" && !isCIDR(s) && !isIP(s)) bad = "Use an address with a prefix, like a.b.c.d/nn";
    if (s && kind === "mask" && maskToPrefix(s) === null) bad = "Use a prefix like 24, or a dotted mask";
    if (s && kind === "num" && !/^\d+$/.test(s)) bad = "Use a number";
    if (s && kind === "list" && !/^\s*\d+(\s*,\s*\d+)*\s*$/.test(s)) bad = "Use numbers separated by commas";
    hint.hidden = !bad; hint.textContent = bad;
  };
  const i = h("input", { value: val, placeholder: ph || "", "aria-label": label || key,
    spellcheck: false, autocomplete: "off", inputmode: kind === "num" || kind === "list" ? "numeric" : kind ? "decimal" : undefined,
    oninput: (e) => { set(e.target.value, false); check(e.target.value.trim()); renderSvg(); },
    onchange: (e) => {
      let s = e.target.value.trim();
      if (kind === "ip" && s.includes("/") && "mask" in obj) { const [a, p] = s.split("/"); if (isIP(a) && maskToPrefix(p) !== null) { obj.mask = maskToPrefix(p); s = a; } }
      if (kind === "mask" && maskToPrefix(s) !== null) s = maskToPrefix(s);
      set(s, true); e.target.value = kind === "list" ? (obj[key] || []).join(", ") : obj[key];
      check(s); commit(); renderSvg(); if (kind === "ip" && "mask" in obj) rerenderForms();
    } });
  function set(s, final) {
    if (kind === "list") { const v = s.split(",").map((x) => x.trim()).filter(Boolean); obj[key] = final ? [...new Set(v)] : v; }
    else obj[key] = final ? s.trim() : s;
  }
  check(String(val));
  if (kind === "mask") return h("span", { style: "display:block" }, h("span", { class: "pfx" }, h("span", { class: "slash", "aria-hidden": "true" }, "/"), i), hint);
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
function selectBox(obj, key, options, label, blank = "Not set", after) {
  return h("select", { "aria-label": label, onchange: (e) => { obj[key] = e.target.value; commit(); renderSvg(); after?.(); } },
    h("option", { value: "" }, blank), options.map((o) => h("option", { value: o, selected: obj[key] === o }, o)));
}
// Editable rows. cols: [{key, label, kind, ph, w}]
function rows(arr, cols, make, label) {
  const t = h("table", { class: "t" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { style: c.w ? `width:${c.w}` : "" }, c.label)), h("th", {}))),
    h("tbody", {}, arr.map((r, i) => h("tr", {},
      cols.map((c) => h("td", {}, c.render ? c.render(r) : inp(r, c.key, { kind: c.kind, ph: c.ph, label: `${label} ${i + 1} ${c.label}` }))),
      h("td", {}, h("button", { class: "rowx small", title: "Remove row", "aria-label": `Remove ${label} ${i + 1}`,
        onclick: () => { arr.splice(i, 1); commit(); renderSvg(); rerenderForms(); } }, "✕"))))));
  return [t, h("button", { class: "small", onclick: () => { arr.push(make()); commit(); rerenderForms(); } }, "Add " + label)];
}
const rerenderForms = () => renderPanel();
const sec = (s) => h("div", { class: "sec" }, s);
const addrRow = (o, label = "") => h("div", { class: "row2" },
  field("Address", inp(o, "address", { kind: "ip", ph: "a.b.c.d", label: (label + " address").trim() })),
  field("Mask", inp(o, "mask", { kind: "mask", ph: "nn", label: (label + " mask").trim() })));

// ------------------------------------------------------------------ editors
function editor(d) {
  const out = [];
  if (ENDPOINT.has(d.kind)) {
    out.push(field("Hostname", inp(d, "hostname", { ph: "hostname", label: "Hostname" })), addrRow(d), field("Gateway", inp(d, "gateway", { kind: "ip", ph: "a.b.c.d", label: "Gateway" })));
    if (d.kind === "vm") out.push(field("VLAN tag (blank if untagged)", inp(d, "vlanTag", { kind: "num", ph: "none", label: "VLAN tag" })));
    out.push(chk(d, "dhcp", "Gets its address by DHCP"));
    if (d.kind === "hypervisor") out.push(h("p", { class: "muted" }, "Select a virtual machine inside the hypervisor to fill in its settings."));
  }
  if (d.kind === "isp") out.push(addrRow(d));
  if (d.kind === "switch" || d.kind === "firewall") out.push(field("Hostname", inp(d, "hostname", { ph: "hostname", label: "Hostname" })));
  if (d.kind === "switch") {
    out.push(sec("Out-of-band (OOB) port"), addrRow(d.oob, "OOB"));
    out.push(sec("VLAN interfaces (SVIs)"), ...rows(d.svis, [{ key: "vlan", label: "VLAN", kind: "num", w: "20%" }, { key: "address", label: "Address", kind: "ip", ph: "a.b.c.d" }, { key: "mask", label: "Mask", kind: "mask", w: "20%", ph: "nn" }], () => ({ vlan: "", address: "", mask: "" }), "VLAN interface"));
    out.push(sec("Static routes"), ...rows(d.routes, [{ key: "dest", label: "Destination", kind: "cidr", ph: "a.b.c.d/nn" }, { key: "nextHop", label: "Next hop", kind: "ip", ph: "a.b.c.d" }], () => ({ dest: "", nextHop: "" }), "route"));
    out.push(sec("Ports"));
    out.push(h("table", { class: "t ports" }, h("thead", {}, h("tr", {}, ["Port", "Mode", "Untagged", "Tagged", "Off"].map((c) => h("th", {}, c)))),
      h("tbody", {}, d.ports.map((p) => h("tr", {}, h("td", { class: "n" }, p.name),
        h("td", {}, selectBox(p, "mode", ["access", "trunk"], `${p.name} mode`, "—", rerenderForms)),
        h("td", {}, inp(p, "pvid", { kind: "num", ph: "VLAN", label: `${p.name} untagged VLAN` })),
        h("td", {}, p.mode === "trunk" ? inp(p, "tagged", { kind: "list", ph: "VLANs", label: `${p.name} tagged VLANs` }) : ""),
        h("td", {}, h("input", { type: "checkbox", "aria-label": `${p.name} shut down`, checked: p.shutdown,
          onchange: (e) => { p.shutdown = e.target.checked; commit(); renderSvg(); } })))))));
    out.push(sec("DHCP pools"), ...rows(d.dhcpPools, [{ key: "vlan", label: "VLAN", kind: "num", w: "16%" }, { key: "start", label: "Start", kind: "ip", ph: "a.b.c.d" }, { key: "end", label: "End", kind: "ip", ph: "a.b.c.d" }, { key: "router", label: "Router", kind: "ip", ph: "a.b.c.d" }], () => ({ vlan: "", start: "", end: "", router: "" }), "pool"));
  }
  if (d.kind === "firewall") {
    out.push(sec("Interfaces"));
    for (const i of d.interfaces) out.push(h("div", { class: "card-b" }, h("h3", {}, i.name), addrRow(i, i.name),
      i.name === "guest Wi-Fi" ? field("SSID", inp(i, "ssid", { ph: "Network name", label: "SSID" })) : null));
    out.push(sec("Static routes"), ...rows(d.routes, [{ key: "dest", label: "Destination", kind: "cidr", ph: "a.b.c.d/nn" }, { key: "gateway", label: "Gateway", kind: "ip", ph: "a.b.c.d" },
      { key: "interface", label: "Interface", w: "28%", render: (r) => selectBox(r, "interface", FW_IFS, "Route interface", "—") }], () => ({ dest: "", gateway: "", interface: "" }), "route"));
    out.push(sec("Virtual IPs (port forwards)"), ...rows(d.vips, [{ key: "name", label: "Name", ph: "Name" }, { key: "external", label: "External", kind: "ip", ph: "a.b.c.d" }, { key: "port", label: "Port", kind: "num", w: "16%" }, { key: "mapped", label: "Mapped to", kind: "ip", ph: "a.b.c.d" }], () => ({ name: "", external: "", port: "", mapped: "" }), "virtual IP"));
    out.push(sec("Policies"));
    d.policies.forEach((p, n) => {
      out.push(h("div", { class: "card-b" },
        h("h3", {}, h("span", {}, `Policy ${n + 1}`), h("button", { class: "small danger", onclick: () => { d.policies.splice(n, 1); commit(); renderSvg(); rerenderForms(); } }, "Remove")),
        field("Name", inp(p, "name", { ph: "Policy name", label: `Policy ${n + 1} name` })),
        h("div", { class: "row2" }, field("From", selectBox(p, "from", FW_IFS, "From interface", "—")), field("To", selectBox(p, "to", FW_IFS, "To interface", "—"))),
        h("div", { class: "row2" }, field("Source", inp(p, "source", { kind: "cidr", ph: "any", label: "Source" })), field("Destination", inp(p, "dest", { kind: "cidr", ph: "any", label: "Destination" }))),
        h("span", { class: "f" }, h("span", {}, "Services")), multi(p, "services", SERVICES),
        h("div", { class: "checks" }, chk(p, "nat", "NAT"), chk(p, "log", "Logging"))));
    });
    out.push(h("button", { class: "small", onclick: () => { d.policies.push({ name: "", from: "", to: "", source: "", dest: "", services: [], nat: false, log: false }); commit(); rerenderForms(); } }, "Add policy"));
  }
  return out;
}
function portSelect(l, end) {
  const D = dev(end.device), ports = portsFor(D);
  if (!ports.length) return h("span", { class: "muted" }, "Its network port");
  return h("select", { "aria-label": D.name + " port", onchange: (ev) => { setPort(l, end, ev.target.value); rerenderForms(); } },
    h("option", { value: "" }, "Choose…"), ports.map((p) => h("option", { value: p, selected: end.port === p }, p)));
}
function linkEditor(l) {
  const A = dev(l.a.device), B = dev(l.b.device);
  return [field(A.name, portSelect(l, l.a)), field(B.name, portSelect(l, l.b)),
    h("p", { class: "muted" }, "Switch port settings are entered on the switch. Choosing a port that already has a cable replaces that cable.")];
}
function help() {
  ask("How to use the Network Diagram", [
    h("p", {}, "Your team records the network it has built on the rack. Each Cyber Hub page ends with an “Update your network diagram” box that says what to record from that lab."),
    sec("Record a cable"),
    h("p", {}, "Drag from a labeled port, such as a switch port or a firewall interface, and drop it on the device at the other end. Dropping on a port records that port. A port that already has a cable gets the new one instead; Undo brings the old one back."),
    sec("Enter settings"),
    h("p", {}, "Select a device to fill in its settings, or a virtual machine inside the hypervisor. The Addressing table tab lists every interface and cable you have entered, ready to copy into your Team Log or SSP."),
    sec("Your logo"),
    h("p", {}, "Select Upload logo in the top corner of the diagram and choose a PNG or JPG. Your logo replaces the placeholder and appears in Export PNG. Select it again to change or remove it. The app shrinks it so the share link stays short."),
    sec("Save and share"),
    h("p", {}, "The diagram saves in this browser, but the share link is the real save. After each update, copy the share link and paste it over the old one on your Team Log cover page. Export PNG makes the image for your SSP."),
    h("p", { class: "muted" }, "The app shows only what you enter. It never checks your work against the lab plan, so test on the rack."),
  ], [["Close"]]);
}

function renderPanel() {
  const top = panel.scrollTop;
  const s = findSel();
  const kids = [];
  if (!s) {
    kids.push(h("h2", {}, "Your network diagram"),
      h("p", {}, "Record what your team has built on the rack. Each Cyber Hub page says what to add."),
      h("p", {}, "Select a device to enter its settings. To record a cable, drag from a labeled port to the device at the other end."),
      h("p", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); help(); } }, "How to use the Network Diagram")));
  } else if (sel.type === "dev") {
    kids.push(h("h2", {}, s.name), h("p", { class: "kind" }, s.kind === "vm" ? "Virtual machine on the hypervisor" : KINDS[s.kind]));
    kids.push(...editor(s));
  } else {
    kids.push(h("h2", {}, "Cable"), h("p", { class: "kind" }, `${dev(s.a.device)?.name} to ${dev(s.b.device)?.name}`));
    kids.push(...linkEditor(s));
    kids.push(h("div", { class: "foot" }, h("button", { class: "danger", onclick: () => { doc.links = doc.links.filter((x) => x !== s); commit(); select(null); } }, "Delete cable")));
  }
  panel.replaceChildren(...kids);
  panel.scrollTop = top;
}

// ------------------------------------------------------------------ addressing table
// A read-only listing of what the team entered, laid out like a professional addressing table.
function prefixToMask(p) {
  const n = +p;
  if (!/^\d{1,2}$/.test(String(p)) || n > 32) return "";
  const bits = "1".repeat(n).padEnd(32, "0");
  return [0, 8, 16, 24].map((i) => parseInt(bits.slice(i, i + 8), 2)).join(".");
}
function addressRows() {
  const R = [];
  const ip = (o) => o.address || (o.dhcp ? "DHCP" : "");
  const mask = (o) => (o.address && o.mask ? prefixToMask(o.mask) : "");
  const add = (d, iface, vlan, o, gw) => R.push({ d, host: d.hostname || "", iface, vlan: vlan || "", ip: ip(o), mask: mask(o), gw: gw || "" });
  const isp = dev("isp"), fw = dev("fw"), sw = dev("sw");
  add(isp, "Uplink", "", isp, "");
  for (const i of fw.interfaces) add(fw, i.name, "", i, "");
  add(sw, "OOB", "", sw.oob, "");
  const svis = [...sw.svis].sort((a, b) => (+a.vlan || 0) - (+b.vlan || 0));
  if (svis.length) svis.forEach((v) => add(sw, "VLAN " + (v.vlan || "?"), v.vlan, v, ""));
  else add(sw, "VLAN interfaces", "", {}, "");
  for (const id of ["hv", "vmweb", "vmftp", "vmscan", "nas", "admin", "pi", "lap", "isplap", "guest"]) {
    const d = dev(id);
    add(d, d.kind === "vm" ? "net0" : nicOf(d), d.kind === "vm" ? d.vlanTag : "", d, d.gateway);
  }
  return R;
}
function connectionRows() {
  const sw = dev("sw"), order = (l) => {
    const s = l.a.device === "sw" ? l.a : l.b.device === "sw" ? l.b : null;
    return s ? SW_PORTS.indexOf(s.port) : 100 + doc.devices.findIndex((d) => d.id === l.a.device);
  };
  return [...doc.links].sort((x, y) => order(x) - order(y)).map((l) => {
    let [a, b] = [l.a, l.b];
    if (b.device === "sw" || (a.device !== "sw" && b.device === "fw")) [a, b] = [b, a];
    const A = dev(a.device), B = dev(b.device);
    const p = A.kind === "switch" ? A.ports.find((q) => q.name === a.port) : null;
    const name = (D, e) => portsFor(D).length ? (e.port || "") : nicOf(D);
    return { A, B, pa: name(A, a), pb: name(B, b), mode: p ? (p.shutdown ? "shut down" : p.mode) : "",
      vlans: p && !p.shutdown ? (p.mode === "trunk" ? [p.pvid && p.pvid + " untagged", p.tagged.length && p.tagged.join(", ") + " tagged"].filter(Boolean).join("; ") : p.pvid) : "" };
  });
}
const dash = (v) => (v ? v : h("span", { class: "blank" }, "—"));
function tableEl(caption, cols, rowsData, cells, idOf, cls = "") {
  return h("table", { class: "topo " + cls }, h("caption", {}, caption),
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { scope: "col" }, c)))),
    h("tbody", {}, rowsData.map((r, i) => {
      const prev = rowsData[i - 1], first = !prev || idOf(prev) !== idOf(r);
      return h("tr", { class: first ? "grp" : "", onclick: () => select({ type: "dev", id: (r.d || r.A).id }) }, cells(r, first).map((c, j) => h(j === 0 ? "th" : "td", j === 0 ? { scope: "row" } : {}, c)));
    })));
}
async function copyTable(t) {
  const html = '<table border="1" cellpadding="4" style="border-collapse:collapse;font-family:Arial;font-size:10pt">' + t.innerHTML.replace(/<caption>.*?<\/caption>/, "") + "</table>";
  const plain = [...t.querySelectorAll("tr")].map((r) => [...r.children].map((c) => c.textContent.trim()).join("\t")).join("\n");
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
  } catch {
    const r = document.createRange(); r.selectNode(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand("copy"); s.removeAllRanges();
  }
  toast("Table copied. Paste it into your Team Log or SSP.");
}
function renderTable() {
  const top = tableView.scrollTop;
  const A = addressRows(), C = connectionRows();
  const at = tableEl("Addressing table", ["Device", "Hostname", "Interface", "VLAN", "IP address", "Subnet mask", "Default gateway"], A,
    (r, first) => [first ? r.d.name : "", first && r.d.kind !== "isp" ? dash(r.host) : "", r.iface, dash(r.vlan), dash(r.ip), dash(r.mask), dash(r.gw)], (r) => r.d.id, "addr");
  const ct = C.length ? tableEl("Connections", ["Device", "Port", "Connects to", "Port", "Mode", "VLANs"], C,
    (r, first) => [r.A.name, dash(r.pa), r.B.name, dash(r.pb), dash(r.mode), dash(r.vlans)], (r) => r.A.id + r.pa, "conn")
    : h("p", { class: "muted" }, "No cables recorded yet.");
  const head = (title, note, t) => h("div", { class: "thead" }, h("div", {}, h("h2", {}, title), h("p", { class: "muted" }, note)),
    t.tagName === "TABLE" ? h("button", { class: "small", onclick: () => copyTable(t) }, "Copy table") : null);
  tableView.replaceChildren(
    head("Addressing table", "Every interface, from what you entered. Select a row to edit that device.", at), at,
    head("Connections", "Every cable, with the switch port's mode and VLANs.", ct), ct);
  tableView.scrollTop = top;
}
let view = "canvas";
function setView(v) {
  view = v;
  $("t-canvas").setAttribute("aria-selected", v === "canvas"); $("t-table").setAttribute("aria-selected", v === "table");
  $("v-canvas").hidden = v !== "canvas"; tableView.hidden = v !== "table";
  renderSvg(); renderPanel();
}
function renderAll() { $("company").value = doc.meta.company || ""; renderSvg(); renderPanel(); }

// ------------------------------------------------------------------ logo
// Shrunk to a small image so the share link stays short enough to paste.
async function readLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    for (const [mw, mh, type, q] of [[300, 160, "image/webp", 0.85], [300, 160, "image/png"], [220, 120, "image/webp", 0.7], [220, 120, "image/jpeg", 0.8], [160, 86, "image/jpeg", 0.7]]) {
      const k = Math.min(1, mw / img.naturalWidth, mh / img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext("2d");
      if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL(type, q);
      if (d.startsWith("data:" + type) && d.length <= LOGO_MAX / 2) return d;
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}

// ------------------------------------------------------------------ share links
const b64u = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pipe(bytes, Stream, fmt) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(fmt))).arrayBuffer()); }
// Positions are fixed, so they are not stored.
const portable = (o) => ({ ...o, devices: o.devices.map(({ x, y, ...rest }) => rest) });
async function encode(o) {
  const bytes = new TextEncoder().encode(JSON.stringify(portable(o)));
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
  try { await navigator.clipboard.writeText(url); toast("Share link copied. Paste it over the old one on your Team Log cover page."); }
  catch {
    ask("Copy your share link", [h("p", {}, "Select the link and copy it, then paste it on your Team Log cover page."), h("textarea", { readonly: true, value: url, onfocus: (e) => e.target.select() })], [["Done"]]);
    setTimeout(() => $("m-body").querySelector("textarea")?.select(), 0);
  }
}

// ------------------------------------------------------------------ export
async function exportPng() {
  layout();
  const pad = 20, W = VB.w + pad * 2, HD = 70, H = VB.h + HD + pad;
  const out = document.createElementNS(NS, "svg");
  out.setAttribute("xmlns", NS); out.setAttribute("width", W); out.setAttribute("height", H); out.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
    .map((r) => r.cssText).filter((t) => /^\.(d-|port\.)/.test(t)).join("\n").replace(/var\(--navy\)/g, "#003366");
  el("style", {}, out).textContent = css;
  el("rect", { width: W, height: H, fill: "#ffffff" }, out);
  text(out, 30, 34, "d-title", (doc.meta.company || "Company") + " network diagram");
  text(out, 30, 54, "d-sub", "Updated " + new Date(doc.meta.updated || Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
  const g = el("g", { transform: `translate(${pad},${HD})` }, out);
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
  m.onclick = (e) => { if (e.target === m) close(); };
}
function load(o, why) {
  doc = normalize(o); sel = null; hist = []; hi = -1; commit(); renderAll(); if (why) toast(why);
}

// ------------------------------------------------------------------ wiring
$("t-canvas").onclick = () => setView("canvas");
$("t-table").onclick = () => setView("table");
$("b-undo").onclick = undo; $("b-redo").onclick = redo;
$("b-help").onclick = help;
$("b-share").onclick = share; $("b-png").onclick = exportPng;
$("logofile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  let d = null;
  try { d = await readLogo(f); } catch {}
  if (!d) { toast("That file couldn't be used as a logo. Try a PNG or JPG image."); return; }
  doc.meta.logo = d; commit(); renderAll(); toast("Logo added. Copy the share link to keep it.");
});
const more = $("more");
$("b-more").onclick = (e) => { e.stopPropagation(); more.hidden = !more.hidden; $("b-more").setAttribute("aria-expanded", !more.hidden); };
document.addEventListener("click", () => { more.hidden = true; $("b-more").setAttribute("aria-expanded", false); });
$("b-json").onclick = () => download(new Blob([JSON.stringify(portable(doc), null, 1)], { type: "application/json" }), fileBase() + ".json");
$("b-open").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try { const o = JSON.parse(await f.text()); normalize(o); ask("Open " + f.name + "?", [h("p", {}, "This replaces the diagram on screen. Copy its share link first if you want to keep it.")], [["Cancel"], ["Open", () => load(o, "Opened " + f.name)]]); }
  catch { toast("That file isn't a diagram backup."); }
};
$("b-print").onclick = () => { setView("canvas"); setTimeout(() => print(), 50); };
$("b-reset").onclick = () => ask("Reset the diagram?", [h("p", {}, "This clears every cable and setting. Copy the share link first if you want to keep this version."), h("p", { class: "muted" }, "You can undo this.")],
  [["Cancel"], ["Reset", () => { const co = doc.meta.company, lg = doc.meta.logo; doc = blankDoc(); doc.meta.company = co; if (lg) doc.meta.logo = lg; sel = null; sharedJSON = null; commit(); renderAll(); }, "danger"]]);
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
      if (differs && hasContent(local)) {
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
