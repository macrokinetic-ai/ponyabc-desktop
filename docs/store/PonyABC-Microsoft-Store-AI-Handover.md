# PonyABC Desktop — Microsoft Store 上架交接報告

更新日期：2026-09-29  
用途：供下一位維護者或 AI 閱讀，接手 Microsoft Store 發佈、更新及問題排查。  
資料來源：本對話中的使用者指示、Partner Center 截圖及使用者轉貼的 Claude Code 工作報告。此文件不是對目前 repository、線上服務或安裝包的重新稽核。

## 1. 接手先讀：最終結果

- **PonyABC Desktop 已於 2026-09-28 的使用者截圖中確認正式上架 Microsoft Store。**
- Partner Center 顯示 **In Microsoft Store**，並明示產品目前已可供取得。
- 最後送審的是圖示修正版 **v0.3.16 / APPX 0.3.16.0，Windows x64**。之後的上架截圖沒有再次展示套件版本；此版本關聯依據前面的換包及重新送審流程。
- 商店網址：`https://apps.microsoft.com/detail/9P544XC6B609`
- 首次提交 v0.3.15 因 APPX 內仍使用預設 Electron tile/logo 圖片，被 **10.1.1.11 — On Device Tiles** 拒絕。補上真正 PonyABC 資產、增加版本、重新送審後通過。
- 上架流程已完成。**不要將任務重新描述為「等待首次送審」或「仍未上架」。**
- 尚未在本對話取得「從正式 Microsoft Store 安裝後的完整實機測試」結果；不要把上架等同所有硬件功能已驗證。

## 2. 證據及可信度約定

本報告用以下區分：

1. **使用者截圖確認**：Partner Center 狀態、可見欄位及版本。
2. **Claude 報告**：程式修改、CI、測試數量、檔案內容及部署結果；本報告作者未重新執行這些驗證。
3. **使用者實測回報**：曾更新實體筆後播放正常；不等同讀回筆內版本。
4. **建議／未確認**：曾提供填寫建議，但沒有最終欄位截圖或獨立證據。

部分 Claude 報告從終端貼出時被截斷或重複。接手時以實際檔案、完整 checksum、git commit 及 Partner Center 為準，不從殘缺文字猜補資料。

## 3. 產品、公司及 Store identity

### 產品定位

PonyABC Desktop 是供家長、老師、學校及機構管理 PonyABC P5 點讀筆的桌面工具，主要操作錄音、BOOK 教育內容及 firmware。不是遊戲，也不是以兒童自行操作為主要用途。使用者描述為適合所有年齡，但正式年齡評級由 IARC 問卷決定。

### 公司及聯絡資料

| 項目 | 值 |
| --- | --- |
| Legal company name | MACROKINETIC MEDIATECH LIMITED |
| Company number | 16420643 |
| Registered office | 128 City Road, London, United Kingdom, EC1V 2NX |
| Public office / correspondence | 34 Redbourne Avenue, London, United Kingdom, N3 2BS |
| Support email | marketing@ponyabc.co.uk |
| Website | https://www.ponyabc.co.uk |
| Portal 所示公開電話 | +44 7353224040 |

使用者明確指定 Redbourne Avenue 作行政及公開聯絡地址；不要把它誤寫成公司註冊地址。

### 不要任意改動的套件識別

| 項目 | 值 |
| --- | --- |
| Product name | PonyABC Desktop |
| Package/Identity/Name | PonyABC.PonyABCDesktop |
| Package/Identity/Publisher | CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5 |
| Package/Properties/PublisherDisplayName | PonyABC |
| Package Family Name | PonyABC.PonyABCDesktop_f1jemggxjsyxg |
| Store ID / Product ID | 9P544XC6B609 |
| Package SID | S-1-15-2-2707000957-4097207258-2627222686-3734493100-3966267114-3755761925-744674612 |
| MSA app ID | 6b1147f4-47ec-464e-8ed1-47e07b957576 |
| Store URL | https://apps.microsoft.com/detail/9P544XC6B609 |
| Store protocol URL | ms-windows-store://pdp/?productid=9P544XC6B609 |

