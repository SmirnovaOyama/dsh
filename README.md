# DeepSeek Harness

用 DeepSeek API 驅動的寫程式 Agent 桌面應用程式。選一個專案資料夾，告訴 Agent 要做什麼，它會讀檔、搜尋、改程式和跑指令，改檔和執行指令前都會先問你。

## 功能

- 串流顯示 Agent 的回覆、思考過程和每一個工具步驟
- 工具：讀檔、列出資料夾、找檔案、搜尋內容、編輯檔案、寫入檔案、執行指令
- 改檔前先給你看差異，執行指令前先問你，可以只允許這次對話，或把指令加進允許清單
- 右側的變更面板列出這次對話改過的檔案，可以看差異、全部復原，或直接提交到 git
- 右側的檔案分頁可以瀏覽整個專案（會略過 .gitignore 裡的東西），點行號或選取文字挑出幾行，按「加到對話」就會跟著下一則訊息一起給 Agent 看
- 對話紀錄存在這台電腦，下次打開還在
- 輸入框打 `/` 叫出指令清單，打 `@` 從專案裡挑檔案跟著訊息一起送
- Agent 做多步驟的工作時會列待辦清單，固定在輸入框上方，看得到做到哪一步
- Agent 在跑的時候也能繼續打字，訊息會在它下一步時送進去，還沒送出前可以收回
- 規劃模式：Agent 只讀不改，寫好計畫給你確認後才開始動手
- 回到之前的某則訊息：對話、Agent 改過的檔案，或兩者一起回到送出那則訊息之前
- 支援 DeepSeek V4.1 Flash（`deepseek-flash`）和 V4 Pro（`deepseek-v4-pro`），思考可以關掉或選低、高、最高；舊的 `deepseek-chat`、`deepseek-reasoner` 設定會自動換成 V4.1 Flash
- 淺色、深色和跟隨系統，介面有繁體中文和英文

## 需要的東西

- Node.js 20 以上（建議 22）
- git（變更面板的提交功能會用到）
- 一把 DeepSeek API Key，到 <https://platform.deepseek.com/api_keys> 申請

## 開始使用

```bash
git clone https://github.com/SmirnovaOyama/dsh.git
cd dsh
npm install
npm run dev
```

`npm run dev` 會開啟 Vite 開發伺服器和 Electron 視窗，改程式碼會自動重新載入。第一次執行時會先下載 Electron，終端機會顯示「Downloading Electron binary...」，下載完視窗就會打開。

第一次打開時：

1. 到「設定 › 連線」貼上 API Key，按「儲存」，可以按「測試連線」確認
2. 點左上角選一個專案資料夾
3. 在下方輸入框告訴 Agent 要做什麼，Enter 送出，Shift+Enter 換行

API Key 只存在這台電腦。系統有鑰匙圈時（macOS 鑰匙圈、Windows DPAPI、Linux 的 Secret Service）會加密保存，沒有的話設定頁會告訴你它以一般文字保存。

## 權限

輸入框下方可以切換這次對話的權限，新對話的預設值在「設定 › 權限」：

| 模式 | 改檔 | 執行指令 |
| --- | --- | --- |
| 編輯前詢問 | 先問你 | 先問你 |
| 自動允許編輯 | 直接改 | 先問你 |
| 全部自動 | 直接改 | 直接執行 |

開頭符合「允許的指令」清單的指令不用問就會執行，例如 `npm test`。就算開頭符合，只要含有 `;`、`&&`、`|`、`>` 這類串接或導向符號，還是會先問你（全部自動模式除外）。

Agent 只能讀寫你選的資料夾裡面的檔案，指向資料夾外面的路徑和捷徑都會被拒絕。

## 對話太長的時候

DeepSeek V4 的模型一次最多看得到 1M tokens。上一輪用掉八成以上時，Agent 會先把前面的對話整理成一份摘要再繼續，畫面上的紀錄不會不見，只是之後送給模型的是摘要。模型回說對話太長時也會自動整理一次再重送。

想自己整理的話，在輸入框打 `/compact`，後面可以接想保留的重點，例如 `/compact 登入的問題`。

## 指令

在輸入框最前面打 `/`，用上下鍵選，Enter 直接執行，Tab 補完後可以接著打字

| 指令 | 用途 |
| --- | --- |
| `/compact [重點]` | 把前面的對話整理成摘要 |
| `/clear` | 開始新對話 |
| `/init` | 讓 Agent 看過專案後寫一份 `AGENTS.md` |
| `/review` | 讓 Agent 檢查還沒提交的變更，不改檔案 |
| `/plan [要做的事]` | 切到規劃模式 |
| `/model` | 換模型或思考程度 |
| `/rewind` | 回到之前的某則訊息，輸入框空著時連按兩次 Esc 也可以 |

專案自己的指令放在 `.dsh/commands/名字.md`，檔案內容就是給 Agent 的提示，`$ARGUMENTS` 會換成指令後面打的字，開頭可以用 `description:` 寫一行說明。Claude Code 的 `.claude/commands` 也讀得到，同一份檔案兩邊都能用

## 權限模式

輸入框裡按 Shift+Tab 可以輪流切換編輯前詢問、自動允許編輯、全部自動和規劃模式

## 回到之前的訊息

游標移到自己的訊息上，左邊會出現回退按鈕。可以選對話和程式碼一起回去、只回對話，或只把 Agent 改過的檔案改回來。訊息會放回輸入框讓你改了再送。執行指令造成的變更不會改回來

## 專案

打開過的資料夾會留在側欄的「專案」底下，每個專案下面列出它的對話。點對話會自動切到那個資料夾，游標移到專案上按 + 就在那裡開新對話，⋯ 可以把它從側欄移除（資料夾和對話都不會刪掉）。搜尋會找所有專案的對話

## 給 Agent 的專案說明

在專案根目錄放一個 `AGENTS.md` 或 `DSH.md`，Agent 每次開始工作前都會讀，適合寫測試指令、程式風格和不要碰的檔案。

## 快捷鍵

| 動作 | macOS | Windows / Linux |
| --- | --- | --- |
| 新對話 | ⌘N | Ctrl+N |
| 搜尋對話 | ⌘K | Ctrl+K |
| 設定 | ⌘, | Ctrl+, |
| 停止 Agent | 輸入框裡按 Esc | 輸入框裡按 Esc |
| 允許／拒絕 | Enter／Esc | Enter／Esc |

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 開發模式，開 Electron 視窗 |
| `npm run dev:web` | 只在瀏覽器看介面，用的是假資料，不會連 DeepSeek |
| `npm test` | 跑測試 |
| `npm run typecheck` | 型別檢查 |
| `npm run build` | 打包程式碼到 `dist/` |
| `npm run dist` | 做成安裝檔（macOS dmg、Windows exe、Linux AppImage），放在 `release/` |

## 資料存在哪裡

設定和對話紀錄在系統的應用程式資料夾：

- macOS：`~/Library/Application Support/DeepSeek Harness`
- Windows：`%APPDATA%\DeepSeek Harness`
- Linux：`~/.config/DeepSeek Harness`

## 專案結構

```
src/main       Electron 主程序：DeepSeek 串流、Agent 迴圈、工具、權限、存檔
src/preload    給介面用的小型 API 橋接
src/renderer   React 介面，使用 Oyama Design System
src/shared     主程序和介面共用的型別
tests          Vitest 測試
```
