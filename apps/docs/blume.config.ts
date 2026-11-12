import { withPreset } from '@fdarian/blume-preset';
import { defineConfig } from 'blume';
import { posthog } from 'blume/analytics';

const ph = process.env.POSTHOG_KEY;

export default defineConfig(
	withPreset({
		title: 'ai-sandbox-local',
		...(ph ? { analytics: [posthog({ key: ph })] } : {}),
		description:
			'Run AI SDK harness agents against your real filesystem and processes.',
		github: {
			owner: 'fdarian',
			repo: 'ai-sandbox-local',
			dir: 'apps/docs',
		},
		deployment: {
			site: 'https://ai-sandbox-local.fdarian.com',
		},
	}),
);
