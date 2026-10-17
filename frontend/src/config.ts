// API 基础 URL：同域部署为空串，前后端分离时设为后端域名（如 https://api.plagent.com）
// 通过 Vite 环境变量覆盖：VITE_API_BASE=https://xxx.com npm run build
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
