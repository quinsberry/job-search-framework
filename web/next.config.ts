import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	serverExternalPackages: ['pdfjs-dist'],
	/* config options here */
	experimental: {
		agentFeedback: true,
	},
	cacheComponents: true,
	partialPrefetching: true,
	turbopack: {
		rules: {
			'*.css': {
				loaders: ['@tailwindcss/turbopack'],
				as: '*.css',
			},
		},
	},
};

export default nextConfig;
