import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import ion from 'vite-plugin-ion';

export default defineConfig({ plugins: [ion(), react()] });
