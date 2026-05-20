import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const legacyPrefix = ['SU', 'ZIE', 'LAW_'].join('');
  const envValue = (key: string, fallback: string) =>
    env[key] || env[`${legacyPrefix}${key.slice('SCOPIC_'.length)}`] || fallback;
  const backendPort = envValue('SCOPIC_PORT', '17501');
  const clientPort = parseInt(envValue('SCOPIC_CLIENT_PORT', '17502'), 10);
  const upstreamRoot = resolve(__dirname, '../../../../teamsuzie_oss');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: clientPort,
      fs: {
        allow: [
          resolve(__dirname, '../../../..'),
          upstreamRoot,
        ],
      },
      proxy: {
        '/api': `http://localhost:${backendPort}`,
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
