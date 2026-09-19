/**
 * Token warna mengikuti palet data-viz yang sudah divalidasi.
 * Warna status sengaja TIDAK dipakai sendirian: setiap lencana status selalu
 * membawa ikon dan teks, karena `warning` dan `serious` berada di bawah rasio
 * kontras 3:1 pada permukaan terang.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#fcfcfb',
        plane: '#f9f9f7',
        ink: {
          DEFAULT: '#0b0b0b',
          secondary: '#52514e',
          muted: '#898781',
        },
        hairline: '#e1e0d9',
        baseline: '#c3c2b7',
        accent: {
          50: '#cde2fb',
          100: '#b7d3f6',
          200: '#9ec5f4',
          300: '#86b6ef',
          400: '#5598e7',
          500: '#3987e5',
          600: '#2a78d6',
          700: '#256abf',
          800: '#1c5cab',
          900: '#184f95',
        },
        status: {
          good: '#0ca30c',
          warning: '#fab219',
          serious: '#ec835a',
          critical: '#d03b3b',
        },
        success: '#006300',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,11,11,0.04), 0 1px 3px rgba(11,11,11,0.06)',
        pop: '0 8px 24px rgba(11,11,11,0.12)',
      },
    },
  },
  plugins: [],
};
