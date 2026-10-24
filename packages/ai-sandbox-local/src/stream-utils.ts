/**
 * Small stream<->bytes conversions shared by the read/write file methods.
 * `Experimental_SandboxSession`'s lowest-level `readFile`/`writeFile` are
 * stream-shaped even though our backing store (real disk) is not, so these
 * bridge the two.
 */

export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

export async function collectStream(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		if (result.value) {
			chunks.push(result.value);
			total += result.value.byteLength;
		}
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
