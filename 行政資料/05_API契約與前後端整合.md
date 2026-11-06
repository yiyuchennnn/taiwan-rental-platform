# 05 API契約與前後端整合

版本：2026-11-07規劃基準。產品規則取01／02，資料取04、安全取06。**既有入口與規劃入口分開**；本輪未新增路由、OpenAPI或前端。具體未實作URL為契約命名規劃，實作前須以同一版OpenAPI／範例／Mock固化，不把下表當已有可用API。

## 05-01 共通契約

- 版本前綴/api/v1；URL穩定識別不編碼私人位置。成功JSON沿既有`data`，失敗沿`error.code/message/details`；規劃新增requestId、operationId、revision等欄位不冒充既有回應。
- 時間ISO8601 UTC、台灣日期YYYY-MM-DD；金額整元、bytes十進位字串，精確計算值採字串表示不經浮點猜值。前端只呈現後端結果，不自行開通資格或計退款。
- 未送＝不改；允許null才清空；三個明細集合[]清空、陣列整組替換；不接受客戶端外鍵、角色、核准時間、firstPublishedAt、資產URL或狀態直接寫入。
- 400格式／跨欄矛盾，401未登入，403已驗身但動作無權，404不存在或非本人同回覆，409狀態／版本／額度衝突，413過大，415格式不支援，429限流，503來源／相依無法判定。不得把服務故障說成超額，錯誤不傳stack／秘密／私有證明。
- 私人及帳務回應no-store；公開回應只含允許投影與版本，隱私收緊可撤銷。204無body；日期／未知／缺值不能由前端自動填0或false。
- 所有預覽不是提交：提交帶當時revision及確認意圖；過期或方案／持有人／費用／隱私已變時409並要求重看，不能默默接受不同結果。

## 05-02 既有入口（現況）

| 路由 | 現有行為 | 尚缺 |
| --- | --- | --- |
| POST /auth/register、/auth/login | Email密碼、新帳號可信免費起點；login回Bearer及到期 | Email／身分查核不因此完成；網站cookie邊界尚未做 |
| GET /auth/me、POST /auth/logout | 查本人、撤銷session；logout204 | 裝置管理／其他session撤銷、重設、OAuth未做 |
| POST /drafts、GET/PATCH /drafts/:id | 本人DRAFT、新欄位／私人地址／子集合，新增查草稿額度 | 完整發布、版本衝突及其他狀態未做 |
| GET/POST /drafts/:id/images | 可注入圖片核心；POST原始binary、Idempotency-Key UUIDv4、X-Image-Rights-Confirmed:true | runtime缺可信容量來源且預設不啟用；不是正式公開上傳 |
| PUT圖片/order、/:mediaId/cover、DELETE /:mediaId、GET /:mediaId/:variant | 排序／封面／移引用／私有display或thumbnail | 正式容量、換圖、公開存取與清理worker未完成 |
| GET /health | 程序存活 | 不等於DB、外部能力與收費就緒 |

既有JSON限制1MB、草稿圖片原檔10000000 bytes是現況／產品限制，不因本章而重新設定正式proxy。前端尚不存在，不宣稱以上有UI。

## 05-03 草稿欄位契約

- 新出租型態ENTIRE_HOME／ENTIRE_BUILDING／INDEPENDENT_SUITE／SHARED_SUITE／ROOM；建物APARTMENT／ELEVATOR_BUILDING／MID_RISE／TOWNHOUSE／OTHER_RESIDENTIAL。
- areaSource為INTERIOR／REGISTERED／ESTIMATED；areaPings依02的0.01～10000與最多2位，舊areaType不猜轉換。
- 電梯／汽機車位YES／NO／UNKNOWN；寵物／開伙ALLOWED／NOT_ALLOWED／DISCUSS；洗曬PRIVATE／SHARED／NONE／UNKNOWN；垃圾STAFF／CENTRAL／SELF／OTHER／UNKNOWN；租補ACCEPTED／NOT_ACCEPTED／UNKNOWN。
- floors多層清單去重、樓層與totalFloors符合02；指定入住按台灣日期，舊日期在無關編輯保留；minimumLeaseMonths 1～120。
- utilityCharges為四種kind不重複，模式INCLUDED／BY_BILL／METERED／FIXED／NOT_PROVIDED；季節不同只variableRate與說明，不造單一價。equipmentItems九種code及明確三態；feeItems表明種類、模式、整期金額、週期、必要或選配。
- address的棟別／室號來源／地址種類為私人工作資料；非標準地址並未因此核准。聯絡、驗證、完整費用比例及完整發布仍需後續服務，不因草稿200就認定有效公開。
- 新版集合與舊聚合不混寫；舊值可讀回待修正，不為HTTP往返自動回填新語意。新增加的比例費模型須單獨遷移與契約，現有feeItems不能冒充已支援全部R03。

## 05-04 規劃中的業務入口

下表均為**規劃**。私有前綴/me、操作前綴/operations、管理前綴/admin，避免與現有草稿混淆。

