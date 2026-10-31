
import type { Request, Response } from "express";
import { ZodError } from "zod";

import { registerSchema } from "./auth.schema.js";

import {
  registerUser,
  EmailAlreadyExistsError,
  loginUser,
  InvalidCredentialsError,
} from "./auth.service.js";

// ========================================
// 會員註冊 Controller
// POST /api/v1/auth/register
// ========================================

export async function registerController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // 1. 驗證前端送來的資料
    const input = registerSchema.parse(req.body);

    // 2. 呼叫 Service 建立會員
    const user = await registerUser(input);

    // 3. 註冊成功：HTTP 201
    res.status(201).json({
      data: {
        user,
      },
    });
  } catch (error) {
    // 4. 資料格式不正確：HTTP 400
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "註冊資料格式不正確",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    // 5. Email 已被使用：HTTP 409
    if (error instanceof EmailAlreadyExistsError) {
      res.status(409).json({
        error: {
          code: "EMAIL_ALREADY_EXISTS",
          message: "此 Email 已被註冊",
        },
      });
      return;
    }

    // 6. 其他未預期錯誤：HTTP 500
    console.error("Register error:", error);

    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "伺服器發生錯誤，請稍後再試",
      },
    });
  }
}

// ========================================
// 會員登入 Controller
// POST /api/v1/auth/login
// ========================================

export async function loginController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // 1. 呼叫 Service 驗證帳號與密碼
    const user = await loginUser(req.body);

    // 2. 登入成功：HTTP 200
    res.status(200).json({
      data: {
        user,
      },
    });
    return;
  } catch (error) {
    // 3. Email 或密碼錯誤：HTTP 401
    if (error instanceof InvalidCredentialsError) {
      res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email 或密碼不正確",
        },
      });
      return;
    }

    // 4. 資料格式不正確：HTTP 400
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "登入資料格式不正確",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    // 5. 其他未預期錯誤：HTTP 500
    console.error("Login error:", error);

    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "伺服器發生錯誤",
      },
    });
  }
}
