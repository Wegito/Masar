/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './apps/booking/app/**/*.{js,ts,jsx,tsx}',
        './apps/company/app/**/*.{js,ts,jsx,tsx}',
        './packages/ui/components/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                brand: {
                    50:  '#eef9ff',
                    100: '#d9f0ff',
                    200: '#b6e2ff',
                    300: '#86cdff',
                    400: '#55b2ff',
                    500: '#2d93ff',   // used by .btn-primary
                    600: '#1674f2',   // used by .btn-primary:hover
                    700: '#0f5bd0',
                    800: '#104aa6',
                    900: '#123f84',
                },
            },
        },
    },
    plugins: [],
};
