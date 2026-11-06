# 05 API契約與前後端整合

版本：2026-11-07詳細設計整合版。產品規則取01／02，資料取04、安全取06。**既有入口與規劃入口分開**；本輪未新增路由、OpenAPI或前端。具體未實作URL為契約命名規劃，實作前須以同一版OpenAPI／範例／Mock固化，不把下表當已有可用API。

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
- 編輯以body.expectedRevision為本輪命令基準（If-Match相容條件見05-08），與操作key不同：key防同意圖重送，revision防舊版本覆寫。現有草稿同欄序列最後寫入仍需遷移至此；改契約先相容測試，不直接宣稱新前端可用。
- 游標含排序鍵／規則版本而非可猜私有欄位；翻頁版本失效提示重整，不能默默改條件。搜尋每頁上限與匯入／上傳資源限制由09目標定義並實測。

## 05-06 整合交付

交付同版本OpenAPI、可執行schema／範例／Mock、錯誤與非同步狀態對照、公開／私有DTO白名單及前端交互驗收。付款確認中、容量未知、查核待補、交接過期、混合批次成功及隱私同步停止展示都須有畫面流程。UI由別人製作不代表可以省掉契約驗收；不把技術細節塞給租客決策。

## 05-07 命令契約與前端結果矩陣

以下全部是目標契約。現有路由保持「現況」標示，日後實作另作相容切換；不在本輪改程式。命令經驗身及所有權檢查後才回詳細問題，避免用驗證差異探查他人資料。

| 命令 | 提交必備 | 成功結果／衝突時 |
| --- | --- | --- |
| 建立草稿 | key、目前欄位規格、已填資料；持有人由session取得 | 201與id／revision；同key回同筆，額度不足不產生半筆 |
| 列出私人內容 | 本人、類型、有效狀態、游標 | 可看到自己的超額／回收／限制分區，不包含他人及私有群組關係 |
| 保存工作內容 | expectedRevision、patch；已填值格式合法 | 更新工作版不直接改公開版；衝突回最新revision，前端保留本地未送文字 |
| 預覽／發布／提交修改 | 當前工作revision、預覽ID、明示同意項目 | 預覽列缺項但不占正式位；提交重核後整版生效，衝突不自行重送新確認 |
| 狀態轉換 | action、expectedRevision、必要確認 | 回有效狀態及計數變化；不同action不共用任意status寫入 |
| 取消／查詢操作 | operationId且本人可看 | 已生效不能當未生效取消；返回safeNextAction，不能刪除操作紀錄 |
| 圖片上傳／換圖 | 使用權確認、key、目標位置／revision與檔案 | 回操作與圖位；換圖切換前失敗保舊圖，切換後顯示清理中 |
| 交接接受 | 邀請ID、預覽版本、接公開／封存選擇、聯絡與隱私確認 | 成功才移權；版本改變重新預覽，不能默認換接收者或狀態 |
| 訂購／升級 | quoteId、確認摘要、分開的續扣同意、key | 回訂單／操作；202不是已付款或已開通 |
| 退款終止 | 選定來源及終止範圍、預覽、key、近期再驗 | 返回終止時點與退款案件；詢問入口不終止 |
| 暫停／刪帳 | 影響預覽、revision、近期再驗、key | P02暫停與取消分開；刪帳顯示30天截止及取消追蹤，未確認不稱停扣 |
| 匯入確認 | previewId、選定rowIds、檔案摘要及key | 返回逐列原結果；失敗修正以新列版本處理，已成功列不重建 |

私人內容列表納入目標契約，不能只有知道id才可讀。公開／私人資源使用不同DTO，即使同一會員兩者都可看，也不可共用完整ORM物件。

## 05-08 版本與防重送的明確順序

1. 驗證請求結構及session；先確認是否為本人既有操作的安全重送。查原操作與修改目前內容是不同權限，移權後只可讀本人原操作的最少結果；新命令須核對目前資源存取，key不得取代授權。
2. 查同帳戶＋命令類型＋key。請求摘要相同且操作已有紀錄，回該操作可安全揭露的結果；成功後重送即使expectedRevision已舊，也不能再執行。持有人已變時只回本人原操作的最少結果，不回新持有人的私人內容。
3. 同key但不同內容、目標或確認摘要回409 IDEMPOTENCY_KEY_REUSED。進行中回202及原operationId，不另建工作。
4. 新操作才檢查expectedRevision及預覽依據；版本不符回409 REVISION_CONFLICT，不默默採用新值。
5. 同交易保存業務效果、revision、操作結果與必要Outbox。網路中斷由GET操作狀態或原key查回，不要求再次付款／再傳相同檔案來猜結果。

設計採body.expectedRevision作命令基準；將來若同時支援HTTP If-Match，兩者須一致，不能各判一次不同結果。缺少必要revision回400 REVISION_REQUIRED，版本變動回409；此為新增契約，不能假稱現有PATCH已採用。

key為不可猜UUIDv4；保存期依操作資料用途納D03。即使可回傳結果已過保存期，付款／退款／權益來源唯一性與不可重做證明仍須保護原業務，不以key過期當作同意重扣；結果不可再提供時回需核對，不當新操作。

## 05-09 DTO白名單與範例

| DTO | 可包含 | 禁止包含 |
| --- | --- | --- |
| 公開摘要／詳情 | publicId、公開revision、純月租／費用揭露、安全位置模式、當前公開聯絡、公開查核分項 | 私人地址、內部同房候選、證據、帳務、精確隱藏距離 |
| 本人工作內容 | 原值與legacy提示、工作revision、欄位issues、本人私人地址、公開預覽差異 | 他人資產URL／文件、服務憑證、管理員內部備註 |
| 帳務操作 | 本人實付／期間／退款進度、續扣授權狀態、可採取動作 | 完整支付通知、他人推薦交易、密鑰或支付工具秘密 |
| 案件 | 本人提交、需補資料、對自己處置及可申訴結果 | 對方私有證明、檢舉人個資、無工作必要的內部證據 |

範例（設計用，識別與revision均為示意）：

~~~json
{
  "data": {
    "operation": {
      "id": "op_example",
      "type": "REPLACE_IMAGE",
      "state": "COMMITTED_PENDING_EFFECTS",
      "currentRevision": 12,
      "safeNextAction": "VIEW_STATUS"
    }
  },
  "meta": { "requestId": "req_example" }
}
~~~

~~~json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "內容已更新，請重新檢視後再確認",
    "details": [{ "path": "expectedRevision", "reason": "STALE_VERSION" }]
  },
  "meta": { "requestId": "req_example", "currentRevision": 13 }
}
~~~

errors只列必要欄位與原因，不回顯密碼、完整電話、私有地址或輸入檔內容。前端依code／safeNextAction行動，不解析中文message。成功回應是否201／200／202依已建立、已同步完成、仍處理中區分；操作已提交而通知失敗仍回已提交，不回可重新付費的失敗。

## 05-10 尚未實作的契約交付順序

先將本章命令矩陣轉成同版機器契約，再做Mock及前端整合，不先讓兩邊各猜欄位。交付須逐命令有成功、欄位錯、越權、版本衝突、額度不足、來源未知、處理中及重送範例；不是每命令必有相同HTTP錯誤，但不適用須註明。

具體OpenAPI檔、可執行validator與Mock屬後續實作產物，本輪完成其語意及驗收需求，不把未建立的檔案列已交付。
