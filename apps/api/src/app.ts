import express from "express";
import cors from "cors";
import helmet from "helmet";

export const app = express();

// HTTP 安全標頭
app.use(helmet());

// 允許本機前端呼叫 API
app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

// 解析 JSON 請求內容
app.use(express.json({ limit: "1mb" }));

// 第一支 API：健康檢查
app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "taiwan-rental-api",
    timestamp: new Date().toISOString(),
  });
});

// 找不到 API 路由時回傳 404
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "API endpoint not found",
    },
  });
});
