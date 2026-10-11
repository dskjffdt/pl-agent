import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import 'normalize.css'


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* / 与 /chat/new 均为新会话视图；/chat/:id 按 URL 直达会话（刷新/前进后退/分享可恢复） */}
        <Route path="/" element={<App />} />
        <Route path="/chat/new" element={<App />} />
        <Route path="/chat/:id" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
