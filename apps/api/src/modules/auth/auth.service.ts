// 1. 密碼不會以明文儲存例如使用者輸入：MySecurePassword123!，資料庫儲存的會是 Argon2id 雜湊結果，而不是原始密碼。登入時再使用 argon2.verify() 比對。
// 2. 不允許前端指定角色我們直接在後端設定：role: "RENTER"，因此即使有人在註冊請求中加入 role: "ADMIN"，這段 Service 也不會採用該值。import argon2 from "argon2";
// 3. 不會回傳密碼雜湊值select 明確限制查詢結果，只回傳：id、email、name、role、createdAt。這可以避免不小心把 passwordHash 傳給前端。
// 4. 使用資料庫唯一鍵防止重複註冊，你的 Prisma User.email 已經有 @unique。因此即使兩個註冊請求同時送出相同 Email，資料庫仍會阻止重複建立，並由程式處理 P2002 錯誤。
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  registerSchema,
  loginSchema,
  type RegisterInput,
  type LoginInput,
} from "./auth.schema.js";

// 自訂錯誤：Email 已經被註冊
export class EmailAlreadyExistsError extends Error {
  constructor() {
    super("此 Email 已被註冊");
    this.name = "EmailAlreadyExistsError";
  }
}

// 建立會員
export async function registerUser(input: RegisterInput) {
  // 再次驗證輸入資料
  const data = registerSchema.parse(input);

  // 將 Email 統一轉成小寫
  const email = data.email.toLowerCase();

  // 使用 Argon2id 雜湊密碼
  const passwordHash = await argon2.hash(data.password, { //argon2.hash()：將原始密碼轉換成安全的雜湊值。
    type: argon2.argon2id, // argon2.argon2id：指定使用 Argon2id 演算法。
  }); // passwordHash：儲存雜湊結果，準備寫入 Neon。

  try {
    // 寫入 Neon PostgreSQL
    const user = await prisma.user.create({
      data: {
        email,
        name: data.name,
        passwordHash,
        role: "RENTER",
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    return user;
  }

  catch (error) {
    // 資料庫唯一鍵衝突：避免重複 Email
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new EmailAlreadyExistsError();
    }
    throw error;
  }
} // 結束 registerUser() 函式

// 自訂錯誤：帳號或密碼不正確
export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email 或密碼不正確");
    this.name = "InvalidCredentialsError";
  }
}
// 使用者登入
export async function loginUser(input: LoginInput) {
  // 1. 驗證登入資料
  const data = loginSchema.parse(input);

  // 2. 統一 Email 格式
  const email = data.email.toLowerCase();

  // 3. 根據 Email 查詢使用者
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      passwordHash: true,
      createdAt: true,
    },
  });
  // 4. 不透露帳號是否存在
  if (!user || !user.passwordHash || !user.isActive) {
    throw new InvalidCredentialsError();
  }
  // 5. 驗證密碼
  const isPasswordValid = await argon2.verify(
    user.passwordHash,
    data.password
  );
  if (!isPasswordValid) {
    throw new InvalidCredentialsError();
  }
  // 6. 登入成功，不回傳密碼雜湊
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}
