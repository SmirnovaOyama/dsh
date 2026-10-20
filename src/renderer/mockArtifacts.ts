// Demo artifacts for the browser preview: a small timer page the agent made and then changed.

export const pomodoroV1 = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>番茄鐘</title>
<style>
  :root { --ink: #1f1f1f; --muted: #737373; --line: #e5e5e5; --accent: #1f1f1f; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif; }
  main { width: min(360px, 90vw); text-align: center; }
  h1 { margin: 0 0 4px; font-size: 15px; font-weight: 500; color: var(--muted); }
  .time { font-size: 88px; font-weight: 300; letter-spacing: -2px; font-variant-numeric: tabular-nums; }
  .bar { height: 4px; margin: 8px 0 32px; border-radius: 2px; background: var(--line); overflow: hidden; }
  .bar > div { height: 100%; width: 0; background: var(--accent); transition: width 1s linear; }
  .row { display: flex; gap: 8px; justify-content: center; }
  button { min-width: 96px; height: 40px; padding: 0 18px; border: 1px solid var(--line); border-radius: 14px;
    background: #fff; color: var(--ink); font: inherit; font-size: 15px; cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .count { margin-top: 28px; font-size: 13px; color: var(--muted); }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #ececec; --muted: #9a9a9a; --line: #3a3a3a; --accent: #ececec; }
    body { background: #262626; }
    button { background: #2f2f2f; }
    button.primary { color: #1f1f1f; }
    .modes { background: #1f1f1f; }
    .modes button[aria-pressed="true"] { background: #3a3a3a; box-shadow: none; }
  }
</style>
</head>
<body>
<main>
  <h1>專心時間</h1>
  <div class="time" id="time">25:00</div>
  <div class="bar"><div id="bar"></div></div>
  <div class="row">
    <button class="primary" id="start">開始</button>
    <button id="reset">重來</button>
  </div>
  <p class="count">今天完成 <span id="done">0</span> 個</p>
</main>
<script>
  const FOCUS = 25 * 60
  let left = FOCUS, timer = null, done = 0
  const $ = (id) => document.getElementById(id)
  const show = () => {
    $('time').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0')
    $('bar').style.width = (100 * (FOCUS - left) / FOCUS) + '%'
  }
  const tick = () => {
    left -= 1
    if (left <= 0) { clearInterval(timer); timer = null; done += 1; $('done').textContent = done; left = FOCUS; $('start').textContent = '開始' }
    show()
  }
  $('start').onclick = () => {
    if (timer) { clearInterval(timer); timer = null; $('start').textContent = '繼續' }
    else { timer = setInterval(tick, 1000); $('start').textContent = '暫停' }
  }
  $('reset').onclick = () => { clearInterval(timer); timer = null; left = FOCUS; $('start').textContent = '開始'; show() }
  show()
</script>
</body>
</html>
`

export const pomodoroV2 = pomodoroV1
  .replace('border-radius: 14px;', 'border-radius: 6px;')
  .replace(
    '.count {',
    `.modes { display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 20px; border-radius: 8px; background: #f0f0f0; }
  .modes button { min-width: 0; height: 30px; padding: 0 14px; border: 0; border-radius: 6px; background: transparent; font-size: 13px; color: var(--muted); }
  .modes button[aria-pressed="true"] { background: #fff; color: var(--ink); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
  .count {`,
  )
  .replace(
    '  <h1>專心時間</h1>\n',
    '  <div class="modes"><button id="focus" aria-pressed="true">專心 25 分</button><button id="rest" aria-pressed="false">休息 5 分</button></div>\n',
  )
  .replace('const FOCUS = 25 * 60\n  let left = FOCUS', 'const LENGTH = { focus: 25 * 60, rest: 5 * 60 }\n  let mode = \'focus\', FOCUS = LENGTH.focus\n  let left = FOCUS')
  .replace(
    '  show()\n</script>',
    `  const pick = (next) => {
    mode = next; FOCUS = LENGTH[next]; $('focus').setAttribute('aria-pressed', next === 'focus'); $('rest').setAttribute('aria-pressed', next === 'rest')
    $('reset').onclick()
  }
  $('focus').onclick = () => pick('focus')
  $('rest').onclick = () => pick('rest')
  show()
</script>`,
  )

export const tomatoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240">
  <path d="M60 30c-25 0-44 17-44 42 0 24 19 38 44 38s44-14 44-38c0-25-19-42-44-42Z" fill="#e5533d"/>
  <path d="M36 52c4-8 12-13 20-14" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>
  <path d="M60 33c-3-6-10-9-17-8 5 3 8 6 9 10-6-1-12 1-16 5 8 1 16 1 24-2 8 3 16 3 24 2-4-4-10-6-16-5 1-4 4-7 9-10-7-1-14 2-17 8Z" fill="#3f8a4a"/>
  <path d="M60 33c0-7 2-13 6-18" fill="none" stroke="#3f8a4a" stroke-width="4" stroke-linecap="round"/>
</svg>`

export const pomodoroGuide = `# 番茄鐘使用說明

把工作切成一段一段，每段專心 25 分鐘，中間休息 5 分鐘。

## 開始一輪

1. 在上面選「專心 25 分」
2. 按「開始」，倒數會出現在中間
3. 想停一下就按「暫停」，再按一次會接著倒數

## 休息

一輪結束後切到「休息 5 分」，再按「開始」。每專心四輪，可以休息久一點。

## 小提醒

- 今天完成的輪數記在最下面，重新整理頁面會歸零
- 倒數結束時會響一聲，記得打開聲音
`

// More demo artifacts, spread over other conversations and folders, for the library page.

export const weeklyProgress = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>這週任務進度</title>
<style>
  :root { --ink: #1f1f1f; --muted: #737373; --line: #e5e5e5; --bar: #1f1f1f; --track: #f0f0f0; }
  body { margin: 0; padding: 28px 32px; background: #fff; color: var(--ink); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; }
  .meta { margin: 2px 0 20px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; margin-bottom: 24px; background: var(--line); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .grid div { padding: 10px 12px; background: Canvas; }
  .grid b { display: block; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .grid span { color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 7px 8px; border-bottom: 1px solid var(--line); text-align: left; }
  th { font-weight: 500; color: var(--muted); }
  td.num { text-align: right; width: 56px; }
  .track { height: 6px; border-radius: 3px; background: var(--track); }
  .track i { display: block; height: 100%; border-radius: 3px; background: var(--bar); }
  @media (prefers-color-scheme: dark) { :root { --ink: #ececec; --muted: #9a9a9a; --line: #3a3a3a; --bar: #ececec; --track: #2f2f2f; } body { background: #262626; } }
</style>
</head>
<body>
  <h1>這週任務進度</h1>
  <p class="meta">10 月 13 日到 19 日，共 46 個任務</p>
  <div class="grid">
    <div><b>31</b><span>完成</span></div>
    <div><b>9</b><span>進行中</span></div>
    <div><b>4</b><span>卡住</span></div>
    <div><b>67%</b><span>完成率</span></div>
  </div>
  <table>
    <thead><tr><th>專案</th><th>進度</th><th class="num">完成</th><th class="num">全部</th></tr></thead>
    <tbody>
      <tr><td>登入流程</td><td><div class="track"><i style="width: 92%"></i></div></td><td class="num">11</td><td class="num">12</td></tr>
      <tr><td>同步</td><td><div class="track"><i style="width: 70%"></i></div></td><td class="num">7</td><td class="num">10</td></tr>
      <tr><td>設定頁</td><td><div class="track"><i style="width: 63%"></i></div></td><td class="num">5</td><td class="num">8</td></tr>
      <tr><td>通知</td><td><div class="track"><i style="width: 50%"></i></div></td><td class="num">4</td><td class="num">8</td></tr>
      <tr><td>文件</td><td><div class="track"><i style="width: 50%"></i></div></td><td class="num">4</td><td class="num">8</td></tr>
    </tbody>
  </table>
</body>
</html>
`

export const darkPalette = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>深色模式色票</title>
<style>
  body { margin: 0; display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif; }
  section { padding: 28px 32px; }
  .light { background: #fafafa; color: #1f1f1f; }
  .dark { background: #262626; color: #ececec; }
  h2 { margin: 0 0 16px; font-size: 15px; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-bottom: 1px solid currentColor; border-color: color-mix(in srgb, currentColor 12%, transparent); }
  .sw { width: 28px; height: 28px; border-radius: 6px; box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent); }
  .name { flex: 1; }
  code { font: 12px ui-monospace, Menlo, monospace; opacity: 0.7; }
</style>
</head>
<body>
  <section class="light">
    <h2>淺色</h2>
    <div class="row"><span class="sw" style="background:#fafafa"></span><span class="name">背景</span><code>#fafafa</code></div>
    <div class="row"><span class="sw" style="background:#ffffff"></span><span class="name">表面</span><code>#ffffff</code></div>
    <div class="row"><span class="sw" style="background:#e5e5e5"></span><span class="name">分隔線</span><code>#e5e5e5</code></div>
    <div class="row"><span class="sw" style="background:#737373"></span><span class="name">次要文字</span><code>#737373</code></div>
    <div class="row"><span class="sw" style="background:#1f1f1f"></span><span class="name">文字</span><code>#1f1f1f</code></div>
  </section>
  <section class="dark">
    <h2>深色</h2>
    <div class="row"><span class="sw" style="background:#262626"></span><span class="name">背景</span><code>#262626</code></div>
    <div class="row"><span class="sw" style="background:#2f2f2f"></span><span class="name">表面</span><code>#2f2f2f</code></div>
    <div class="row"><span class="sw" style="background:#3a3a3a"></span><span class="name">分隔線</span><code>#3a3a3a</code></div>
    <div class="row"><span class="sw" style="background:#9a9a9a"></span><span class="name">次要文字</span><code>#9a9a9a</code></div>
    <div class="row"><span class="sw" style="background:#ececec"></span><span class="name">文字</span><code>#ececec</code></div>
  </section>
</body>
</html>
`

export const syncFlow = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200" width="480" height="200" font-family="-apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif" font-size="13">
  <defs><marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L8 4L0 8z" fill="#737373"/></marker></defs>
  <g fill="#fff" stroke="#1f1f1f" stroke-width="1.2">
    <rect x="16" y="76" width="104" height="48" rx="8"/><rect x="188" y="20" width="104" height="48" rx="8"/>
    <rect x="188" y="132" width="104" height="48" rx="8"/><rect x="360" y="76" width="104" height="48" rx="8"/>
  </g>
  <g fill="none" stroke="#737373" stroke-width="1.2" marker-end="url(#a)">
    <path d="M120 92 C150 92 160 44 186 44"/><path d="M120 108 C150 108 160 156 186 156"/>
    <path d="M292 44 C320 44 330 92 358 92"/><path d="M292 156 C320 156 330 108 358 108"/>
  </g>
  <g fill="#1f1f1f" text-anchor="middle">
    <text x="68" y="104">手機改動</text><text x="240" y="48">比對版本</text>
    <text x="240" y="160">排進佇列</text><text x="412" y="104">寫回伺服器</text>
  </g>
</svg>`

export const pnpmScript = `#!/usr/bin/env bash
# 把專案從 npm 換成 pnpm，保留現在鎖定的版本
set -euo pipefail

if ! command -v pnpm >/dev/null; then
  corepack enable
  corepack prepare pnpm@9.12.0 --activate
fi

# 從 package-lock.json 匯入版本，產生 pnpm-lock.yaml
pnpm import
rm -f package-lock.json
rm -rf node_modules

pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test

echo "換好了，記得把 pnpm-lock.yaml 一起提交"
`

export const errorGuide = `# API 錯誤訊息的寫法

每一則錯誤都回答三件事：發生了什麼、為什麼、現在可以怎麼做。

## 規則

- 用平常說話的句子，不用代碼開頭
- 說清楚是誰的問題，不要怪使用者
- 能重試的就給重試，不能的就說下一步

## 例子

| 狀況 | 寫法 |
| --- | --- |
| 金鑰錯誤 | 這把金鑰被拒絕了，到設定裡換一把再試 |
| 餘額不足 | 帳戶餘額用完了，加值之後就能繼續 |
| 太多請求 | 一下子送太多了，等幾秒會自動再試 |
`

export const readingNotes = `# 十月讀書筆記

## 《設計的心理學》

- 好的設計讓人一看就知道能做什麼
- 出錯時要讓人知道怎麼回頭
- 限制不是壞事，能減少犯錯

## 《原子習慣》

1. 讓好習慣容易開始，兩分鐘內做得完
2. 把提示放在看得到的地方
3. 每天記一筆，不要斷掉兩天

## 想試的事

- 每天早上先寫十分鐘
- 週日整理一次這週的筆記
`
