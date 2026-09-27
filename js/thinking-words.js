// 思考彩蛋：思考时标题像单词卡一样换词——花窗一拧换一个英文词，下一扇窗翻出中文。
// 做饭 / 胡言乱语 / 磨蹭三组取自 Claude Code 自带的 spinner 动词；魔法、老邓头是自编的。
// 设置页在 js/thinking-settings.js；开关状态在 store.js。
const THINKING_SERIES = [
  { id: "cooking", name: "做饭系", words: [
    ["Baking…", "烘焙中"], ["Blanching…", "焯水中"], ["Brewing…", "酿造中"], ["Caramelizing…", "焦糖化中"],
    ["Churning…", "搅黄油中"], ["Concocting…", "调配秘方中"], ["Cooking…", "下厨中"], ["Drizzling…", "淋酱汁中"],
    ["Fermenting…", "发酵中"], ["Flambéing…", "火焰烧酒中"], ["Frosting…", "抹糖霜中"], ["Garnishing…", "摆盘点缀中"],
    ["Infusing…", "泡出味中"], ["Julienning…", "切丝中"], ["Kneading…", "揉面中"], ["Leavening…", "发面中"],
    ["Marinating…", "腌入味中"], ["Percolating…", "滴滤咖啡中"], ["Proofing…", "醒面中"], ["Sautéing…", "嫩煎中"],
    ["Seasoning…", "调味中"], ["Simmering…", "小火慢炖中"], ["Stewing…", "炖煮中"], ["Tempering…", "给巧克力调温中"],
    ["Whisking…", "打蛋中"], ["Zesting…", "刮柠檬皮中"],
  ] },
  { id: "nonsense", name: "胡言乱语系", words: [
    ["Befuddling…", "把自己绕晕中"], ["Bloviating…", "高谈阔论中"], ["Boondoggling…", "搞无用功中"],
    ["Canoodling…", "腻歪中"], ["Combobulating…", "把脑子接上中"], ["Discombobulating…", "脑子打结中"],
    ["Fiddle-faddling…", "瞎折腾中"], ["Finagling…", "耍小聪明中"], ["Flibbertigibbeting…", "叽叽喳喳中"],
    ["Flummoxing…", "被难住了中"], ["Honking…", "按喇叭中"], ["Hullaballooing…", "大呼小叫中"],
    ["Razzle-dazzling…", "闪瞎眼中"], ["Razzmatazzing…", "花里胡哨中"], ["Recombobulating…", "把脑子重新接好中"],
    ["Shenaniganing…", "搞小动作中"], ["Tomfoolering…", "犯傻中"], ["Topsy-turvying…", "天翻地覆中"],
    ["Whatchamacalliting…", "那个那个叫啥来着中"], ["Wibbling…", "胡说八道中"],
  ] },
  { id: "dawdle", name: "磨蹭系", words: [
    ["Dilly-dallying…", "磨磨蹭蹭中"], ["Gallivanting…", "到处闲逛中"], ["Lollygagging…", "磨洋工中"],
    ["Meandering…", "绕弯子中"], ["Moseying…", "慢悠悠晃荡中"], ["Noodling…", "随便琢磨中"],
    ["Perambulating…", "散步中"], ["Puttering…", "瞎鼓捣中"], ["Schlepping…", "拖拖拉拉中"],
    ["Skedaddling…", "开溜中"], ["Waddling…", "摇摇摆摆走中"], ["Wandering…", "神游中"],
  ] },
  { id: "magic", name: "魔法系", words: [
    ["Avada-Kedavra-ing…", "阿瓦达啃大瓜中"], ["Expecto-Patronum-ing…", "呼神护胃中（饿了）"],
    ["Expelliarmus-ing…", "除你 bug 中"], ["Alohomora-ing…", "阿拉霍脑洞开中"], ["Lumos-ing…", "灵光一闪中"],
    ["Accio-ing…", "答案飞来中"], ["Obliviate-ing…", "一忘皆空，忘了你问啥中"], ["Riddikulus-ing…", "把难题变滑稽中"],
    ["Wingardium-Leviosa-ing…", "悬浮中（是 Levi-O-sa）"], ["Sorting-Hatting…", "分院帽嘀咕中"],
    ["Owl-Posting…", "猫头鹰送信中"], ["Cauldron-Stirring…", "搅坩埚中"], ["Potion-Brewing…", "熬魔药中"],
    ["Broomsticking…", "骑扫帚兜风中"], ["Wand-Waving…", "挥魔杖中"], ["Spell-Checking…", "检查咒语中"],
    ["Crystal-Balling…", "盯水晶球中"], ["Abracadabra-ing…", "变变变中"], ["Hocus-Pocusing…", "变戏法中"],
    ["Transfiguring…", "变形术中"], ["Levitating…", "飘起来中"], ["Enchanting…", "施魔法中"],
  ] },
  { id: "dumbledore", name: "老邓头系", words: [
    ["Asking-Calmly-ing…", "邓布利多平静地问中"], ["Lemon-Drop-ing…", "来颗柠檬雪宝中"],
    ["Pensieve-Diving…", "一头扎进冥想盆中"], ["Wishing-for-Socks…", "魔镜里只看见一双厚袜子中"],
    ["Last-Minute-Pointing…", "最后一刻给格兰芬多加分中"], ["Fawkes-Calling…", "呼叫福克斯中"],
    ["Bertie-Botts-ing…", "吃到耳屎味比比多味豆中"], ["Nitwit! Blubber! Oddment! Tweak!", "笨蛋！哭鼻子！残渣！拧！"],
    ["Knitting-Pattern-Reading…", "研究编织花样中"], ["Knowingly-Winking…", "意味深长地眨眼中"],
    ["Turning-on-the-Light…", "最黑暗的时候，记得开灯中"],
  ] },
];
const THINKING_PLAIN = { en: "Thinking…", zh: "正在思考中" };
const THINKING_MARAUDER_OPEN = { en: "I solemnly swear that I am up to no good", zh: "我庄严宣誓我不干好事" };
const THINKING_MARAUDER_DONE = { en: "Mischief managed", zh: "恶作剧完毕" };
const THINKING_FLIP_MS = 130;

