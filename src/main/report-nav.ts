/**
 * 报告目录（主进程注入，不动 React 组件树）。
 *
 * 为什么需要：一份诊断报告的主区实测高 18327px、18 个一级区块，
 * 「判读」排在第 7 节、位于 y≈9248px。打开报告后要滚十屏才看得见它判了什么，
 * 而界面原本既没有目录，也没有「现在读到哪」的指示。
 *
 * 目录之后补的第二层：区块折叠。目录解决「找得到」，但正文仍约两万像素高；
 * 收起暂时不看的节，是读者自己缩短报告，不是软件替他删或排优先级。
 *
 * 第三层：逐节读。目录与折叠都把主动权交给读者，但第一次打开一份两万像素的
 * 报告时，读者仍不知道「从哪开始、读完这一节下一节在哪」。逐节读按报告**原有顺序**
 * 一次展开一节，给上一节 / 下一节；它不挑节、不排序、不给阅读建议，只是把节奏收窄。
 *
 * 边界（刻意守住）：
 * · 只做导航与显示，不新增、不改写、不排序任何一个判定字。区块名逐字取自 .block-head .t。
 * · 默认全展开；「全部收起 / 全部展开」是中性开关，快捷键也一样。软件不预设哪一节重要。
 * · 「先看判读」是一个跳转按钮，不是替读者排优先级：其余 17 节原样列在目录里。
 * · 逐节读是临时状态，不写进 localStorage；退出时把读者自己收过的节原样还回去。
 *   报告一换（指纹变）就自动退出，绝不把上一份的阅读位置套到新报告上。
 * · 折叠只切 data 属性 + CSS，不改 React 组件；重渲染后重新贴回，内容一个字不动。
 * · Diagnosis.tsx 的组件数被 check:arch 冻结在 18，所以走主进程 executeJavaScript，
 *   与工作台入口同一层；撤掉只需删掉 index.ts 里那一处调用。
 * · 空态（没有 .block-head）时整块隐藏，不给首屏添东西。
 */

