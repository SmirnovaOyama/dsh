// Demo artifacts for the browser preview: a small timer page the agent made and then changed.

export const pomodoroV1 = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>番茄鐘</title>
<style>
  :root { --ink: #2b2a27; --muted: #8a867e; --line: #e8e4dc; --accent: #c4623f; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #faf8f4; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif; }
  main { width: min(360px, 90vw); text-align: center; }
  h1 { margin: 0 0 4px; font-size: 15px; font-weight: 500; color: var(--muted); }
  .time { font-size: 88px; font-weight: 300; letter-spacing: -2px; font-variant-numeric: tabular-nums; }
  .bar { height: 4px; margin: 8px 0 32px; border-radius: 2px; background: var(--line); overflow: hidden; }
  .bar > div { height: 100%; width: 0; background: var(--accent); transition: width 1s linear; }
  .row { display: flex; gap: 8px; justify-content: center; }
  button { min-width: 96px; height: 40px; padding: 0 18px; border: 1px solid var(--line); border-radius: 20px;
    background: #fff; color: var(--ink); font: inherit; font-size: 15px; cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .count { margin-top: 28px; font-size: 13px; color: var(--muted); }
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
  .replace('border-radius: 20px;', 'border-radius: 10px;')
  .replace(
    '.count {',
    `.modes { display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 20px; border-radius: 10px; background: #efebe4; }
  .modes button { min-width: 0; height: 30px; padding: 0 14px; border: 0; border-radius: 8px; background: transparent; font-size: 13px; color: var(--muted); }
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