function loadThinkingSeriesOff() {
  try {
    const list = JSON.parse(localStorage.getItem(THINKING_SERIES_OFF_KEY) || "[]");
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function normalizeThinkingWords(words) {
  return (Array.isArray(words) ? words : [])
    .filter((w) => w && typeof w.en === "string" && w.en.trim())
    .map((w) => ({ en: w.en.trim(), zh: typeof w.zh === "string" ? w.zh.trim() : "" }));
}

function loadThinkingCustomSeries() {
  try {
    const list = JSON.parse(localStorage.getItem(THINKING_CUSTOM_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
      .map((item) => ({ id: item.id, name: item.name, words: normalizeThinkingWords(item.words) }));
  } catch {
    return [];
  }
}

// 内置系列改过的版本：{ [id]: { name?, words? } }；没改过的就用代码里的原版
function loadThinkingOverrides() {
  try {
    const map = JSON.parse(localStorage.getItem(THINKING_OVERRIDES_KEY) || "{}");
    if (!map || typeof map !== "object" || Array.isArray(map)) return {};
    const out = {};
    for (const [id, value] of Object.entries(map)) {
      if (!THINKING_SERIES.some((s) => s.id === id) || !value || typeof value !== "object") continue;
      out[id] = {
        ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
        ...(Array.isArray(value.words) ? { words: normalizeThinkingWords(value.words) } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

// 内置 + 自定义，统一成 { id, name, custom, edited, words: [{ en, zh }] }
function thinkingAllSeries() {
  return [
    ...THINKING_SERIES.map((s) => {
      const o = thinkingSeriesOverrides[s.id] || {};
      return {
        id: s.id,
        name: o.name || s.name,
        custom: false,
        edited: Boolean(o.name || o.words),
        words: o.words || s.words.map(([en, zh]) => ({ en, zh })),
      };
    }),
    ...thinkingCustomSeries.map((s) => ({ ...s, custom: true, edited: false })),
  ];
}

function thinkingWordPool() {
  return thinkingAllSeries().filter((s) => !thinkingSeriesOff.has(s.id)).flatMap((s) => s.words);
}

function thinkingDoneWord() {
  return thinkingEggEnabled && thinkingMarauder ? THINKING_MARAUDER_DONE : null;
}

// 历史记录里重建的思考块用：跟实时收尾停住的那一面一致
function thinkingDoneTitle() {
  const word = thinkingDoneWord();
  if (!word) return "思考完成";
  return thinkingTranslate ? word.zh : word.en;
}

function thinkingReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

// 翻卡片：往上翻走一半，换字，再翻回来；减少动态效果时直接换字
function setThinkingWord(face, text, { animate = true } = {}) {
  if (face.textContent === text) return;
  if (!animate || thinkingReducedMotion()) {
    face.textContent = text;
    return;
  }
  face.classList.add("is-flipping");
  setTimeout(() => {
    face.textContent = text;
    face.classList.remove("is-flipping");
  }, THINKING_FLIP_MS);
}

// 实时思考块的标题控制器：按图标自己的动画时钟对拍（拧 → 换新词，下一扇 → 翻中文）
function startThinkingTitle(title, svg, root) {
  title.textContent = "";
  const face = document.createElement("span");
  face.className = "reasoning-word";
  title.appendChild(face);

  const pool = thinkingEggEnabled ? thinkingWordPool() : [];
  let bag = [];
  const nextWord = () => {
    if (!pool.length) return THINKING_PLAIN;
    if (!bag.length) bag = pool.slice().sort(() => Math.random() - 0.5);
    return bag.pop();
  };
  const beats = reasoningIconBeats();
  const events = [
    ...beats.fresh.map((at) => ({ at, type: "fresh" })),
    ...beats.flip.map((at) => ({ at, type: "flip" })),
  ].sort((a, b) => a.at - b.at);
  const startedAt = performance.now();
  const clock = () => {
    try {
      if (svg?.querySelector("animate")) return svg.getCurrentTime();
    } catch { /* 取不到图标时钟就用自己的 */ }
    return (performance.now() - startedAt) / 1000;
  };

  let current = thinkingEggEnabled && thinkingMarauder ? THINKING_MARAUDER_OPEN : nextWord();
  let skipFresh = true; // 开头已经亮出第一个词，第一次拧不再换
  let timer = 0;
  let stopped = false;
  setThinkingWord(face, current.en, { animate: false });

  const schedule = () => {
    const now = clock();
    const phase = now % beats.cycle;
    const next = events.find((e) => e.at > phase + 0.01) || { ...events[0], at: events[0].at + beats.cycle };
    timer = setTimeout(() => {
      if (stopped) return;
      if (!root.isConnected) { stopped = true; return; }
      if (next.type === "fresh") {
        if (skipFresh) skipFresh = false;
        else { current = nextWord(); setThinkingWord(face, current.en); }
      } else if (thinkingTranslate && current.zh) {
        skipFresh = false;
        setThinkingWord(face, current.zh);
      }
      schedule();
    }, Math.max(16, (next.at - phase) * 1000));
  };
  schedule();

  return {
    finish() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      const done = thinkingDoneWord();
      if (!done) { setThinkingWord(face, "思考完成"); return; }
      setThinkingWord(face, done.en);
      if (thinkingTranslate) setTimeout(() => setThinkingWord(face, done.zh), 800);
    },
  };
}