公司 legal name 與 manifest PublisherDisplayName **PonyABC** 是不同用途，不要為了填公司資料而替換 manifest identity。

Partner Center 產品頁曾使用：
`https://partner.microsoft.com/en-US/dashboard/products/9P544XC6B609/overview`

## 4. 專案及交付物位置

以下是本次對話記錄的路徑，接手時先確認仍存在：

| 內容 | 位置 |
| --- | --- |
| Desktop repo | `/Users/aiagent/Documents/ponyabc-desktop` |
| Web repo | `/Users/aiagent/Documents/ponyabc-web` |
| GitHub repo | `https://github.com/macrokinetic-ai/ponyabc-desktop` |
| 原始品牌 logo | `/Users/aiagent/Documents/ponyabc-web/ponyabc_logo1.png` |
| 第一版 Store 提交資料夾 | `/Users/aiagent/Documents/ponyabc-desktop/store-assets/FINAL-SUBMISSION/` |
| 圖示修正版資料夾 | `/Users/aiagent/Documents/ponyabc-desktop/store-assets/v0.3.16-tile-fix/` |
| 最後上傳 APPX | `/Users/aiagent/Documents/ponyabc-desktop/store-assets/v0.3.16-tile-fix/PonyABC-Desktop-v0.3.16-winx64.appx` |
| 圖示預覽 | 上述修正版資料夾內 `packaged-icons-preview.png` |
| 修正審核說明 | 上述修正版資料夾內 `certification-note.md` |
| Microsoft 拒絕附件 | `/Users/aiagent/Documents/ponyabc-web/cert-report-PonyABC Desktop-support-files.zip` |
| Desktop privacy 原稿 | `/Users/aiagent/Documents/ponyabc-desktop/store-assets/privacy-notice-desktop.md` |
| 工作紀錄 | Desktop repo 內 `tasks/todo.md` |

`FINAL-SUBMISSION/` 據 Claude 報告包含 APPX、5 張真實 Windows 截圖、README、`store-listing.md`、`certification-notes.md`、`age-rating-answers.md`；大型 binary 沒有提交 git，已加入 ignore。**這是 v0.3.15 提交資料，不能因名字叫 FINAL 就當成最新套件。** 最新本次成功版本在 `v0.3.16-tile-fix/`。

Claude 報告的新 APPX SHA-256：
`48ad39b2b6a27757287e0bd5d1030fbd2ba1b7ca3bccb475a2e230aa506dbf4b`

此 hash 取自完整貼文，並非本報告重新計算。需要驗證時，重新計算檔案 hash 並核對旁邊的 `.sha256`。

### 分支及 commit 記錄

- Store packaging 曾在 `msix-store-packaging` 分支工作。
- v0.3.15 最終 Store binary 據報告來自 `4a19da2b5e47f4fa7485ed18c6d0a4241b64a851`。
- 文件更新曾推送為 `d61c944`。
- 圖示修復及修正說明推送到 `fix/store-tile-icons`。
- Claude 當時表示圖示修復分支已 push、未 merge。**本對話沒有後續 merge 證據。** 下次發佈前務必確認，避免 default icons 再次出現。
- 不知道 v0.3.16 最終完整 commit SHA；應從 repo / CI 取得，不要猜。

## 5. 由註冊到上架的時間線

| 階段 | 實際結果 |
| --- | --- |
| Windows Dev Center 註冊 | 公司帳戶 ready，開始建立 PonyABC Desktop 產品 |
| 預留名稱及 identity | 取得上述 Store identity；產品類型畫面為 MSIX or PWA app |
| Windows 打包 | 使用 APPX；不需要把副檔名改成 MSIX |
| 本地測試 kit | 包含 APPX、checksum、測試憑證、install/probe/cleanup scripts、README |
| Store 素材準備 | 公司資料、privacy、英文文案、5 張真實 Windows 截圖、商店 logos |
| 2026-09-21 首次送審 | v0.3.15.0 上傳驗證，填寫所有項目後提交，經 Pre-processing 進入 Certification |
| 2026-09-23 首次審核失敗 | 10.1.1.11 On Device Tiles：安裝包包含預設圖示 |
| 2026-09-23 修正 | Claude 產生自訂 APPX assets，升至 0.3.16.0，CI/build/package inspection 通過（據報告） |
| 2026-09-23 換包再送審 | 新包排名 1；舊包劃線，頁面提示 Save 後移除；使用者之後提供重新送審成功截圖 |
| 2026-09-28 審核通過 | Ready to publish，Certification 綠色勾號 |
| 2026-09-28 發佈 | 使用者回報 Publishing，隨後截圖確認 In Microsoft Store |

