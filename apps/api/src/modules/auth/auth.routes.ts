// Router()：建立會員驗證模組專用的路由。
import { Router } from "express";
// registerController：將收到的資料交給我們剛才完成的 Controller 處理。
import {
  registerController,
  loginController,
} from "./auth.controller.js";

export const authRouter = Router();

// .post("/register", ...)：接收前端的註冊 POST 請求。
// 會員註冊
authRouter.post("/register", registerController);

// 會員登入
authRouter.post("/login", loginController);
