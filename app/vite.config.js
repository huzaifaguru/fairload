import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Relative base so the build works from any static host or subfolder.
export default defineConfig({ plugins: [react()], base: './', worker: { format: 'es' }, build: { target: 'es2020', chunkSizeWarningLimit: 1500 } });
