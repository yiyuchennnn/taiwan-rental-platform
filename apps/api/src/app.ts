
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { authRouter } from "./modules/auth/auth.routes.js";

export const app = express();

app.use(helmet());

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json({ limit: "1mb" }));

// 健康檢查
app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "taiwan-rental-api",
    timestamp: new Date().toISOString(),
  });
});

// 會員驗證路由
app.use("/api/v1/auth", authRouter);

// 找不到路由時回傳 404
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "API endpoint not found",
    },
  });
});
