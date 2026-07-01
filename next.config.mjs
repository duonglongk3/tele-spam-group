/** @type {import('next').NextConfig} */
const nextConfig = {
  // In Electron production mode, use static export
  // For development, keep server mode
  ...(process.env.ELECTRON_BUILD === 'true' ? { output: 'export' } : {}),
  images: {
    unoptimized: true,
  },
  // Disable x-powered-by header
  poweredByHeader: false,
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
}

export default nextConfig

