/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          950: '#070a12',
          900: '#0b0f19',
          850: '#111726',
          800: '#172033',
          750: '#1e2942',
          700: '#263454',
          600: '#384b73',
          500: '#4e6599'
        },
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2'
        },
        emerald: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669'
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706'
        },
        rose: {
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48'
        }
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'glow-primary': '0 0 25px -5px rgba(99, 102, 241, 0.4)',
        'glow-cyan': '0 0 25px -5px rgba(6, 182, 212, 0.4)',
        'glow-emerald': '0 0 25px -5px rgba(16, 185, 129, 0.4)',
        'luxury': '0 10px 30px -10px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        'luxury-hover': '0 20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(99, 102, 241, 0.3)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [],
}