export const REPORT_NAV_SCRIPT = String.raw`(function(){
  if (window.__alNavBooted) return;
  window.__alNavBooted = true;

  var ID = '__alNav';
  var st = document.createElement('style');
  st.textContent = [
    /* 目录 232px + right 18px + 间隙 16px = 266px：正文补偿必须跟着宽度走，
       改宽度不改补偿会遮住正文最后几个字。这条等式由 check:density 守着。 */
    'body.al-nav-open .main{padding-right:266px}',
    '#__alNav{position:fixed;right:18px;top:56px;bottom:54px;width:232px;z-index:2147483000;display:flex;flex-direction:column;background:rgba(255,255,255,.97);border:1px solid #ded9cd;border-radius:8px;box-shadow:0 6px 22px rgba(45,40,30,.10);font:11.5px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#4a453c;overflow:hidden}',
    '#__alNav .nh{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #ece7dc;flex:none}',
    '#__alNav .nh b{font-weight:600;font-size:11.5px;letter-spacing:.03em;flex:1;white-space:nowrap}',
    '#__alNav .nh button{border:0;background:none;cursor:pointer;color:#8a8275;font:13px system-ui;padding:2px 5px;line-height:1}',
    '#__alNav .nh button:hover{color:#2c3a49}',
    '#__alNav .nprog{height:3px;background:#eee9de;flex:none}',
    '#__alNav .nprog i{display:block;height:100%;width:0;background:#b98a4a;transition:width .12s linear}',
    /* 「接着读」：只在这份报告有记录时出现，样式上比「先看判读」更轻——
       它是回忆，不是建议。 */
    '#__alNav .nresume{margin:8px 8px 0;padding:7px 9px;border:1px solid #cfdde9;border-radius:5px;background:#eff5fa;color:#2c3a49;cursor:pointer;font:11.5px/1.45 system-ui;text-align:left;flex:none}',
    '#__alNav .nresume:hover{background:#e3eef7}',
    '#__alNav .nresume b{display:block;font-weight:600;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#__alNav .nresume span{display:block;color:#6d7b89;font-size:10.5px;margin-top:2px}',
    '#__alNav .njump{margin:8px 8px 4px;padding:7px 9px;border:1px solid #d8cdb6;border-radius:5px;background:#faf6ee;color:#5a4b32;cursor:pointer;font:11.5px system-ui;text-align:left;flex:none}',
    '#__alNav .njump:hover{background:#f1e7d3}',
    '#__alNav .nlist{overflow-y:auto;flex:1;min-height:0;padding:2px 6px 6px;scrollbar-width:thin}',
    '#__alNav .ni{display:flex;gap:7px;align-items:baseline;width:100%;text-align:left;border:0;background:none;padding:5px 6px;border-radius:4px;cursor:pointer;color:#6b6458;font:11.5px/1.4 system-ui}',
    '#__alNav .ni:hover{background:#f3f0e9}',
    '#__alNav .ni.on{background:#e9eff5;color:#2c3a49;font-weight:600}',
    '#__alNav .ni i{font-style:normal;color:#a9a294;font:10.5px/1.6 ui-monospace,monospace;flex:none;width:16px}',
    '#__alNav .ni span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#__alNav .nf{padding:6px 10px;border-top:1px solid #ece7dc;color:#9a9284;font:10.5px system-ui;display:flex;justify-content:space-between;gap:6px;flex:none}',
    '#__alNav .nf button{border:0;background:none;color:#7a8b9c;cursor:pointer;font:10.5px system-ui;padding:0}',
    '#__alNav .nf button:hover{color:#2c3a49}',
    '#__alNav.al-nav-min{width:34px;bottom:auto}',
    '#__alNav.al-nav-min .nh{flex-direction:column;padding:9px 6px;border:0;gap:9px}',
    '#__alNav.al-nav-min .nh b{writing-mode:vertical-rl;letter-spacing:.18em;font-size:11px;flex:none}',
    '#__alNav.al-nav-min .nprog,#__alNav.al-nav-min .njump,#__alNav.al-nav-min .nresume,#__alNav.al-nav-min .nfoldbar,#__alNav.al-nav-min .nreadbar,#__alNav.al-nav-min .nlist,#__alNav.al-nav-min .nf{display:none}',
    '#__alNav .nfoldbar{display:flex;gap:6px;padding:0 8px 6px;flex:none}',
    '#__alNav .nfoldbar button{flex:1;border:1px solid #e6e0d3;border-radius:4px;background:#fbf9f4;color:#6b6458;cursor:pointer;font:10.5px system-ui;padding:4px 0}',
    '#__alNav .nfoldbar button:hover{background:#f1e7d3;color:#5a4b32}',
    '#__alNav .nreadbar{padding:5px 8px 7px;flex:none;border-top:1px solid #ece7dc}',
    '#__alNav .nreadbar .r1,#__alNav .nreadbar .r2{display:flex;gap:6px;margin-bottom:5px}',
    '#__alNav .nreadbar button{flex:1;border:1px solid #e6e0d3;border-radius:4px;background:#fbf9f4;color:#6b6458;cursor:pointer;font:10.5px system-ui;padding:4px 0}',
    '#__alNav .nreadbar button:hover:not(:disabled){background:#f1e7d3;color:#5a4b32}',
    '#__alNav .nreadbar button:disabled{opacity:.4;cursor:default}',
    '#__alNav .nreadbar button.on{background:#e9eff5;border-color:#c9d8e6;color:#2c3a49;font-weight:600}',
    '#__alNav .nrnote{font:10px/1.4 system-ui;color:#9a9284}',
    '#__alNav .ni em{font-style:normal;margin-left:auto;flex:none;color:#a87636;background:#faf1e2;border-radius:7px;padding:0 4px;font:9.5px/1.5 ui-monospace,monospace}',
    '#__alNav .ni.fold span,#__alNav .ni.fold em{opacity:.5}',
    '#__alNav .ni.fold i{color:#c4bcae}',
    '.block-head{scroll-margin-top:10px}',
    /* 从异议账跳过来时短暂描一圈：只看滚动落点分不清「跳到了哪一节」，
       尤其是相邻两节都展开着的时候。 */
    '.al-jump-hit{outline:2px solid #b98a4a;outline-offset:3px;border-radius:4px}',
    '.block-head .alFoldBtn{margin-left:auto;flex:none;border:0;background:none;cursor:pointer;color:#a09a8d;font:12px system-ui;line-height:1;padding:0 2px}',
    '.block-head .alFoldBtn:hover{color:#2c3a49}',
    'body.al-fold-on section.block[data-al-fold="1"] > .block-plain,body.al-fold-on section.block[data-al-fold="1"] > .block-body{display:none!important}',
    'body.al-fold-on section.block[data-al-fold="1"] > .block-head{border-bottom:0}'
  ].join('');
  document.head.appendChild(st);

  function el(tag, cls, txt){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  var panel = el('div'); panel.id = ID;
  var head = el('div', 'nh');
  var title = el('b', '', '报告目录');
  var minBtn = el('button', '', '›');
  minBtn.title = '收起目录';
  head.appendChild(title); head.appendChild(minBtn);
  var prog = el('div', 'nprog'); var progI = el('i'); prog.appendChild(progI);
  /*
   * 「接着读」：这份报告上次停在第七节，重开时不必从标题重新找起。
   * 默认隐藏，只有这一份报告在本地真有记录时才出现——没有记录时不给一句
   * 「暂无阅读记录」的空话。点了才跳，打开报告时绝不自动滚过去。
   */
  var resume = el('button', 'nresume');
  resume.type = 'button';
  resume.style.display = 'none';
  var jump = el('button', 'njump', '→ 先看判读');
  var fbar = el('div', 'nfoldbar');
  /* 报告开头还有一些不属于 18 个 Block 的说明区，它们不参与折叠；
     文案说「全部区块」而不是「全部」，免得按钮说谎。 */
  var foldAllBtn = el('button', '', '收起全部区块');
  var unfoldAllBtn = el('button', '', '展开全部区块');
  fbar.appendChild(foldAllBtn); fbar.appendChild(unfoldAllBtn);
  /*
   * 逐节读：给第一次打开长报告的人一个能走下去的节奏。
   * 顺序严格按 .block-head 在 DOM 里的先后，不按「重要性」重排。
   * 「上一节 / 下一节」在普通模式下也可用，只跳转、不改读者自己的折叠状态。
   */
  var rbar = el('div', 'nreadbar');
  var r1 = el('div', 'r1'), r2 = el('div', 'r2');
  var readBtn = el('button', '', '▤ 逐节读');
  readBtn.title = '按报告原顺序一次展开一节；再点一次退出，还原你收过的节';
  var prevBtn = el('button', '', '‹ 上一节');
  var nextBtn = el('button', '', '下一节 ›');
  r1.appendChild(readBtn);
  r2.appendChild(prevBtn); r2.appendChild(nextBtn);
  var rnote = el('div', 'nrnote', '按报告原来的顺序，不替你挑哪一节重要。');
  rbar.appendChild(r1); rbar.appendChild(r2); rbar.appendChild(rnote);
  var list = el('div', 'nlist');
  var foot = el('div', 'nf');
  var footN = el('span', '', '—');
  var topBtn = el('button', '', '↑ 回到开头');
  foot.appendChild(footN); foot.appendChild(topBtn);
  panel.appendChild(head); panel.appendChild(prog); panel.appendChild(resume); panel.appendChild(jump);
  panel.appendChild(fbar); panel.appendChild(rbar); panel.appendChild(list); panel.appendChild(foot);
  document.body.appendChild(panel);

  var MAIN = null, HEADS = [], LAST_COUNT = -1, CUR = -1, VERDICT = -1, timer = null;
  var FOLDED = [], FP = '', FOLD_KEY = 'alFold.v1';
  var READING = false, SAVED = null, LAST_ID = '';

  function textOf(h){
    var t = h.querySelector('.t') || h;
    return String(t.textContent || '').replace(/\s+/g, ' ').trim() || '（未命名）';
  }

  /* ── 区块折叠 ───────────────────────────────────────────────
     每个区块是 <section class="block">，head / plain / body 三个孩子。
     只切 section 上的 data 属性，React 重渲染覆盖 className 也带不走它；
     按钮与属性丢了由 MutationObserver 重贴。文字一个字都不碰。 */
  function sectionOf(h){
    var p = h.parentElement;
    return p && p.classList && p.classList.contains('block') ? p : null;
  }
  /* 区块标题是固定模板，单靠标题区分不了报告；必须把正文算进去，
     否则上一份收起的节会被套到一份新报告上，等于软件替人做了默认。 */
  function fpOf(){
    var s = String(HEADS.length) + '#';
    var bs = MAIN ? MAIN.querySelectorAll('.block-body') : [];
    for (var i = 0; i < bs.length; i++) s += bs[i].textContent;
    var h = 0;
    for (var j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) | 0;
    return HEADS.length + ':' + s.length + ':' + h;
  }
  function loadFold(fresh){
    FOLDED = [];
    for (var i = 0; i < HEADS.length; i++) FOLDED.push(0);
    FP = fpOf();
    /* 换报告走显式通知：不读上一份留下的收起状态，直接全展开并写回。
       同一份报告里的结构性重扫仍可恢复读者自己收过的节。 */
    if (fresh) { saveFold(); return; }
    try {
      var o = JSON.parse(localStorage.getItem(FOLD_KEY) || 'null');
      /* 只恢复同一份报告里读者自己收过的节；新报告一律全展开。 */
      if (o && o.fp === FP && o.f && o.f.length === FOLDED.length) {
        FOLDED = o.f.map(function(x){ return x ? 1 : 0; });
      }
    } catch (e) { /* @allow-silent: 存储被禁用或数据损坏时回到默认全展开，不影响阅读 */ }
  }
  function saveFold(){
    /* 逐节读期间只展开一节，这是临时视图，不该写进「读者收过哪些节」。
       否则中途关掉应用，下次打开就只剩一节是展开的，像软件替人做了决定。 */
    if (READING) return;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify({ fp: FP, f: FOLDED })); }
    catch (e) { /* @allow-silent: 记不住折叠状态只影响下次重开，当前会话照常可用 */ }
  }
  function applyFold(){
    for (var i = 0; i < HEADS.length; i++) {
      var sec = sectionOf(HEADS[i]);
      if (sec) {
        if (FOLDED[i]) {
          if (sec.getAttribute('data-al-fold') !== '1') sec.setAttribute('data-al-fold', '1');
        } else if (sec.hasAttribute('data-al-fold')) {
          sec.removeAttribute('data-al-fold');
        }
      }
      var b = HEADS[i].querySelector('.alFoldBtn');
      if (b) {
        var want = FOLDED[i] ? '▸' : '▾';
        if (b.textContent !== want) b.textContent = want;
        var tt = FOLDED[i] ? '展开这一节' : '收起这一节';
        if (b.title !== tt) b.title = tt;
      }
      var item = list.children[i];
      if (item) item.className = (i === CUR ? 'ni on' : 'ni') + (FOLDED[i] ? ' fold' : '');
    }
    document.body.classList.toggle('al-fold-on', HEADS.length > 0);
  }
  /* ── 阅读位置 ───────────────────────────────────────────────
     一份报告两万像素，「上次停在第七节」是一件只有本地知道的事——报告里没有这一句。
     四条规则都是为了让这句话不变成假话：
       · 按报告 id 分开记。换一份报告绝不沿用上一份的位置，否则会把 A 的第七节说成 B 的。
       · 停在第一节不记。报告一打开就停在那里，记下来等于把上一次真读到的地方抹掉。
       · 记的是「滚到哪」，不是「读了什么」，也不推断有没有读完。
       · 记录指向的那一节不在了就什么都不说——说「第 12 节」而报告只有 9 节，比不说更糟。
     显示只在打开报告时一次（scan 末尾），读到一半不会突然冒出来打断。
     打开时绝不自动滚过去：从哪一读起是读者的事，软件只留一条回得去的路。 */
  var POS_KEY = 'alPos.v1', POS_MAX = 40, MARKS = {}, POS_READY = false, posTimer = null;
  /* 最近一次「点着去」的那一节与它的有效期，见 recordPos。 */
  var GOTO_I = -1, GOTO_UNTIL = 0;
  /* 点「接着读」时落到的节内某一块（没有就是节首），见 focusSection / recordPos。 */
  var GOTO_SEG = null;
  /* 上一次记下的节内块序号；-2 是「还没算过」，见 update() 里那段。
     记它是因为「同一节里往下读三屏」不发 CUR 变化事件，只靠节号更新会漏掉整个节内。 */
  var LAST_SEG = -2;

  function loadMarks(){
    if (POS_READY) return;
    POS_READY = true;
    try {
      var o = JSON.parse(localStorage.getItem(POS_KEY) || '{}');
      if (o && typeof o === 'object') MARKS = o;
    } catch (e) { /* @allow-silent: 记录损坏就当没有记录，不给读者看一段坏数据的解释 */ }
  }
  function saveMarks(){
    try { localStorage.setItem(POS_KEY, JSON.stringify(MARKS)); }
    catch (e) { /* @allow-silent: 记不住位置只影响下次重开，当前这次阅读照常 */ }
  }
  /* 只留最近 POS_MAX 份：这是「上次看到哪」，不是书签管理器。不设上限的话，
     这个键会随报告数一直长下去，而它每次读写都是同步的。 */
  function trimMarks(){
    var ks = Object.keys(MARKS);
    if (ks.length <= POS_MAX) return;
    ks.sort(function(a, b){ return (MARKS[a].t || 0) - (MARKS[b].t || 0); });
    for (var i = 0; i < ks.length - POS_MAX; i++) delete MARKS[ks[i]];
  }
  /* ── 节内哪一段 ─────────────────────────────────────────────
     「第 7 节」只是半句话：一节常有三四屏，重开又回到节首，读者还得自己再找一遍刚才那一处。
     所以再记一个「块」——节正文的直接子块里，正压着视口顶线的那个。
     记录里放两样：序号 k 与它开头二十几个字的指纹 x。为什么两样都要：
     序号会在报告重跑后失效（多一条主张就整体后移），指纹单独用又会认错（两段开头一样）。
     合起来的规矩是——序号指到的那个块，开头对不上就当没记过：宁可只说「第 7 节」，
     也不能把人带到别人的第三段，因为这个软件只有本地知道「上次停在哪」，说错了没处核对。
     正文只有一块的节不记：那里「第 1 段」等于「这一节」，说了等于没说。 */
  var SEG_TXT = 24;
  /* 认的是 24 字，给人看的是 12 字：面板只有 250px 宽，24 字要占两行，
     而那两行下面还有「先看判读」「上一节 / 下一节」。认错的风险在比对上，
     不在显示上——完整那句还在悬停提示里。 */
  var SEG_SHOW = 12;
  function segsOf(i){
    var sec = sectionOf(HEADS[i]);
    var box = sec ? (sec.querySelector('.block-body') || sec) : null;
    var out = [];
    if (!box) return out;
    for (var c = box.firstElementChild; c; c = c.nextElementSibling) out.push(c);
    return out;
  }
  function segAt(i, k){
    var s = segsOf(i);
    return k >= 0 && k < s.length ? s[k] : null;
  }
  function segText(n){
    return String(n && n.textContent || '').replace(/\s+/g, ' ').trim();
  }
  /* 顶线只此一份：update() 判当前节、这里判当前块，用的必须是同一条线，
     否则「高亮在第 7 节、记下的却是第 6 节的最后一块」这种事没人看得出来。 */
  function topLine(){
    return (MAIN ? MAIN.getBoundingClientRect().top : 0) + 72;
  }
  function segIndexAt(i){
    var s = segsOf(i);
    if (s.length < 2) return -1;
    var line = topLine(), k = -1;
    for (var j = 0; j < s.length; j++) {
      if (s[j].getBoundingClientRect().top <= line) k = j;
    }
    return k < 0 ? 0 : k;
  }
  function segMark(i, minK){
    var k = segIndexAt(i);
    /* minK 是「低于这个序号就不算」：刚点过目录落到节首时，第一块并没有被读，
       记成「第 1 段」等于替人认了一次没发生的阅读。但同一次里往下滚到第 4 块，
       那就要记——窗口只该管「哪一节」，不该把节内位置一起抹掉（冒烟第一次跑就是这里红的）。 */
    if (k < 0 || k < (minK || 0)) return null;
    var x = segText(segAt(i, k)).slice(0, SEG_TXT);
    /* 空块（只有一张图、一个按钮）记下来也说不清是哪——不记，比记一个空串好。 */
    return x ? { k: k, x: x } : null;
  }
  /* 点到手的那一块：不靠顶线回头再算一次，直接按它在这一节里的位置记。
     点了「接着读」之后顶线那一刻可能还没停稳（平滑滚动），回头算会算成上一块。 */
  function segMarkOf(el, i){
    var s = segsOf(i), k = s.indexOf(el);
    if (k < 0) return null;
    var x = segText(el).slice(0, SEG_TXT);
    return x ? { k: k, x: x } : null;
  }
  /* 记录里的那一块今天还在不在：序号取到、且开头逐字对得上。 */
  function segFrom(m){
    if (!m || !m.seg || typeof m.seg.k !== 'number' || !m.seg.x) return null;
    var n = segAt(m.i, m.seg.k);
    return n && segText(n).slice(0, SEG_TXT) === String(m.seg.x) ? n : null;
  }
  function recordPos(){
    if (!LAST_ID || !HEADS.length) return;
    /* 刚点过目录就以「点的哪一节」为准。
       平滑滚动是一帧一帧走的：350ms 那个瞬间视口常常还停在前一节，
       照那一刻的 CUR 记下去，就成了「你停在第五节」，而人明明点的是第七节——
       下一次重开，那句话会把他带到错的地方（第一次跑冒烟就是这么红的）。 */
    var i = GOTO_I >= 0 && Date.now() < GOTO_UNTIL ? GOTO_I : CUR;
    if (i <= 0 || i >= HEADS.length) {
      /*
       * 回到开头，就是「上次读到第 2 节」作废了。
       *
       * 只停在这里不写还不够：跳一下立案卡、再滚回报告开头，中途那一帧压在第 2 节上
       * 就写进了一条记录；人明明回到开头，重开时却被告知「上次读到第 2 节」。
       * 这条记录没有第二处能核对，说错了就是一句查不出的假话，所以回到第 1 节时
       * 把它撤掉——第一节本来就不记，作废的旧记录也不该留着。
       */
      if (i === 0 && LAST_ID) {
        loadMarks();
        if (MARKS[LAST_ID]) { delete MARKS[LAST_ID]; saveMarks(); syncResume(); }
      }
      return;
    }
    loadMarks();
    /* 刚点过目录时落到的是节首，第一块没被读过，所以只从第二块起才记；
       同一次里读者往下滚到某一块，那是真读了，照记。
       点「接着读」落到的那一块是点出来的，直接记它。 */
    var byClick = GOTO_I >= 0 && Date.now() < GOTO_UNTIL;
    MARKS[LAST_ID] = {
      i: i, t: Date.now(), title: textOf(HEADS[i]),
      seg: byClick ? (GOTO_SEG ? segMarkOf(GOTO_SEG, i) : segMark(i, 1)) : segMark(i)
    };
    trimMarks(); saveMarks();
  }
  /* 隔 350ms 再写：平滑滚动会连着穿过好几节，逐节写盘是把中间站也记成「读到哪」。
     这一句只影响存哪个数，不影响界面高亮。 */
  function schedulePos(){
    clearTimeout(posTimer);
    posTimer = setTimeout(recordPos, 350);
  }
  function whenText(t){
    if (!t) return '时间不明';
    var ms = Date.now() - t;
    if (ms < 0) return '时间不明';
    var d = Math.floor(ms / 86400000);
    if (d < 1) return '今天';
    if (d === 1) return '昨天';
    if (d < 7) return d + ' 天前';
    if (d < 60) return Math.floor(d / 7) + ' 周前';
    return new Date(t).toLocaleDateString();
  }
  function syncResume(){
    loadMarks();
    var m = LAST_ID ? MARKS[LAST_ID] : null;
    if (!m || !HEADS.length || !(m.i > 0) || m.i >= HEADS.length) {
      resume.style.display = 'none';
      resume.removeAttribute('data-resume');
      resume.removeAttribute('data-seg');
      return;
    }
    /* 节内那一段还在不在（序号 + 指纹都对上）。对不上就退回「只说节」：
       报告重跑过、这一节重排过，这时指着「第 3 段」是替一份新报告认了一个不存在的段。 */
    var segEl = segFrom(m);
    var k = segEl ? m.seg.k : -1;
    var tt = textOf(HEADS[m.i]);
    resume.setAttribute('data-resume', String(m.i + 1));
    resume.textContent = '';
    resume.appendChild(el('b', '', '接着读：第 ' + (m.i + 1) + ' 节 · ' + tt));
    if (segEl) {
      var sTxt = segText(segEl);
      resume.setAttribute('data-seg', String(k + 1));
      resume.appendChild(el('span', '', '上次读到第 ' + (k + 1) + ' 段「' + sTxt.slice(0, SEG_SHOW)
        + (sTxt.length > SEG_SHOW ? '…' : '') + '」（' + whenText(m.t) + '）。点了跳到那一段，不会自动跳。'));
      resume.title = '上次读到第 ' + (m.i + 1) + ' 节「' + tt + '」第 ' + (k + 1) + ' 段「'
        + sTxt.slice(0, SEG_TXT) + '」';
      resume.onclick = function(){ goTo(m.i, segEl); };
    } else {
      /* 记过段、这次没找到：明写出来。悄悄退回节首，人会发现位置不对，却不知道为什么。 */
      if (m.seg) {
        resume.setAttribute('data-seg', '');
        resume.appendChild(el('span', '', '上次读到这一节的第 ' + (m.seg.k + 1)
          + ' 段，那一段这次没找到（报告可能重跑过）。点了只跳到这一节。（' + whenText(m.t) + '）'));
        resume.title = '上次读到第 ' + (m.i + 1) + ' 节「' + tt + '」的中间，那一段这次没找到';
      } else {
        resume.removeAttribute('data-seg');
        resume.appendChild(el('span', '', '上次读到这里（' + whenText(m.t) + '）。点了才跳，不会自动跳。'));
        resume.title = '上次读到第 ' + (m.i + 1) + ' 节「' + tt + '」';
      }
      resume.onclick = function(){ goTo(m.i); };
    }
    resume.style.display = '';
  }

  function setFold(i, v){    if (i < 0 || i >= FOLDED.length || !!FOLDED[i] === !!v) return;
    FOLDED[i] = v ? 1 : 0;
    applyFold(); saveFold(); update();
  }
  function setAll(v){
    /* 「收起 / 展开全部」与逐节读互斥：两个都改 FOLDED，留着会互相覆盖。 */
    if (READING) exitRead(false);
    for (var i = 0; i < FOLDED.length; i++) FOLDED[i] = v ? 1 : 0;
    applyFold(); saveFold(); update();
  }

  /* ── 逐节读 ───────────────────────────────────────────────
     只改 FOLDED 与滚动位置，不改任何文字，也不重排节。
     退出时把进入前读者自己收过的节原样还回去；因为逐节读期间不写盘，
     换一份报告后 loadFold() 读到的仍是「进入前」那份状态，不会串到新报告上。 */
  function syncReadUI(){
    readBtn.textContent = READING ? '□ 退出逐节读' : '▤ 逐节读';
    readBtn.classList.toggle('on', READING);
    readBtn.disabled = !HEADS.length;
    prevBtn.disabled = !HEADS.length || CUR <= 0;
    nextBtn.disabled = !HEADS.length || CUR >= HEADS.length - 1;
    rnote.textContent = READING
      ? '只展开这一节，其余按原顺序排队。'
      : '按原顺序，不替你挑重点。';
  }
  function focusSection(i, land){
    CUR = i;
    if (READING) {
      for (var j = 0; j < FOLDED.length; j++) FOLDED[j] = j === i ? 0 : 1;
      applyFold(); /* 故意不 saveFold：临时视图不写盘 */
    } else {
      setFold(i, 0);
    }
    /* 只滚一次就落到终点。先落到节首再落到段，长报告上会「先滑过去、再滑回来」，
       看起来像点错了又被纠正。land 是节内某一块时，节首自然落在它上面一点。 */
    var t = land && land.scrollIntoView ? land : HEADS[i];
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    GOTO_I = i; GOTO_UNTIL = Date.now() + 1500;
    GOTO_SEG = land && land.scrollIntoView ? land : null;
    syncReadUI(); update();
    /* 点了目录就算「读到这一节」，不必等滚动事件：已经在这一屏时不会有滚动。 */
    schedulePos();
  }
  function enterRead(){
    if (READING || !HEADS.length) return;
    SAVED = FOLDED.slice();
    READING = true;
    focusSection(CUR >= 0 && CUR < HEADS.length ? CUR : 0);
  }
  function exitRead(restore){
    if (!READING) return;
    READING = false;
    if (restore && SAVED && SAVED.length === FOLDED.length) FOLDED = SAVED.slice();
    SAVED = null;
    applyFold(); saveFold(); syncReadUI(); update();
  }
  function goTo(i, land){
    if (i < 0 || i >= HEADS.length) return;
    focusSection(i, land);
  }
  function step(d){ goTo(CUR + d); }
  function ensureFoldButtons(){
    for (var i = 0; i < HEADS.length; i++) {
      (function(idx){
        var h = HEADS[idx];
        if (!sectionOf(h)) return;
        var b = h.querySelector('.alFoldBtn');
        if (!b) {
          b = el('button', 'alFoldBtn', FOLDED[idx] ? '▸' : '▾');
          b.type = 'button';
          b.title = FOLDED[idx] ? '展开这一节' : '收起这一节';
          b.onclick = function(e){
            e.stopPropagation();
            setFold(idx, FOLDED[idx] ? 0 : 1);
          };
          h.appendChild(b);
        }
      })(i);
    }
  }

  /* 目录是浮层，会压住右侧正文；展开时让主区自己让出这条宽度。
     收起 / 空态时立刻还原，报告一个字都不用改写。 */
  function syncBody(){
    var open = HEADS.length > 0 && !panel.classList.contains('al-nav-min');
    document.body.classList.toggle('al-nav-open', open);
  }

  function scan(fresh){
    /* 报告换了（或区块重排）就退出逐节读。不恢复 SAVED：逐节读期间没写盘，
       下面 loadFold() 读到的仍是进入前的状态；新报告指纹不同，会自然全展开。 */
    if (READING) exitRead(false);
    var m = document.querySelector('.main');
    var hs = m ? [].slice.call(m.querySelectorAll('.block-head')) : [];
    /*
     * 新报告从「开头」读起。
     *
     * .main 的 scrollTop 会跟着内容一起留下来：上一次分析前滚到哪一屏，报告一渲染
     * 就停在那个高度，看起来像有人已经把这份报告翻到中间了。更糟的是位置记录——
     * 落点正好压在第 2 节上，350ms 后就写下一句「上次读到第 2 节」，而这份报告
     * 一秒前才生成，没人读过。这句谎话以后每次重开都会重复一遍。
     *
     * 只在新报告（fresh）时清零；同一份报告里的重扫（面板开合、结构变动）不动
     * 读者的位置——那是他正在读的地方。
     */
    if (fresh) {
      if (m) m.scrollTop = 0;
      /* 滚动容器可能是 .main，也可能是窗口本身（窄窗口时整页滚）。两处都归零：
         只归一处，另一种布局下这句话就不算数，而且不会有任何报错。 */
      window.scrollTo(0, 0);
      /* 换了一份报告：上一份还在半路的记账作废，并且重新从「摆高亮、不记账」开始。 */
      clearTimeout(posTimer);
      ARMED = false;
    }
    MAIN = m; HEADS = hs; LAST_COUNT = hs.length; CUR = -1; VERDICT = -1; LAST_SEG = -2;
    if (!hs.length) {
      panel.style.display = 'none';
      document.body.classList.remove('al-fold-on');
      syncBody();
      /* 空态也要把控件状态摆对：首屏没有报告时，逐节读与上下节都该是禁用的。
         面板此刻虽被隐藏，一旦之后切回空态，按钮不该停在上一份报告的可用状态。 */
      syncReadUI();
      resume.style.display = 'none';
      return;
    }
    panel.style.display = ''; syncBody();
    list.textContent = '';
    loadFold(!!fresh);
    hs.forEach(function(h, i){
      var b = el('button', 'ni');
      var tt = textOf(h);
      b.appendChild(el('i', '', String(i + 1).padStart(2, '0')));
      b.appendChild(el('span', '', tt));
      /* 悬停时给一句人话：这节在讲什么。逐字取自报告自己的 .block-plain，
         目录不另写摘要，免得目录与正文说法不一致。 */
      var sec = sectionOf(h);
      var plain = sec ? sec.querySelector('.block-plain') : null;
      var pt = plain ? String(plain.textContent || '').replace(/\s+/g, ' ').trim() : '';
      b.title = tt + (pt ? ' · ' + pt : '');
      /* 争议数逐字来自报告标题上的 .dp-mark，不自己数、不自己判。 */
      var dp = h.querySelector('.dp-mark');
      var dm = dp && String(dp.textContent || '').match(/\d+/);
      if (dm) {
        var em = el('em', '', dm[0]);
        em.title = '这一节碰到 ' + dm[0] + ' 处理论争议';
        b.appendChild(em);
      }
      /* 走 goTo：普通模式只展开并跳过去，逐节读模式下顺手把其余节收好。 */
      b.onclick = function(){ goTo(i); };
      list.appendChild(b);
      if (VERDICT < 0 && /^判读/.test(tt)) VERDICT = i;
    });
    ensureFoldButtons();
    applyFold();
    jump.textContent = VERDICT >= 0
      ? '→ 先看判读（第 ' + (VERDICT + 1) + ' 节）'
      : '→ 跳到判读';
    syncReadUI();
    update(false);
    /* 位置记录最后读：它要给的是「打开这一份时该说什么」，不是随滚动变的一句话。 */
    syncResume();
  }

  /* record=false：这一次只摆高亮，不记账。见 update 的说明与 ARMED。 */
  function update(record){
    if (!MAIN || !HEADS.length) return;
    var line = topLine();
    var cur = 0;
    for (var i = 0; i < HEADS.length; i++) {
      if (HEADS[i].getBoundingClientRect().top <= line) cur = i; else break;
    }
    /* 逐节读的位置由「上一节 / 下一节」显式推进，滚动不抢着改：
       否则平滑滚动途中高亮会跳到别的节，而展开的仍是原来那一节。 */
    if (!READING && cur !== CUR) {
      CUR = cur;
      LAST_SEG = segIndexAt(cur);
      /* 滚过一节就记一次（350ms 后落盘）。停在第一节不记，见 recordPos 里那条理由。 */
      if (record !== false) schedulePos();
      for (var j = 0; j < list.children.length; j++) {
        list.children[j].className = (j === cur ? 'ni on' : 'ni') + (FOLDED[j] ? ' fold' : '');
      }
      var curItem = list.children[cur];
      if (curItem && curItem.scrollIntoView) {
        var pr = curItem.getBoundingClientRect(), lr = list.getBoundingClientRect();
        if (pr.top < lr.top || pr.bottom > lr.bottom) {
          list.scrollTop = curItem.offsetTop - list.offsetTop - list.clientHeight / 2;
        }
      }
      syncReadUI();
    } else if (!READING && cur === CUR && CUR >= 0) {
      /* 同一节里往下读不发节号变化，只看 cur !== CUR 会整节都不更新。
         块变了也记一次——这正是「读到节内哪一段」要记的那件事。 */
      var sk = segIndexAt(CUR);
      if (sk !== LAST_SEG) { LAST_SEG = sk; if (record !== false) schedulePos(); }
    }
    var max = MAIN.scrollHeight - MAIN.clientHeight;
    progI.style.width = (max > 0 ? (MAIN.scrollTop / max * 100) : 0).toFixed(1) + '%';
    var txt = (READING ? '逐节读 ' : '') + (CUR + 1) + ' / ' + HEADS.length + ' 节';
    if (footN.textContent !== txt) footN.textContent = txt;
  }

  minBtn.onclick = function(){
    var min = panel.classList.toggle('al-nav-min');
    minBtn.textContent = min ? '‹' : '›';
    minBtn.title = min ? '展开目录' : '收起目录';
    syncBody();
    try { localStorage.setItem('alNavMin', min ? '1' : '0'); } catch (e) { /* @allow-silent: 存储被禁用时收起状态记不住即可，目录本身照常可用 */ }
  };
  try {
    if (localStorage.getItem('alNavMin') === '1') {
      panel.classList.add('al-nav-min');
      minBtn.textContent = '‹'; minBtn.title = '展开目录';
    }
  } catch (e) { /* @allow-silent: 读不到上次收起状态就用默认展开，不影响阅读 */ }

  jump.onclick = function(){ goTo(VERDICT); };
  readBtn.onclick = function(){ if (READING) exitRead(true); else enterRead(); };
  prevBtn.onclick = function(){ step(-1); };
  nextBtn.onclick = function(){ step(1); };
  topBtn.onclick = function(){
    if (MAIN) MAIN.scrollTo({ top: 0, behavior: 'smooth' });
  };
  foldAllBtn.onclick = function(){
    setAll(1);
    /* 报告开头还有一段不属于 18 个 Block 的说明区，回 top 会停在那里，
       看起来像「按了没反应」。滚到第一个区块标题，第一屏就是收起后的清单。 */
    if (HEADS[0]) HEADS[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  unfoldAllBtn.onclick = function(){ setAll(0); };
  /* D 收目录，E 收/展全部区块，← / → 走上一节 / 下一节。
     都绑在注入脚本里，撤掉目录时快捷键一起消失，不留半截全局键。 */
  document.addEventListener('keydown', function(e){
    if (!e.ctrlKey || !e.shiftKey) return;
    var k = String(e.key).toLowerCase();
    if (k === 'd') {
      e.preventDefault();
      minBtn.click();
    } else if (k === 'e' && HEADS.length) {
      e.preventDefault();
      var any = false;
      for (var i = 0; i < FOLDED.length; i++) if (FOLDED[i]) { any = true; break; }
      setAll(any ? 0 : 1);
    } else if ((k === 'arrowleft' || k === 'arrowright') && HEADS.length) {
      e.preventDefault();
      step(k === 'arrowright' ? 1 : -1);
    }
  });
  window.__alNavToggle = function(){ minBtn.click(); };
  /* 冒烟专用：把目录当成「刚打开这份报告」重走一遍 scan（换报告时真应用派发
     al:report-change 走的是同一条路，只是带 fresh）。只重读、不替读者点任何东西。 */
  window.__alNavRescan = function(){ scan(); return true; };
  /* 冒烟专用、只读：位置记录与当前高亮节各是什么。用来分清一条记录是谁写的
     （软件写错了，还是自检自己滚出来的），不写盘、不改任何状态。 */
  window.__alNavDebug = function(){
    loadMarks();
    return {
      cur: CUR,
      lastId: LAST_ID,
      ids: Object.keys(MARKS),
      scrollTop: MAIN ? Math.round(MAIN.scrollTop) : -1,
      winY: Math.round(window.scrollY || 0),
      heads: HEADS.length,
      line: Math.round(topLine()),
      tops: HEADS.slice(0, 4).map(function(h){
        var s = sectionOf(h);
        return { id: s ? (s.id || '') : '', t: Math.round(h.getBoundingClientRect().top), n: textOf(h) };
      }),
    };
  };

  /* scroll 不冒泡，用捕获阶段监听所有滚动容器；rAF 合帧，别拖慢长报告。 */
  var queued = false;
  /*
   * 打开报告后的**第一次滚动只当基线**，不记账。
   *
   * 报告第一栏并不在容器的 0 像素处（上面还有输入区），而简洁态里一个区块只有
   * 一行标题——两三个标题能一起挤进 72px 的顶线以内，「当前是第几节」在刚打开时
   * 就会算成第 2 节。照这一帧记下去，一份一秒前才生成、谁都没读过的报告，重开时
   * 会端出一句「上次读到第 2 节」。这句话没有第二处能核对，只能保证它不在
   * 没发生阅读的时候写下来：先让视口落定一次，之后的滚动才算读过。
   */
  var ARMED = false;
  document.addEventListener('scroll', function(){
    if (queued) return;
    queued = true;
    var first = !ARMED;
    ARMED = true;
    requestAnimationFrame(function(){ queued = false; update(!first); });
  }, true);
  window.addEventListener('resize', update);

  /* 报告是异步渲染的；这里只在结构性变化（.main 换节点 / 区块数变）时兜底重扫，
     不再负责判断「换了一份报告」——那个判据不可靠，见下面的显式事件。
     目录面板自身的 DOM 变更一律忽略。 */
  var mo = new MutationObserver(function(recs){
    var outside = false;
    for (var k = 0; k < recs.length; k++) {
      var n = recs[k].target;
      if (!(n && n.closest && n.closest('#' + ID))) { outside = true; break; }
    }
    if (!outside) return;
    clearTimeout(timer);
    timer = setTimeout(function(){
      var m = document.querySelector('.main');
      var n = m ? m.querySelectorAll('.block-head').length : 0;
      if (m !== MAIN || n !== LAST_COUNT) scan();
      else { ensureFoldButtons(); applyFold(); update(); }
    }, 180);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  /* 「换报告」由渲染层显式通知（App.tsx 在 diag.id 变化时派发 al:report-change）。
     注入脚本不在 React 树里：18 个区块数被架构检查冻结、.main 又常被复用，
     靠 DOM 猜会时灵时不灵——实测 A 收起全部后切 B，B 会顶着 A 的 18 个收起状态。
     收到通知就重扫并强制全展开，两次切换行为一致，与 DOM 是否复用无关。 */
  window.addEventListener('al:report-change', function(e){
    var id = e && e.detail ? String(e.detail.id || '') : '';
    if (!id || id === LAST_ID) return;
    LAST_ID = id;
    clearTimeout(timer);
    timer = setTimeout(function(){ scan(true); }, 60);
  });
  /* 「跳到某一节并展开它」由渲染层派发（异议账里那个按钮）。
     折叠状态归这里管，所以让这里改——渲染层直接删 DOM 属性会被下一次重贴盖回来。 */
  window.addEventListener('al:unfold', function(e){
    var id = e && e.detail ? String(e.detail.id || '') : '';
    if (!id || !HEADS.length) return;
    for (var i = 0; i < HEADS.length; i++) {
      var sec = sectionOf(HEADS[i]);
      if (sec && sec.id === id) {
        if (READING) exitRead(false);
        setFold(i, 0);
        return;
      }
    }
  });
  scan();
})();`;
