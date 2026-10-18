# DeepSeek Harness

用 DeepSeek API 驅動的寫程式 Agent 桌面應用程式。選一個專案資料夾，告訴 Agent 要做什麼，它會讀檔、搜尋、改程式和跑指令，改檔和執行指令前都會先問你。

## 功能

- 串流顯示 Agent 的回覆、思考過程和每一個工具步驟
- 工具：讀檔、列出資料夾、找檔案、搜尋內容、編輯檔案、寫入檔案、執行指令
- 改檔前先給你看差異，執行指令前先問你，可以只允許這次對話，或把指令加進允許清單
- 右側的變更面板列出這次對話改過的檔案，可以看差異、全部復原，或直接提交到 git
- 對話紀錄存在這台電腦，下次打開還在
- 支援 `deepseek-chat` 和 `deepseek-reasoner`（思考模式）
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