在審核期間，發佈設定一直是人工按 **Publish now** 才開始。通過審核不等於上架；最後 In Microsoft Store 截圖才是本次上架完成證據。

## 6. Windows 測試 kit 與驗證範圍

舊測試 kit Actions run：
`https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/35557679933`

Artifact 名稱 `windows-appx`，據當時報告包含：

- `PonyABC-Desktop-v0.3.15-winx64.appx`
- 對應 `.sha256`
- `PonyABC-Desktop-test-cert.cer`
- `1-install.ps1`
- `2-run-firmware-probe.ps1`
- `3-cleanup.ps1`
- `README.md`

Artifact 有保留期限，舊 URL 不保證永久可下載；使用最新適當 CI artifact。測試 kit 與後來送審 binary 不應混用 checksum。

### 遇過的問題

1. 下載的 PowerShell script 被視為未簽署而阻擋。
   - README 後來改為對三個指定檔案分別使用 `Unblock-File`。
   - 不要為此直接全域關閉 execution policy。
   - 安裝及 cleanup 按 README 在管理員視窗執行；probe 必須從普通非管理員視窗開始，才能驗證 elevation。
2. Probe 回傳 package name 只有 `P`。
   - Claude 確認 `GetPackageFullName` P/Invoke 未指定 Unicode，ANSI marshaling 遇 UTF-16 null byte 截斷。
   - 修正為 Unicode，並比較完整 PackageFullName 與實際安裝值。

### 已有及沒有的證據

- 使用者 notebook 實測：普通權限開始，批准一次 UAC，無害 elevation/logging probe 完成。
- 這個 probe **不是 firmware flash**。
- UAC decline 及 interrupted-launch recovery 的使用者實測，在當時報告仍未示範。
- Claude 報告 v0.3.16 CI 包括安裝、啟動、cleanup 及包內容驗證。
- Claude 明確沒有親眼驗證 v0.3.16 Windows Start、taskbar、All apps 的外觀。
- 正式 Store 安裝的使用者驗證結果，尚未在本對話回報。

## 7. 首次拒絕原因及真正修正

### Microsoft 報告

Policy：**10.1.1.11 — On Device Tiles**。

報告指出 available product tile icons 使用 default image，不能清楚代表產品。Microsoft 支援 ZIP 放在 web repo，應保留作問題重現證據。

### 根因（Claude 報告）

`build/appx/` 原本不存在，electron-builder 以預設 Electron atom art 補上 APPX 資產。受影響包括：

- StoreLogo
- Square44x44Logo
- Square150x150Logo
- Wide310x150Logo

EXE 原本已使用 PonyABC icon，但留白過多。**EXE icon 正確不代表 APPX tiles 正確；商店另外上傳的 logo 亦不會修正安裝包內資產。**

### v0.3.16 修改（Claude 報告）

- `scripts/generate-appx-assets.py` 產生 `build/appx/` 40 個 PNG。
- 涵蓋 6 類 logo/tile、100–400% scale 及 16–256 px app icon target-size variants，含 plated/unplated。
- 加入 LargeTile / SmallTile 對應引用；最終具體檔名以 manifest 為準。
- 外圍白底變透明，但保留 ABC 字內白色；品牌比例、顏色不變。
- Tile background 設為 `#FFFFFF`。
- EXE `.ico` 收緊留白，含 16–256 px 共 7 個尺寸，補 24/64/128。
- 版本 0.3.15 → 0.3.16；manifest 0.3.15.0 → 0.3.16.0。
- identity / publisher 不變；firmware 行為未改。
- CI 加入缺失 manifest-referenced asset 及舊 default asset 檢查。
- 最終 APPX 解壓檢查 references、resources.pri、圖片尺寸及 hash。

