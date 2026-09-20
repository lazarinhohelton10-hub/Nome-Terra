/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0F1B1E',
          light: '#152428',
          lighter: '#1D3236',
        },
        gold: {
          DEFAULT: '#E8B54A',
          bright: '#F4CC70',
          dim: '#B98F3A',
        },
        mint: {
          DEFAULT: '#8FD9C4',
          dim: '#5FA893',
        },
        paper: '#F2EFE9',
        coral: '#E2694B',
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'letter-pop': {
          '0%': { transform: 'scale(0.4) rotate(-8deg)', opacity: '0' },
          '60%': { transform: 'scale(1.08) rotate(2deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'letter-pop': 'letter-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'slide-up': 'slide-up 0.3s ease-out both',
      },
    },
  },
  plugins: [],
};