| 家族／命名規劃 | 請求／結果要點 |
| --- | --- |
| /listings、/listings/:publicId、/map-results | 訪客公開篩選、排序、游標與privacyVersion；只公開資料／安全群組，私有位置永不回傳 |
| /me/listings/:id/preview、/publish | 預覽revision、完整issue清單與確認摘要；提交重核後變狀態，不接受前端canPublish |
| /me/listings/:id/transitions | 明確action：archive、mark-rented、to-draft、trash、restore、permanently-delete；各自確認與原狀態，不讓任意status PATCH |
| /me/listings/:id/work-version、/submit-changes | 一個待提交版，revision衝突不覆蓋；地址／出租範圍改動按R04先必要下架 |
| /me/images/replacements、/operations/:id | 指定內容、位置、舊asset、版本及新圖；查處理／未生效失敗／已生效清理中／完成；不重送成第二換圖 |
| /me/transfers、/:id/accept/reject/cancel | 一筆邀請、目標確認與接公開／封存選擇；最新驗證、72h及P01重核，不讓客戶端自行指定成功 |
| /me/subscription/quotes、/orders、/renewal | 報價10分鐘且不跨到期；列當期／下期及明確授權；付款確認中不重收，跳轉不是成功 |
| /webhooks/payments/:provider | 原始body驗簽／防重放、持久事件去重；回查可信供應商事實，不開一般會員資格核發 |
| /me/refunds、/:id/confirm-termination | 詢問與正式終止分開，選來源、鎖定終止時間、查看應退／送出／結果；非同步退未完成不假成功 |
| /me/rewards、/me/grants、/admin/grants | 原年度／來源及本人確認；管理員不得自核；同來源不重發，不把臨時筆數換成方案時間 |
| /me/verifications、/admin/verifications | 只最少必要欄位與私有證據，分項待補／結果／申訴；核准只能有權管理員且留Audit |
| /me/account/pause/resume、/deletion/request/withdraw | P02暫停不自動停扣；刪帳取消需追蹤，撤回不重啟已取消授權或復刊 |
| /brands/:publicId、/agents、/articles | 公開DTO、固定識別；私人/me/brand、/me/articles與平台/admin/articles分權 |
| /me/favorites、公開比較資料查詢（非持久比較資源） | 收藏登入本人且刊登唯一；訪客比較最多4筆由前端短期保存、公開批次查詢最多4個刊登ID，不新增持久比較／分享資源，後端仍查公開最新，不存私密快照 |
| /me/cards、/me/imports/preview/commit、/bot/webhook | 製卡進階、文字匯入基本、Bot進階；版本／操作去重、批次結果與100列限制，不直接公開 |
| /me/notifications、/reports、/appeals | 收件人／本人案件隔離；同案補充、私有證據不進公開結果 |
| /subsidy/policies、/subsidy/calculate | 訪客、版本及地區，必要條件但不收姓名證件、不保存填答；缺規則回未提供而非金額0 |

每個家族實作前須補請求／回應JSON Schema、範例、機器錯誤碼、權限與冪等範圍，並與10對應。這是契約設計清單，不是新增產品；不得只做路由名字就宣稱API完成。

## 05-05 關鍵資料格式與防重送

規劃的公開房源摘要須區分：純月租、固定必要費月平均及約值標記、用量另計、押金／一次費／選配；公開位置只含允許版本、範圍及概略提示，聯絡只該刊登目前對象。群組明列命中N／公開M，不交出私有成員名單。

規劃的操作回應：`data.operation`含id、type、state、currentRevision、safeNextAction；202只表示已受理可查，不表示付款／換圖／取消續扣完成。成功查回結果不得重建副作用，未就緒有可重試原因不叫客戶重付。

- 高風險提交使用Idempotency-Key，同帳戶＋操作類型＋key唯一，保存請求摘要與已提交結果。同key不同body回409，同key相同body回原結果；未完則回原operation，不能新扣款。
- 已有圖片操作的key、權利確認及digest沿用，不改為純client任意asset URL。一般目前草稿POST尚無完整冪等契約，後續要補而非假稱已支援。
- 編輯以revision／If-Match規劃，與操作key不同：key防同意圖重送，revision防舊版本覆寫。現有草稿同欄序列最後寫入仍需遷移至此；改契約先相容測試，不直接宣稱新前端可用。
- 游標含排序鍵／規則版本而非可猜私有欄位；翻頁版本失效提示重整，不能默默改條件。搜尋每頁上限與匯入／上傳資源限制由09目標定義並實測。

## 05-06 整合交付

交付同版本OpenAPI、可執行schema／範例／Mock、錯誤與非同步狀態對照、公開／私有DTO白名單及前端交互驗收。付款確認中、容量未知、查核待補、交接過期、混合批次成功及隱私同步停止展示都須有畫面流程。UI由別人製作不代表可以省掉契約驗收；不把技術細節塞給租客決策。