不要將「與舊 default hash 不同」單独當成圖片內容正確的全部證據；此次另有圖像預覽及內容檢查的報告。

### 重新送審操作

1. Packages 上傳新 0.3.16.0 APPX。
2. 舊 0.3.15.0 被劃線，提示 Save 後移除，因新包支援同一批客戶。
3. 保持 Windows 10/11 Desktop，Save。
4. 指示使用者在 Additional Testing Information 保留原測試說明，追加圖示修正說明。
5. Resubmit for certification。

成功重新送審有截圖；Additional Testing Information 最終文字沒有獨立截圖確認。

可重用修正說明：

> This submission addresses certification issue 10.1.1.11 — On Device Tiles.
>
> Package 0.3.16.0 replaces the default Electron tile/logo artwork from version 0.3.15.0 with the official PonyABC logo, including all manifest-referenced assets and scale variants.
>
> The final APPX was extracted and its image assets verified. Package identity and publisher remain unchanged. Firmware functionality is unchanged.

## 8. Partner Center 欄位紀錄

### Packages

- APPX，x64，Windows.Desktop。
- 畫面顯示 minimum version `10.0.14316.0`。這是 manifest 宣告，不代表已驗證在此最低 OS 上可執行；下次應與所用 Electron 版本要求核對。
- 只勾 Windows 10/11 Desktop。
- Mobile / Xbox / Team / Mixed Reality 未勾。
- 未勾選讓 Microsoft 自動延伸至未來 device families。
- `runFullTrust` 曾產生 approval warning；在 Submission Options 填寫用途後完成。
- `Packages Validated` 只表示包通過該階段驗證，不等於整體 certification 通過。

### runFullTrust 用途

Electron/Win32 desktop app 需要 native file access，管理使用者選擇的資料夾及筆儲存、MP3 播放和轉移、官方 BOOK downloads。使用者啟動 firmware upgrade 時，下載 checksum-verified vendor tools，需要時經 Windows UAC 同意提升權限。一般使用不需要管理員。

Store build 使用 Store-managed app updates。不要將日常 app launch 寫成「必須管理員」。

### Pricing and availability

最後可見設定：全球 240 markets、GBP base price £0、Public audience、可被搜尋、future markets 勾選；Release ASAP、Stop acquisition never。沒有 trial、sale pricing 或 free-offer 排程。

### Properties

- 最後可見 category：**Education → Instructional tools**，secondary category 留白。
- 曾建議 Utilities & tools 更符合裝置管理定位，但不要把建議寫成實際保存結果。
- Personal information 問題最後可見為 Yes。
- Privacy URL：`https://register.ponyabc.uk/privacy/desktop`
- Support 使用 account details，Redbourne Avenue / marketing email / company website / 上述電話。
- Mixed Reality display mode PC/HoloLens 均未勾；此 PC 欄位是沉浸式 MR，不是一般 Windows PC。
- 曾建議未驗證的 accessibility、alternate-drive install 等不要宣稱支援，pen/ink input 不是點讀筆、AI 編程不等於 app 含生成式 AI。最終每一個 declaration 沒有逐項保存截圖，不推定。

### Age ratings

App type：All Other App Types。沒有直接評級機構證書或實體媒體發行時，該題選 No。

根據功能曾提供以下填答方向，**最終 IARC 等級數字及完整回答未記錄**：

- 安裝包沒有性、暴力等 ratings-relevant content。
- 本地錄音/筆檔案轉移不等同 users online content sharing。
- 官方 BOOK catalog/download 是額外線上內容，Online Content 不應只因 app 是工具而一律 No。
- 不涉及限制年齡商品、精確位置分享、數位商品購買、NFT/現金獎勵或瀏覽器功能。
- 「主要是否新聞或教育產品」須按實際功能及問卷說明判斷；曾建議裝置管理用途選 No，不要將此當成已確認的最終回答。

