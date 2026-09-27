// 思考图标「园林花窗」：七扇花窗依次变形（海棠 → 月洞 → 亚字 → 回字 → 菱窗 → 方胜 → 八角），拧三下；
// 完成时「开窗」：缩一下换成关着的海棠窗，两扇窗扇向左右推开，花蕊冒出来，停成灰色海棠窗。
// 两层：窗框 = 外轮廓 + 真等距内轮廓（evenodd 镂空）；窗芯 = 外轮廓 + 孔（实心时孔缩成一点）。
// 每条轮廓都是极坐标采样：锚点数固定、每段一条二次曲线，所以同一层所有帧的命令结构完全一样，
// SVG <animate d> 才能在它们之间变形（iOS Safari 不支持 CSS 的 d 动画）。
// 设计稿与候选方案：docs/交接.md 2026-09-27 日志。
const HC_TIME_SCALE = 1.25; // 设计稿一轮 3.74s，定稿用放慢 1.25 倍的 4.675s
const HUACHUANG = (() => {
  const N = 48;        // 窗框两条轮廓、窗芯外轮廓的锚点数：每 7.5° 一个，22.5°/45°/90° 都正好是锚点
  const NH = 24;       // 窗芯孔的锚点数（孔小，每 15° 一个够用）
  const W = 2.0;       // 窗框宽（viewBox 24 里的单位）
  const DEG = Math.PI / 180;
  const f1 = (n) => { const v = Math.round(n * 10) / 10; return Object.is(v, -0) ? "0" : String(v); };
  const dirOf = (t) => [Math.sin(t), -Math.cos(t)]; // θ=0 朝正上，顺时针为正（屏幕 y 向下）
  const aDeg = (x, y) => Math.atan2(x, -y) / DEG;
  const memo = (f) => { const c = new Map(); return (t) => { const k = Math.round(t * 1e7); let v = c.get(k); if (v === undefined) { v = f(t); c.set(k, v); } return v; }; };

  // ---------- 形状判定（按屏幕上看到的朝向写，中心 0,0） ----------
  const circleIn = (r) => (x, y) => x * x + y * y <= r * r;
  // n 个圆的并集（海棠 n=4）：真圆弧；rot=0 时第一瓣朝正上
  const lobesIn = (n, d, R, rot = 0) => {
    const cs = Array.from({ length: n }, (_, i) => dirOf((rot + i * 360 / n) * DEG).map((v) => v * d));
    return (x, y) => cs.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= R * R);
  };
  const roundBoxIn = (s, rc) => (x, y) => {
    const qx = Math.abs(x) - (s - rc), qy = Math.abs(y) - (s - rc);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) <= rc;
  };
  const boxIn = (s) => (x, y) => Math.abs(x) <= s && Math.abs(y) <= s;
  const diamondIn = (h, cx = 0) => (x, y) => Math.abs(x - cx) + Math.abs(y) <= h;
  // 亚字（唐宋铜镜亚字形）：方的四角各切去一个小方
  const yaIn = (s, a) => (x, y) => { const ax = Math.abs(x), ay = Math.abs(y); return ax <= s && ay <= s && (ax <= a || ay <= a); };
  // 八角：平边朝上下左右，ap = 中心到边的距离
  const octIn = (ap) => (x, y) => { const ax = Math.abs(x), ay = Math.abs(y); return ax <= ap && ay <= ap && (ax + ay) * Math.SQRT1_2 <= ap; };
  const crossIn = (w, L) => (x, y) => { const ax = Math.abs(x), ay = Math.abs(y); return (ax <= w && ay <= L) || (ax <= L && ay <= w); };
  const unionIn = (...fs) => (x, y) => fs.some((f) => f(x, y));
  const offN = (t, n) => { const p = 2 * Math.PI / n; const x = ((t % p) + p) % p; return Math.min(x, p - x) / (p / 2); }; // 0 在瓣中心，1 在瓣间

  // 沿射线二分求边界半径（形状对中心是星形）
  const polarOf = (inside) => memo((t) => {
    const [dx, dy] = dirOf(t); let lo = 0, hi = 13;
    for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (inside(m * dx, m * dy)) lo = m; else hi = m; }
    return lo;
  });
  // 真等距内轮廓：外边界上密排半径 w 的小圆，沿射线第一次碰到哪个小圆，内轮廓就在哪。
  // 凸角 → 内角仍是尖角；凹角、海棠瓣间的尖 → 内侧自然成半径 w 的圆角。框宽处处等于 w。
  function insetOf(rOut, w, M = 720) {
    const bx = new Float64Array(M), by = new Float64Array(M), b2 = new Float64Array(M);
    for (let j = 0; j < M; j++) { const t = 2 * Math.PI * j / M, r = rOut(t), [dx, dy] = dirOf(t); bx[j] = r * dx; by[j] = r * dy; b2[j] = r * r; }
    return memo((t) => {
      const [ux, uy] = dirOf(t); let best = 13;
      for (let j = 0; j < M; j++) {
        const p = bx[j] * ux + by[j] * uy; if (p <= 0) continue;
        const h = w * w - (b2[j] - p * p); if (h < 0) continue;
        const r = p - Math.sqrt(h); if (r < best) best = r;
      }
      return Math.max(best, 0);
    });
  }

  // ---------- 极坐标 → 子路径 M + n×Q + Z ----------
  // feats：必须正好落在锚点上的角度（尖角、转角，按屏幕角度写），就近把锚点"吸"过去 → 直边真直、尖角真尖
  function anchorAngles(n, feats) {
    const step = 360 / n, angs = Array.from({ length: n }, (_, i) => i * step), taken = new Set();
    for (let f of feats) {
      f = ((f % 360) + 360) % 360;
      const i = Math.round(f / step) % n;
      if (taken.has(i)) throw new Error("花窗锚点冲突 " + f);
      taken.add(i); angs[i] = i === 0 && f > 180 ? f - 360 : f;
    }
    return angs;
  }
  // r：屏幕角（弧度）→ 半径。rho：这一帧所在 <g> 的转角（度）。
  // 路径写在 <g> 的本地坐标里：本地角 φ 对应屏幕角 φ+rho，<g> 转 rho 后正好是屏幕上的样子。
  function contour(r, n, feats = [], rho = 0) {
    const angs = anchorAngles(n, feats.map((f) => f - rho));
    const P = (phi) => { const rr = r((phi + rho) * DEG), [dx, dy] = dirOf(phi * DEG); return [rr * dx, rr * dy]; };
    const pts = angs.map(P), X = (p) => `${f1(12 + p[0])} ${f1(12 + p[1])}`;
    let d = `M${X(pts[0])}`;
    for (let i = 0; i < n; i++) {
      const a1 = angs[i], a2 = i === n - 1 ? angs[0] + 360 : angs[i + 1];
      const A = pts[i], B = pts[(i + 1) % n], Mid = P((a1 + a2) / 2);
      // 控制点让曲线正好穿过中间角那一点：直边上退化成直线，弧上贴合圆弧
      d += `Q${X([2 * Mid[0] - (A[0] + B[0]) / 2, 2 * Mid[1] - (A[1] + B[1]) / 2])} ${X(B)}`;
    }
    return d + "Z";
  }
  const dot = (n) => "M12 12" + "Q12 12 12 12".repeat(n) + "Z"; // 缩成一点、不占面积的孔
  const sym8 = (a) => [0, 90, 180, 270].flatMap((q) => [q + a, q + 90 - a]);
  const K4 = [0, 90, 180, 270], D4 = [45, 135, 225, 315], O8 = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5];

  // ---------- 窗框（屏幕朝向；rho = 所在拍的 <g> 转角） ----------
  const HT = { d: 5, R: 5.1, w: 2.1 };          // 海棠：四圆 d=5 R=5.1；框 2.1，完成态灰色也不发虚
  const YA = { s: 8.9, a: 5.8 };                // 亚字：外方半边 8.9，四角各切去 3.1 见方
  const SQ = { s: 8.7, rc: 3.0 };               // 方窗：抹圆角的方
  const LZ = { s: 7.7, rc: 1.2 };               // 菱窗：方窗转 45° 并收小，尖角不出界
  LZ.j = 45 - aDeg(LZ.s - LZ.rc, -LZ.s);        // 菱窗尖上小圆角的起止角（离尖 ±4.8°）
  const FS = { h: 7.5, c: 7.5 * Math.tan(22.5 * DEG) }; // 方胜：两菱形半对角 7.5、左右错开 3.1 → 顶点正好在 22.5°
  const OCT = 9.2;                              // 八角：中心到边 9.2
  const fsIn = FS.h - W * Math.SQRT2, fsT = aDeg(FS.c, -fsIn);
  const FRAMES = {
    haitang: { name: "海棠", inside: lobesIn(4, HT.d, HT.R), outerF: D4, w: HT.w },
    moon: { name: "月洞", inside: circleIn(10.0) },
    ya: { name: "亚字", inside: yaIn(YA.s, YA.a), outerF: [...sym8(aDeg(YA.a, -YA.s)), ...D4], innerF: sym8(aDeg(YA.a - W, -(YA.s - W))) },
    // 圆角起止处也钉上锚点：直边到圆角的接缝落在锚点上，内外圆角都干净
    square: { name: "方窗", inside: roundBoxIn(SQ.s, SQ.rc), outerF: sym8(aDeg(SQ.s - SQ.rc, -SQ.s)), innerF: sym8(aDeg(SQ.s - SQ.rc, -(SQ.s - W))) },
    // 菱窗 = 方窗整组咔哒转 45°：屏幕上看是菱形
    lozenge: { name: "菱窗", inside: (x, y) => roundBoxIn(LZ.s, LZ.rc)((x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2), outerF: K4.flatMap((a) => [a - LZ.j, a + LZ.j]), innerF: K4 },
    // 方胜：两只菱形左右相叠（相叠处那只小菱形框由窗芯补上，两只菱形就完整相扣）
    fangsheng: { name: "方胜", inside: unionIn(diamondIn(FS.h, -FS.c), diamondIn(FS.h, FS.c)), outerF: [22.5, 90, 157.5, 202.5, 270, 337.5, 0, 180], innerF: [fsT, 90, 180 - fsT, 180 + fsT, 270, 360 - fsT] },
    oct: { name: "八角", inside: octIn(OCT), outerF: O8, innerF: O8 },
  };
  const frameD = (k, rho = 0) => {
    const f = FRAMES[k], ro = polarOf(f.inside), ri = insetOf(ro, f.w || W);
    return contour(ro, N, f.outerF || [], rho) + contour(ri, N, f.innerF || [], rho);
  };

  // ---------- 窗芯（不转，屏幕朝向） ----------
  const CR = { w: 0.95, L: 8.2 };  // 十字棂：棂条宽 1.9，一直伸进窗框里，像真窗棂
  const FX = FS.h - FS.c;          // 方胜芯：两菱形相叠处的小菱形（外 4.4，孔 1.6）
  const CORES = {
    rui: { name: "花蕊", inside: circleIn(2.4) },
    haitang: { name: "小海棠", inside: unionIn(lobesIn(4, 3.1, 2.1), circleIn(2.2)), feats: D4 }, // 四瓣分得开：瓣间一直凹到花心
    cross: { name: "十字棂", inside: crossIn(CR.w, CR.L), feats: [...sym8(aDeg(CR.w, -CR.L)), ...D4] },
    crossShort: { name: "（过渡）短十字", inside: crossIn(CR.w, 3.1), feats: [...sym8(aDeg(CR.w, -3.1)), ...D4] },
    fang: { name: "小方", inside: boxIn(3.1), feats: D4 },
    shidi: { name: "柿蒂", r: (t) => { const x = offN(t, 4); return 1.5 + 3.9 * Math.pow(1 - x, 0.55) * (1 - 0.22 * x); }, feats: [...K4, ...D4] },
    shengxin: { name: "方胜芯", inside: diamondIn(FX), feats: K4, hole: diamondIn(FX - W * Math.SQRT2), holeF: K4 },
    guqian: { name: "古钱", inside: circleIn(4.6), hole: boxIn(1.6), holeF: [45, 135, 225, 315] }, // 外圆内方的钱纹
  };
  const coreD = (k) => {
    const c = CORES[k];
    return contour(c.r || polarOf(c.inside), N, c.feats || []) + (c.hole ? contour(polarOf(c.hole), NH, c.holeF || []) : dot(NH));
  };

  // ---------- 序列：7 拍，每拍 = 窗框先变（咔）→ 窗芯跟上（哒）→ 两层一起停住 ----------
  // rho：窗框 <g> 在这一拍的转角。方窗→菱窗整组咔哒转 45°；到八角那一拍停住的最后一刻，
  // <g> 在 1ms 里悄悄转回 0°——八角八重对称，转 45° 前后路径一字不差，看不出来；八角→海棠于是纯变形、不带拧。
  const SEQ = [
    { f: "haitang", c: "rui", rho: 0, hold: 0.24, name: "海棠窗" },
    { f: "moon", c: "haitang", rho: 0, hold: 0.18, name: "月洞 · 小海棠" },
    { f: "ya", c: "cross", rho: 0, hold: 0.18, name: "亚字 · 十字棂" },
    { f: "square", c: "fang", via: "crossShort", rho: 0, hold: 0.30, name: "回字（方窗 · 小方）" },
    { f: "lozenge", c: "shidi", rho: 45, hold: 0.18, name: "菱窗 · 柿蒂" },
    { f: "fangsheng", c: "shengxin", rho: 45, hold: 0.24, name: "方胜" },
    { f: "oct", c: "guqian", rho: 45, hold: 0.18, name: "八角 · 古钱" },
  ];
  const MF = 0.25, OC = 0.10, MC = 0.22, D = OC + MC; // 窗框变形 / 窗芯晚起 / 窗芯变形；一次转场 0.32s
  const SPL = ".77 0 .175 1", HOLD = "0 0 1 1";
  const T = SEQ.reduce((s, e) => s + e.hold, 0) + SEQ.length * D;
  const starts = []; { let t = 0; SEQ.forEach((e) => { t += e.hold; starts.push(t); t += D; }); } // 第 k 次转场（k → k+1）的起点

  // viaOf(k)：转场进入第 k+1 拍时途经的中间形（没有就 null）。十字棂 → 小方 先缩成短十字再补满四角，
  // 否则四根棂条会一边缩一边变尖，中途闪出一颗刺星。途经点两侧的缓动在中点速度相接，看上去仍是一口气。
  const VIA_IN = ".77 0 .9 .7", VIA_OUT = ".1 .3 .175 1";
  function track(valueOf, off, m, last, viaOf = () => null) {
    const n = SEQ.length, pts = [[0, valueOf(0), null]];
    for (let k = 0; k < n; k++) {
      const a = valueOf(k), b = k === n - 1 ? last : valueOf(k + 1);
      if (a === b) continue;
      const t0 = starts[k] + off, t1 = t0 + m, via = viaOf(k);
      if (t0 > pts[pts.length - 1][0] + 1e-9) pts.push([t0, a, HOLD]);
      if (via) { pts.push([t0 + m / 2, via, VIA_IN]); pts.push([t1, b, VIA_OUT]); } else pts.push([t1, b, SPL]);
    }
    if (pts[pts.length - 1][0] < T - 1e-9) pts.push([T, pts[pts.length - 1][1], HOLD]);
    const kt = pts.map((p) => +(p[0] / T).toFixed(4)); kt[kt.length - 1] = 1;
    return { keyTimes: kt.join(";"), keySplines: pts.slice(1).map((p) => p[2]).join(";"), values: pts.map((p) => p[1]) };
  }

  let cache = null;
  function build() {
    if (cache) return cache;
    const fd = SEQ.map((e) => frameD(e.f, e.rho));
    const cd = SEQ.map((e) => coreD(e.c));
    const doneFrame = fd[0], doneCore = cd[0]; // 完成态 = 第 0 拍 = 路径的基础 d
    const fT = track((k) => fd[k], 0, MF, fd[0]); // 最后一拍整组转到 90°：海棠四重对称，本地坐标下的 d 就是 fd[0]
    const cT = track((k) => cd[k], OC, MC, cd[0], (k) => (k + 1 < SEQ.length && SEQ[k + 1].via ? coreD(SEQ[k + 1].via) : null));
    const i45 = SEQ.findIndex((e) => e.rho === 45), iOct = SEQ.length - 1;
    const back = starts[iOct] - 0.001; // 八角停住的最后 1ms
    // 三下拧：海棠→月洞逆时针 90°（月洞是圆，看不出落点），方窗→菱窗顺时针 135°（最用力的一下），
    // 方胜→八角顺时针 90°。停住时：亚字/方窗 -90° 四重对称看不出；菱窗 45°；方胜 45° 和不转的胜心对得上；
    // 八角 135° 在停住最后 1ms 悄悄转回 0°（八角转 45° 的倍数看不出）。
    const rPts = [[0, 0, null],
      [starts[0], 0, HOLD], [starts[0] + MF, -90, SPL],
      [starts[i45 - 1], -90, HOLD], [starts[i45 - 1] + MF, 45, SPL],
      [starts[iOct - 1], 45, HOLD], [starts[iOct - 1] + MF, 135, SPL],
      [back, 135, HOLD], [starts[iOct], 0, HOLD], [T, 0, HOLD]];
    const rT = { keyTimes: rPts.map((p, i) => (i === rPts.length - 1 ? 1 : +(p[0] / T).toFixed(4))).join(";"), keySplines: rPts.slice(1).map((p) => p[2]).join(";"), values: rPts.map((p) => String(p[1])) };
    if (frameD("oct", 45) !== frameD("oct", 0)) throw new Error("八角转 45° 前后路径必须一致");
    const dur = `${+(T * HC_TIME_SCALE).toFixed(3)}s`;
    const an = (tag, attr, tr, extra = "", map = (v) => v) => `<${tag} attributeName="${attr}"${extra} dur="${dur}" repeatCount="indefinite" calcMode="spline" keyTimes="${tr.keyTimes}" keySplines="${tr.keySplines}" values="${tr.values.map(map).join(";")}"/>`;
    const svg = (inner, cls) => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;
    const thinking = svg(
      `<g>${an("animateTransform", "transform", rT, ' type="rotate"', (v) => `${v} 12 12`)}` +
      `<path class="hc-frame" fill-rule="evenodd" d="${doneFrame}">${an("animate", "d", fT)}</path></g>` +
      `<path class="hc-core" fill-rule="evenodd" d="${doneCore}">${an("animate", "d", cT)}</path>`, "huachuang");
    const done = svg(`<g><path class="hc-frame" fill-rule="evenodd" d="${doneFrame}"/></g><path class="hc-core" fill-rule="evenodd" d="${doneCore}"/>`, "huachuang is-done");
    cache = { thinking, done, fd, cd, fT, cT, rT, doneFrame, doneCore, T, starts };
    return cache;
  }

  // 结构校验：同一层每一帧（含基础 d）去掉数字后的命令序列必须一模一样
  function check() {
    const b = build(), sig = (d) => d.replace(/-?\d*\.?\d+/g, "#");
    const one = (name, list) => {
      const s = list.map(sig), cmds = list.map((d) => d.match(/[A-Za-z]/g).length), nums = list.map((d) => d.match(/-?\d*\.?\d+/g).length);
      return { name, frames: list.length, identical: s.every((x) => x === s[0]), commands: [...new Set(cmds)], numbers: [...new Set(nums)], subpaths: (list[0].match(/M/g) || []).length };
    };
    const kts = (tr) => { const k = tr.keyTimes.split(";").map(Number); return { values: tr.values.length, keyTimes: k.length, splines: tr.keySplines.split(";").length, increasing: k.every((v, i) => i === 0 || v > k[i - 1]), firstEqLast: tr.values[0] === tr.values[tr.values.length - 1] }; };
    return {
      frame: one("frame", [...b.fT.values, b.doneFrame]), core: one("core", [...b.cT.values, b.doneCore]),
      frameTrack: kts(b.fT), coreTrack: kts(b.cT), rotTrack: kts(b.rT), rotValues: b.rT.values.join(";"),
      seamFrameIdentical: b.fT.values[b.fT.values.length - 1] === b.fd[0],
      doneIsBase: b.done.includes(b.doneFrame) && b.thinking.includes(`d="${b.doneFrame}"`),
      bytesThinking: b.thinking.length, bytesDone: b.done.length, T: b.T,
    };
  }

  return { build, check, SEQ, FRAMES, CORES, T, MF, OC, MC, starts, frameD, coreD };
})();

