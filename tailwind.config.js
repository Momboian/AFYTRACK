/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Public Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },
      colors: {
        paper: '#F5F4EE',
        ink: { DEFAULT: '#14211F', soft: '#4A5856', faint: '#7C8886' },
        line: '#E2E0D6',
        brand: { 50: '#EAF4F1', 100: '#CFE6DF', 200: '#9FCDBF', 500: '#1C7A68', 600: '#14634F', 700: '#0F4C40', 800: '#0B3A31', 900: '#082A24' },
        ochre: { 50: '#FDF5E4', 100: '#FAE6BC', 500: '#D98E04', 600: '#B07203', 700: '#8A5902' }
      },
      boxShadow: { card: '0 1px 0 rgba(20,33,31,0.04), 0 1px 3px rgba(20,33,31,0.06)' }
    }
  },
  plugins: []
};