### Store listing

- 完成英文 English (United States) listing。
- 有 5 張真實 Windows 截圖的準備報告；最終上傳張數未在本次後段逐張核實。
- 首次 submission 的 What's new 可留空。
- Trailer / Xbox art / optional short title / voice title 建議留空。
- 建議 Developed by：MACROKINETIC MEDIATECH LIMITED。
- 建議 copyright：© 2026 MACROKINETIC MEDIATECH LIMITED. All rights reserved.（需符合實際權利歸屬）
- 沒有額外 licence terms 時留空；不要臨時編造 EULA。

Short description 提供過：

> Manage recordings, educational BOOK content, and firmware for PonyABC P5 talking pens. A device-management tool for parents, teachers, schools, and organisations.

Keywords 提供過：PonyABC、P5、talking pen、audio transfer、firmware update、book library、device management。

長文案以 recordings、book library、guided firmware、language settings 為主，指出 pen transfers / firmware 需要兼容 P5 及 USB data cable，Bluetooth 不能代替這些操作；refresh catalog / new downloads 需要網路，已下載內容可離線使用。

## 9. Privacy page

- Desktop privacy：`https://register.ponyabc.uk/privacy/desktop`
- 原有 registration privacy：`https://register.ponyabc.uk/privacy`
- Claude 當時報告前者已部署、HTTP 200、毋須登入；後者未改，仍是原 placeholder。
- 部署從 isolated fresh clone 進行，避免碰 dirty working directory；web main 從 c925fe7 fast-forward 至 1e69fd0（據報告）。
- 文件描述本機 settings / folders / diagnostics、BOOK/firmware/update requests、另開瀏覽器 registration；不是所有資料都因本機處理而免除 privacy consideration。
- Cloudflare 該部署的實際 log retention 未確認；舊頁曾引用 Free/Paid default range，不能把它當成實際部署值。
- Claude 曾報告調查期間誤把部分 OAuth token 印到輸出，已記錄在 tasks/todo.md。本報告不包含 token；是否撤銷/輪換完成未在對話確認，若接手此事項要查看安全記錄，勿重新輸出 credential。

## 10. 商店 logo 檔案

此對話另外從原始 logo 產生白底、保持比例的 Store listing PNG（**不是拒絕後修復的 APPX assets**）。

資料夾：
`/Users/aiagent/Documents/Codex/2026-09-13/create-an-image-of-3/output/PonyABC-Store-Logos/`

ZIP：
`/Users/aiagent/Documents/Codex/2026-09-13/create-an-image-of-3/output/PonyABC-Store-Logos.zip`

| 檔案 | 尺寸 |
| --- | --- |
| PonyABC-Poster-Art-720x1080.png | 720×1080 |
| PonyABC-Box-Art-1080x1080.png | 1080×1080 |
| PonyABC-App-Tile-300x300.png | 300×300 |
| PonyABC-App-Tile-150x150.png | 150×150 |
| PonyABC-App-Tile-71x71.png | 71×71 |

Portal 當時把 poster 標成 9:16，卻列出 720×1080 / 1440×2160；輸出按畫面明列像素，而非自行按比例標籤猜尺寸。未來以當時上傳欄位規格為準。

## 11. Firmware 背景：避免交接後誤改

這是 Store 任務的背景，不代表本報告要求再改 firmware。

