import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import 'normalize.css'

// 全局兜底：JS 运行时错误（老浏览器不支持某 API、setTimeout 回调 throw 等）
window.addEventListener('error', (e) => {
    if (import.meta.env.DEV) console.error('[window.error]', e.error ?? e.message)
})

// Promise 链未 catch（fetch 漏 catch、SSE 异步回调 throw 等）
window.addEventListener('unhandledrejection', (e) => {
    if (import.meta.env.DEV) console.error('[unhandledrejection]', e.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* / 与 /chat/new 均为新会话视图；/chat/:id 按 URL 直达会话（刷新/前进后退/分享可恢复） */}
          <Route path="/" element={<App />} />
          <Route path="/chat/new" element={<App />} />
          <Route path="/chat/:id" element={<App />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
