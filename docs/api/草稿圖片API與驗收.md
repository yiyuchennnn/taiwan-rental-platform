# 草稿圖片 API 與驗收（2026-11-02）

> 2026-11-06狀態註記：下文保留該批歷史規格／驗收事實，不能當作現行產品基準或最新全量測試。最新依行政資料01／02與 [目前進度](../requirements/進度執行表.md)；套房合併、免面積來源、舊C01及無限公開等過往決策若與新版R02／02-01／02-09衝突，均已被取代。新欄位、完整上架與正式容量尚未全部接妥。

依據：01 首發刊登範圍、02-06 照片 3～30 張／封面／權利確認、02-09 私有資產、引用與容量規則。沒有新增方案 GB 或正式壓縮規格。本批完成可注入依賴的 API 與核心，正式上傳尚未啟用。

## API 契約

共同前綴 `/api/v1/drafts/:id/images`，必須使用既有 Bearer session。每次操作在資料庫交易中重驗有效登入、帳號啟用、刊登所有權與 DRAFT；外部儲存完成後再次檢查。外人／不存在回 404；非草稿回 409。管理員角色不自動繞過所有權。

| 方法與路徑 | 輸入／行為 |
| --- | --- |
| GET `/` | 私有圖片清單：id、assetId、順序、封面與位元組字串；不回傳儲存網址或 nonce |
| POST `/` | 單張原始二進位，Content-Type 為 image/jpeg、image/png、image/webp 或 application/octet-stream；實際格式由解碼器判斷。標頭 `X-Image-Rights-Confirmed: true`、`Idempotency-Key: UUIDv4` 必填 |
| PUT `/order` | JSON `{ "ids": ["全部目前圖片 id，依新順序"] }`；缺漏、重複、混入別筆或過時清單拒絕 |
| PUT `/:mediaId/cover` | 空 JSON；交易內先清原封面再設定，沿用資料庫單封面唯一限制 |
| DELETE `/:mediaId` | 移除該草稿引用；最後引用移除才清資產。回覆 images、cleanupPending；儲存失敗保留持久化清理工作 |
| GET `/:mediaId/display` 或 `thumbnail` | 經所有權授權後讀回 WebP，Cache-Control: no-store；不把私有儲存位置交給前端 |

上傳不自動指定封面；刪除封面不擅自指定替代圖，草稿允許零封面，上架檢查仍要求一張。3 張是上架最低張數，草稿可少於 3 張。此處沒有圖片替換 API，也未決定容量全滿時替換（C12）。舊 URL 資料保留、可排序／移除引用；私有讀取路由只支援新管線已記錄的資產，不抓取任意舊 URL。

重試相同使用者、同一 request key、同一草稿與原始內容，已成功工作回傳現有清單，不重建資產。鍵碰撞到不同內容／草稿拒絕；處理中／已移除的工作不擅自重建，提示重新載入。上傳識別碼與原始內容 SHA-256 存入資料庫，原圖不長期保存。

## 資料與失敗回復

新增 additive migration `20261102000400_add_media_upload_recovery`，建立 MediaUpload，保留使用者／草稿快照、request key、原圖摘要、私有 namespace、nonce、權利確認時間、實際處理後 reservedBytes、狀態及操作 lease。刻意不連帶 cascade 刪除此工作表：即使內容移除，仍可核對儲存殘檔。此表不是新增帳號或原圖的永久保存政策，正式資料留存仍待規格。

流程：先授權、解碼及去除 metadata，再於帳號／草稿鎖內檢查既有圖片加 PENDING 保留名額不得超過 30、呼叫可信容量介面，建立 PENDING；接著條件式寫入 R2。成功後交易重驗權限／狀態，建立 MediaAsset／ListingMedia 及 ATTACHED。展示／縮圖實際 bytes 與去 GPS 時間都有紀錄。R2 nonce 先持久化，再發出 reservation 寫入。