- 使用者實測升級後筆可正常播放；不能宣称 app 已讀回 on-pen firmware version。
- 曾因 vendor output GBK/CP936 被當 UTF-8 而亂碼，success signal 未被識別。
- Claude 報告修正 codepage/output decoding，隱藏 elevated command window，使用進行中 animation，不虛構百分比。
- 使用者要求正常完成 result 為簡單一句 **The firmware upgrade is completed. Please test.** 加一個 Finish；移除「I tested the pen」及「I understand — result unclear」按鈕。
- 真失敗、UAC declined、程序仍未確認停止要保留區別；不要因簡化文字而取消 lock/recovery safeguards。
- 使用者指定 Finish 回 firmware 首頁；是否最終實作應查程式，不要僅凭意向假定。
- v0.3.15 據報告新增持續寫入的 per-session diagnostics，raw + decoded output、codepage、signals、exit code、classification，最多 20 sessions / 每個 2MB raw。
- Export 位於 Settings → Support → Export firmware diagnostic logs，local-only；使用者自行輸出及傳送。
- vendor OTA capability table 的 FAIL、UFW 產生成功、no license 不能一概當作實際 flash 成敗；no license 真正含義當時未有 vendor 文件。
- 官方下載與測試資料夾入口曾被混淆；local-folder chooser 已移至 advanced/support，日常用戶走 official download。
- 本次 v0.3.16 Store 圖示修正明確沒有改 firmware 行為。

## 12. 短連結：未完成事項

使用者上架後覺得 Store URL 太長，要求 short URL。

- 已在 TinyURL 表格填好目標 `https://apps.microsoft.com/detail/9P544XC6B609`。
- 擬用 alias：`ponyabc-windows`。
- 因 Shorten Link 按鈕明示接受服務條款，當時停在確認／使用者自行操作步驟。
- 使用者說看不到頁面後，已顯示該 tab。
- **本對話沒有短連結建立成功證據，亦未驗證 alias 可用。不要對外把 `https://tinyurl.com/ponyabc-windows` 當成已生效連結。**
- Shell API 嘗試曾 DNS 失敗，沒有產生可用 URL。

## 13. 下一次更新流程及防止復發

1. 先查看 git status、分支、目前 build config、最新 Store package version。不要覆蓋使用者未提交變更。
2. 確認 `fix/store-tile-icons` 修復已包含在下次發佈來源，必要時正常整合；不要直接假定 main 已有。
3. 保持 Store identity 不變，使用比線上版本更高的 package version。
4. 在 Windows CI build，檢查最終包內實際 manifest、全部 tile/logo/scale assets、EXE icon、checksum；不能只看 source assets。
5. 根據變更做相應測試；圖示改動不需要反覆真機刷 firmware。
6. 準備版本說明及 reviewer notes，保留硬件/UAC 測試資訊。
7. Partner Center → Start update → Packages 換包 → 驗證 → Save，更新必要 listing / notes。
8. Complete 只是填寫完成；送審後等 Certification 通過。
9. 發佈設定按使用者要求，若人工 hold，通過後要 Publish now。
10. 確认 In Microsoft Store 及正式 Store 安裝結果；不要只憑 Publishing 宣稱可下載。

歷史簽署說明：Claude 表示 APPX 使用 CI temporary test certificate，並推測 Store 會重新簽署。後來 package 被接受及上架，不表示該推測已被本報告獨立核實。未來簽署流程以目前官方要求及實際 pipeline 為準，勿把 temporary certificate 派給普通 Store 用戶安裝。

## 14. 與使用者協作方式

- 使用者偏好廣東話／繁體中文、直接、逐步按畫面指導。
- 網址要展示完整 URL，方便複製。
- 不要反覆問已授權或已提供資料的問題；能從路徑讀取就直接讀。
- Claude Code 主要處理 repo / build；本對話 AI 主要解讀畫面、整理指示及生成素材；**Partner Center 填寫、送審及 Publish now 由使用者操作。**
- 區分「Claude 已寫入 markdown」與「已貼入 Partner Center」，不可混為一談。
- 本文件供背景理解，**不是允許任何 AI 自動發佈新版本、傳送訊息或改動帳戶的永久授權**；依照當前使用者任務執行。

## 15. 可直接貼給下一個 AI 的起始訊息

> 請先讀這份 PonyABC Microsoft Store 交接報告。產品已在 2026-09-28 上架，Store ID 9P544XC6B609。本次成功流程使用圖示修正的 APPX 0.3.16.0。不要重新開始首次提交。先依目前任務確認 repository 狀態，特別是 fix/store-tile-icons 是否已整合；保留 manifest identity，區分歷史報告與你親自驗證的結果。短連結尚無建立成功證據。除非我提出新改動，不要改 firmware 行為。
