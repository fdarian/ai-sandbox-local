import { withPreset } from '@fdarian/blume-preset';
import { defineConfig } from 'blume';

export default defineConfig(
	withPreset({
		title: 'ai-sandbox-local',
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