// animated=false（减少动态效果）时给一张不动的橙色海棠窗
function reasoningIconMarkup({ done = false, animated = true } = {}) {
  const b = HUACHUANG.build();
  if (done) return b.done;
  return animated ? b.thinking : b.done.replace("huachuang is-done", "huachuang");
}

// 思考彩蛋换词的节拍（秒，相对图标自己的动画时钟）：一轮翻 4 次、两个词，每面停约 1.2s。
// 第 1、2 次拧换新词（英文），亚字→方窗和第 3 次拧翻出中文。
function reasoningIconBeats() {
  const s = HUACHUANG.starts.map((t) => t * HC_TIME_SCALE);
  return { cycle: HUACHUANG.T * HC_TIME_SCALE, fresh: [s[0], s[3]], flip: [s[2], s[5]] };
}

// 开窗收尾：缩到最小（170ms）时停掉动画、窗芯先藏起来，窗洞里放两扇窗扇（剪在海棠内圈里）；
// 弹回原大后窗扇贴着左右窗轴收起（scaleX），同时变灰；窗开到一半花蕊弹出来。
// 减少动态效果时不缩不推，直接换成灰色海棠窗。
function openReasoningWindow(svg, { reduced = false } = {}) {
  if (!svg || svg.classList.contains("is-done") || svg.classList.contains("is-finishing")) return;
  const stopAnimations = () => svg.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
  if (reduced) {
    stopAnimations();
    svg.classList.add("is-done");
    return;
  }
  svg.classList.add("is-finishing");
  setTimeout(() => {
    stopAnimations();
    const frame = svg.querySelector(".hc-frame");
    const core = svg.querySelector(".hc-core");
    if (!frame || !core) return;
    const inner = `M${frame.getAttribute("d").split("M")[2]}`; // 第二条子路径 = 窗框内圈
    const id = `hc-clip-${++reasoningClipSeq}`;
    const ns = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(ns, "defs");
    defs.innerHTML = `<clipPath id="${id}"><path d="${inner}"/></clipPath>`;
    const leaves = document.createElementNS(ns, "g");
    leaves.setAttribute("clip-path", `url(#${id})`);
    leaves.innerHTML = '<rect class="hc-leaf is-left" x="0" y="0" width="11.6" height="24"/><rect class="hc-leaf is-right" x="12.4" y="0" width="11.6" height="24"/>';
    core.classList.add("hc-pop", "is-hidden");
    svg.append(defs, leaves);
  }, 170);
  svg.addEventListener("animationend", () => {
    svg.classList.remove("is-finishing");
    requestAnimationFrame(() => {
      svg.classList.add("is-open", "is-done");
      setTimeout(() => svg.querySelector(".hc-core")?.classList.remove("is-hidden"), 300);
      setTimeout(() => { svg.querySelector(".hc-leaf")?.parentNode.remove(); svg.querySelector("defs")?.remove(); }, 600);
    });
  }, { once: true });
}
