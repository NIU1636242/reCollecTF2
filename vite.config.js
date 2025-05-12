import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), 

    {
      name: 'vite-plugin-range-requets',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.endsWith('.db')) {
            res.setHeader('Accept-Ranges', 'bytes')
          }
          next()
        })
      }
    
    }
  ],
  base: "/CollecTF/",
})
