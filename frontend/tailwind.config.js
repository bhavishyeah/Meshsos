/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        emergency: {
          police: '#dc2626',
          medical: '#2563eb',
          food: '#16a34a',
          children: '#eab308',
        },
        connectivity: {
          connected: '#16a34a',
          weak: '#f59e0b',
          offline: '#dc2626',
        },
      },
      minWidth: {
        'touch': '48px',
      },
      minHeight: {
        'touch': '48px',
      },
    },
  },
  plugins: [],
};
