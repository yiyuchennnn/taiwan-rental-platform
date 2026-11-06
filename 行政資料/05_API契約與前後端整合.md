# 05 API契約與前後端整合

狀態：2026-11-06已接入的草稿API片段；非全平台契約，無前端驗收。

## 入口

- POST /api/v1/drafts：登入、可信資格及草稿空位，允許缺必填的草稿。
- GET /api/v1/drafts/:id：僅本人且仍為DRAFT。
- PATCH /api/v1/drafts/:id：本人DRAFT；未送出保留，null僅允許的純量／地址可清空；空PATCH不修改。
- 回應data.draft為私有編輯資料，不可直接作公開DTO。聯絡格式／驗證與完整發布關卡尚未全部完成，不能把200視為可刊登。

## 本批新輸入

- rentalType：ENTIRE_HOME／ENTIRE_BUILDING／INDEPENDENT_SUITE／SHARED_SUITE／ROOM。
- buildingType：APARTMENT／ELEVATOR_BUILDING／MID_RISE／TOWNHOUSE／OTHER_RESIDENTIAL。
- areaSource：INTERIOR／REGISTERED／ESTIMATED；areaPings 0.01～10000，最多2位小數。
- elevatorStatus、carParkingStatus、motorcycleParkingStatus：YES／NO／UNKNOWN；petPolicy、cookingPolicy：ALLOWED／NOT_ALLOWED／DISCUSS。UNKNOWN／DISCUSS與未填null不同，不轉成false。
- laundryStatus、dryingStatus：PRIVATE／SHARED／NONE／UNKNOWN；garbageStatus：STAFF／CENTRAL／SELF／OTHER／UNKNOWN；subsidyPolicy：ACCEPTED／NOT_ACCEPTED／UNKNOWN。
- minimumLeaseMonths：1～120；floorMode新增MULTIPLE、floors為去重樓層清單，其他模式不得混填。樓層-20～-1或1～200；地上層不大於totalFloors。
- occupancyMode新增NEGOTIABLE；IMMEDIATE／NEGOTIABLE不用指定日期，新提交availableFrom按台灣今日至5年。舊日期無關修改保留。
- address新增buildingNumber、roomIdentifierSource（OFFICIAL／CUSTOM）、addressKind（STANDARD／NONSTANDARD）；非標準地址並未因此取得人工核准。
- utilityCharges：kind為WATER／ELECTRICITY／GAS／INTERNET且不重複，模式INCLUDED／BY_BILL／METERED／FIXED／NOT_PROVIDED。季節差異可variableRate:true＋description，不同時填虛構單一rate，不分段計算。
- equipmentItems：固定9項code＋YES／NO／UNKNOWN，不重複；未填不是「無」。
- feeItems：kind／label／mode／amount／frequency／required／description；週期MONTHLY／QUARTERLY／YEARLY／ONCE。可另租車位required:false；目前未有租客總費用計算或正式發布驗收。
- 三種集合省略保留，[]清空，陣列整組替換，不接受null或元素id／listingId。回應不附子資料外鍵。

## 相容與錯誤

新版集合與對應舊聚合欄位不可混送。舊資料可讀回，但重新提交新型態時不可用舊SUITE等模糊值。部分舊欄位仍供相容，前端應使用新版集合；完整欄位白名單依draft.schema.ts，不自行傳資料庫欄位。

400格式／禁止欄位／新舊衝突；401憑證無效；404不存在或非本人同回覆；409非草稿／草稿額滿；503資格來源不可判。錯誤不公開內部資料；GET／PATCH不快取。

## 待補

完整費用比例與必填、電話／LINE驗證、對外版本控制、公開DTO、上架／刪除／交接／帳務等契約及前端Mock／UI均未完成。不可由本API改status、publisherId、firstPublishedAt、核准時間或公開同意時間。
