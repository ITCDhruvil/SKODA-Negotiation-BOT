/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No ESLint in this POC: types are checked with `npm run typecheck`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