儲存或接入交易失敗，工作由 PENDING 改 CLEANUP 後核對 nonce 清理；若交易已提交但回應遺失，ATTACHED 不會被失敗補償清掉。清理失敗保留 CLEANUP，下次使用新 adapter 可用持久化 proof 核對後重試。移除引用但檔案尚未清完時，容量來源必須繼續計入 CLEANUP 的實占大小，不能提前釋放。

`recoverExpired()` 是內部服務方法，沒有公開管理路由或已排程 worker。優先處理 CLEANUP，最多取 100 筆；逾時 PENDING 僅列入 pendingReview，不自動刪除。原因：逾時不等於寫入者停止，直接清除可能與仍在上傳的程序競爭。現在方案是停止並確認相關寫入者後人工核對；若要自動恢復，後續須加入可中止／隔離的 worker 與持久化工作協調，不能只憑過期時間刪檔。遺留 PENDING 仍占名額與容量，不能當作已失敗釋放。

## 正式啟用仍受限

- `IMAGE_UPLOADS_ENABLED` 預設未啟用；R2 憑證存在不會啟用圖片 API。未配置時已登入請求回 503。
- 2026-11-03 後續：使用者已接受暫定驗證規格，runtime 採 `image-profile.ts` 的 10,000,000 bytes／1920／480／品質 82。若舊 IMAGE_MAX_INPUT_BYTES／IMAGE_DISPLAY_MAX_EDGE／IMAGE_THUMBNAIL_MAX_EDGE／IMAGE_WEBP_QUALITY 設定與其衝突，明確拒絕啟動而非靜默忽略。運作資源仍須提供 IMAGE_MAX_INPUT_PIXELS、IMAGE_TIMEOUT_SECONDS、IMAGE_UPLOAD_LEASE_MS，正式上傳旗標仍未啟用。
- 上傳必須注入 `authorizeCapacity(tx, userId, incomingBytes)`；缺少時回 IMAGE_CAPACITY_UNAVAILABLE，不能把未知 GB 當成無上限。目前正式 runtime 故意不注入虛構額度。這個介面須在帳號鎖下核對有效方案、既有／PENDING／CLEANUP 大小與未知舊資產；真正的計量、80% 提醒、100% 阻擋與跨方案容量來源尚未完成。
- 前述規格已獲使用者暫定同意並回寫 02 企劃修訂紀錄，不代表代表性房源照片的畫質比較或正式 GB 方案已定案。
- R2 bucket 仍是專用驗證桶，不等同正式上線儲存。沒有啟用公開網址、前端 UI、正式上架／對外圖片發布流程。

## 驗收證據

本批新增 14 項草稿圖片隔離 PostgreSQL／HTTP／儲存故障案例，以及 1 項實際 S3 SDK transport 的程序重啟 proof 回復案例；完整測試由 190 增至 205 項通過。涵蓋所有權與權利確認、假格式／超大圖、單封面併發、最後名額競爭、部分寫入失敗、清理失敗後新 instance 重試、共用引用、過期工作不誤刪、外來 nonce 不誤刪、容量缺失、容量介面鎖定、重試不重複、儲存期間狀態變更。型別檢查、編譯、diff 檢查通過。已知 Prisma／pg concurrent-query 棄用提示仍在，未自行升級套件。

新增案例使用隔離暫存 PostgreSQL 和測試儲存，不呼叫真實 R2，不讀正式 DATABASE_URL。此前真實 R2 的上傳、逐位元讀回、簽名讀取、未簽名拒絕與清除成功，另記於 `docs/decisions/R2驗證設定與操作指引.md`；不能把兩種測試混成正式端到端上線驗收。

未提交、推送或發布。本批沒有改寫未確認的兩份企劃原文。

隔離雲端開發庫已先備份至 `/workspace/.rental-backups/before-media-recovery-20261102.dump`，再成功套用新增表 migration，現共 13 個。未套用到使用者本機或正式資料庫。

2026-11-03 全專案審查補充：共用資產移除改為先鎖資產以處理跨會員最後引用並發；實際 App 組裝加入整合驗證；APNG 控制區塊另行辨識，避免動畫被默默取第一格。最新完整結果以全專案審查及進度執行表為準，前文 205 為該批歷史結果。
