import type { HarnessV1SandboxProvider } from '@ai-sdk/harness';
import {
	createLocalSandboxSession,
	type LocalSandboxSessionOptions,
} from '#src/create-local-sandbox-session.ts';
import type { LocalNetworkSandboxSession } from '#src/local-network-sandbox-session.ts';

type CreateSessionOptions = Parameters<
	NonNullable<HarnessV1SandboxProvider['createSession']>
>[0];

export type LocalSandboxProviderSettings = Omit<
	LocalSandboxSessionOptions,
	'abortSignal'
>;

/**
 * `HarnessV1SandboxProvider` over `node:child_process` + `node:fs` — the
 * real host filesystem and real processes, standing in for the two shipped
 * providers (`@ai-sdk/sandbox-vercel`, remote-only, and
 * `@ai-sdk/sandbox-just-bash`, an in-memory virtual filesystem), neither of
 * which can operate on the user's actual git worktree.
 *
 * For `HarnessAgent({ sandbox })`, which is deprecated in favour of passing a
 * session from `createLocalSandboxSession`.
 */
export class LocalSandboxProvider implements HarnessV1SandboxProvider {
	readonly specificationVersion = 'harness-sandbox-v1' as const;
	readonly providerId = 'local-sandbox';

	constructor(private readonly settings: LocalSandboxProviderSettings) {}

	createSession = async (
		options?: CreateSessionOptions,
	): Promise<LocalNetworkSandboxSession> => {
		const session = await createLocalSandboxSession({
			workingDirectory: this.settings.workingDirectory,
			homeDirectory: this.settings.homeDirectory,
			env: this.settings.env,
			abortSignal: options?.abortSignal,
		});

		if (options?.onFirstCreate != null) {
			try {
				await options.onFirstCreate(session.restricted(), {
					abortSignal: options.abortSignal,
				});
			} catch (error) {
				await session.stop();
				throw error;
			}
		}

		return session;
	};
}

export function createLocalSandboxProvider(
	settings: LocalSandboxProviderSettings,
): LocalSandboxProvider {
	return new LocalSandboxProvider(settings);
}
