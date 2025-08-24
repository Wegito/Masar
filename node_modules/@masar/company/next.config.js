/** @type {import('next').NextConfig} */
module.exports = {
    experimental: { serverActions: { bodySizeLimit: '2mb' } },
    transpilePackages: ['@masar/ui', '@masar/data']
};
