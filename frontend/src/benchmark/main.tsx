import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import BenchApp from './BenchApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BenchApp />
  </StrictMode>,
)
