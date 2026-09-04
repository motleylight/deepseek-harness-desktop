import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProviders } from './components/app-providers'
import { App } from './layout'
import '@/utils/logger'
import './style/main.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProviders><App /></AppProviders>
  </React.StrictMode>,
)
