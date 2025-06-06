import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/**/*.{test,spec}.{js,ts}'],
    },
    resolve: {
        alias: {
            '@lambda': path.resolve(__dirname, './src'),
        },
    },
});
