# API 契約交付

版本2026-11-12。這裡現在有實際產物，不再只有占位；不代表整份01～12的所有功能都有API。

- [openapi.v1.json](openapi.v1.json)：OpenAPI 3.1，現有入口的請求、主要回應、白名單、版本與操作識別條件。
- [examples.v1.json](examples.v1.json)：明確測試用的操作回應與錯誤／前端恢復建議。
- [整合手冊](../../docs/api/後端主流程與前端整合.md)：操作順序、兼容切換、圖片、重試、限制。
- [規則覆蓋與驗證](../../行政資料/歷史紀錄/執行與交付/2026-11-12_後端主流程與契約驗證.md)：本批做了哪些與沒有做哪些。

從實際服務使用的Zod產生請求schema，執行：

```sh
npm run contracts:export --workspace=@rental/api
npm run contracts:check --workspace=@rental/api
npm run contracts:mock --workspace=@rental/api
```

Mock僅綁127.0.0.1:4010（可用CONTRACT_MOCK_PORT改），不連DB、R2或任何正式服務；每個回應都有X-Contract-Mock:true。它是無狀態UI範例，不驗證真登入、不保存表單、不證明身分或付款；不能當成真正端到端後端測試。需要跨埠由前端開發伺服器代理，不預設UI框架。

可使用`X-Mock-Scenario: REVISION_CONFLICT`等範例情境；正常命令仍檢查請求schema與UUIDv4 Idempotency-Key。Mock目前覆蓋私人讀取／列表／操作查詢及五類內容命令，不假稱支援所有Auth／圖片／支付等模組。

真正的無UI主流程測試在apps/api/tests/content-flow.test.ts，透過實際createApp、隔離PostgreSQL及Sharp處理執行。正式發布的持久查核來源、容量／權益生命週期仍未接妥，runtime不注入測試證據。

JSON Schema不能完全表達可見字元、精確小數、跨欄及查核規則，不能只靠前端生成器判定發布。回應保留歷史原值，與新寫入的語意驗證分開。變更validator後必須重產契約並執行check，避免手改JSON造成分歧。
