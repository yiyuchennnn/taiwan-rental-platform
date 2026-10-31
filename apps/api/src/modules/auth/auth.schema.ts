// 1. z.object() 定義 API 允許接收哪些欄位，以及各欄位的資料格式。
// 2. .trim() 移除 Email、姓名前後多餘的空白，避免不必要的輸入錯誤。密碼不使用 .trim()，因為空白也可能是密碼的一部分。
// 3. .min() 和 .max() 限制字串長度。這裡先採用至少 12 字元的密碼規則，之後可依產品需求調整。
// 4. .optional() 表示 name 可以不填。這與目前 Prisma User.name String? 的設計一致。
// 5. z.infer<> 讓 TypeScript 自動從 Zod 規則推導資料型別，避免驗證規則和 TypeScript 型別各寫一份，日後產生不一致。
// 另外，Zod 的驗證只是第一道防線。真正的會員註冊 API 還需要處理 Email 重複、密碼雜湊、資料庫寫入與錯誤回應。

import { z } from "zod";
// 註冊資料驗證
export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .email("請輸入有效的 Email")
    .max(254, "Email 長度不可超過 254 字元"),

  password: z
    .string()
    .min(12, "密碼至少需要 12 個字元")
    .max(128, "密碼不可超過 128 個字元"),

  name: z
    .string()
    .trim()
    .min(1, "姓名不可為空")
    .max(100, "姓名不可超過 100 個字元")
    .optional(),
});

// 登入資料驗證
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email("請輸入有效的 Email")),

  password: z.string().min(1, "請輸入密碼"),
});

// 從 Schema 自動產生 TypeScript 型別
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
