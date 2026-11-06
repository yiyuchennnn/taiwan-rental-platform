# taiwan-rental-platform

台灣租屋刊登平台。目前可驗證的是 Express API 的帳號、草稿及局部圖片／規則核心；尚未完成完整首發網站，不能直接當成可上線平台。

## 目前狀態與架構

- [03～12企劃規劃總覽](行政資料/03至12_規劃總覽與決策清單.md)：2026-11-07十章規劃、外部依賴及待選型；文件完成不表示實作／正式驗收完成。

- [進度執行表](docs/requirements/進度執行表.md)：目前唯一的狀態摘要，依 01／02 與後續明確同意決策對照。
- [01／02全文核對與待決討論](docs/requirements/01與02全文核對與待決討論_2026-11-06.md)：2026-11-06原文矛盾修正、待決方案、四種狀態與外部依賴。
- [全專案需求與相容性審查](docs/requirements/全專案需求與相容性審查.md)：2026-11-03 的缺陷、修正、證據與未完成。
- `apps/api/src/server.ts → app.ts → app-factory.ts` 是服務組裝入口；auth／listings／entitlements／media 分模組，router 接 service，資料庫與圖片儲存以依賴注入供整合測試使用。
- `apps/web`、`packages/contracts` 仍只有占位檔，沒有可啟動的前端或共用契約。`npm run dev:web` 目前不可用，根目錄 build 成功也不代表前端已建好。

## 重建與開發檢查

本次驗證環境為 Node 24.19.0、npm 11.9.0、Prisma client／adapter／CLI 7.10.1、PostgreSQL 17。其他版本尚未做完整矩陣驗收。

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
# DATABASE_URL 必須指向自己的隔離開發庫。generate 只產生 client，不遷移資料。
npm exec --workspace=@rental/api -- prisma generate
npm run typecheck
npm run build
```

安裝時略過 scripts 是既有專案的重建流程：保留原有 optional `prisma skills sync` hook，但不讓一般依賴安裝自動改動 agent 設定。需要的 Prisma client 於下一步明確產生。乾淨安裝已驗證原生圖片與密碼套件能在本次環境載入。

完整測試不讀正式 DATABASE_URL、不呼叫真實 R2；資料庫案例自行建立並清理暫存 cluster，需要 `initdb`／`pg_ctl` 在 PATH 且由非 root 執行。本雲端保留的工具可這樣使用（本機請按作業系統安裝 PostgreSQL 工具，不直接照抄 Linux 路徑）：

```sh
PATH=/workspace/.rental-tools/usr/lib/postgresql/17/bin:$PATH \
LD_LIBRARY_PATH=/workspace/.rental-tools/pg-libs \
npm test --workspace=@rental/api
```

開發服務使用 `npm run dev:api`；編譯後使用 `npm start --workspace=@rental/api`。必須先配置自己的開發 DATABASE_URL，預設 PORT 為 3000。`GET /api/v1/health` 只表示服務存活，不是資料庫／金流／圖片全部就緒。

repository目前有15個migration；隔離測試曾從空庫重建，常駐開發庫／正式庫已套用數須實際查核，不從檔案數推定。正式遷移前須另做備份與真實資料副本演練。不要把隔離庫的 trust 設定當成正式資料庫設定。行政 seed 只更新行政名稱與關聯，保留既有開放地區設定，不替營運者選首波地區。

## API 及圖片限制

- [草稿契約](docs/api/草稿API與待接依賴.md)、[圖片契約](docs/api/草稿圖片API與驗收.md)。沒有完整上架／公開搜尋 API。
- 圖片正式上傳預設關閉；R2 憑證存在不會自動啟用，也不表示 GB 與容量來源已決定。暫定圖片 profile 和容量純運算只完成局部核心。
- R2 金鑰僅由安全環境設定供應，不能提交到 Git、貼進報告或回傳前端。一般測試與比較工具不需要金鑰。
- `validate:r2` 是會產生少量遠端操作的獨立驗證，必須明確設 `R2_RUN_REMOTE_VALIDATION=1`；不屬一般測試或啟動流程。使用者先前已完成驗證，本次審查沒有重跑外部寫入。
- `compare:images` 本機產生 Markdown／PNG／JSON，另附離線 HTML；聊天介面可能只顯示 HTML 原碼。優先讀 [中文比較表](docs/database/圖片比較可讀版.md)。合成樣本不代表真實房源照片或會員容量估算。

尚未有正式 CORS 網域、限流、完整刊登資格、OAuth、前端、安全／效能／備份還原等上線驗收。版本交付依使用者指示直接提交並推送 GitHub main，不另建分支；環境發布不等於 GitHub 推送，本機 VS Code 仍需另行同步。
