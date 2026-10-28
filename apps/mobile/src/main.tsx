import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import { ThemeProvider } from './theme/ThemeProvider'
import './styles.css'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('Missing #root element')

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
)
