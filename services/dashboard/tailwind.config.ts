import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // IntraBase dark theme — Supabase-inspired
        background: '#0f0f0f',
        surface:    '#1a1a1a',
        border:     '#2a2a2a',
        muted:      '#404040',
        accent:     '#3ecf8e', // Green brand color
        'accent-hover': '#2db87a',
        danger:     '#ef4444',
        warning:    '#f59e0b',
        info:       '#3b82f6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
