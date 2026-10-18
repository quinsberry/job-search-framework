import { ProfileError } from '../model/contracts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export function fileExtension(name: string, size: number) {
	if (!size || size > MAX_UPLOAD_BYTES)
		throw new ProfileError('invalid', 'Choose a nonempty CV no larger than 10 MiB.');
	const extension = name.toLowerCase().split('.').pop();
	if (!['pdf', 'md', 'markdown'].includes(extension ?? ''))
		throw new ProfileError('invalid', 'Choose a PDF or Markdown CV.');
	return extension === 'pdf' ? 'pdf' : 'md';
}
export async function extractText(bytes: Uint8Array, extension: 'pdf' | 'md') {
	let text: string;
	if (extension === 'md') {
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			throw new ProfileError('invalid', 'Markdown must be readable UTF-8 text.');
		}
		if (text.includes('\0') || /^%PDF-/.test(text))
			throw new ProfileError('invalid', 'The selected file is not Markdown text.');
	} else {
		if (!new TextDecoder().decode(bytes.slice(0, 5)).startsWith('%PDF-'))
			throw new ProfileError('invalid', 'The selected file is not a PDF.');
		const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
		const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true, useWorkerFetch: false });
		try {
			const document = await task.promise;
			if (document.numPages > 100) throw new Error('Too many pages');
			const pages: string[] = [];
			for (let page = 1; page <= document.numPages; page++) {
				const content = await (await document.getPage(page)).getTextContent();
				pages.push(
					content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''),
				);
			}
			text = pages.join('\n\n');
		} catch {
			throw new ProfileError(
				'invalid',
				'Could not read this PDF. Use an unencrypted text-based PDF or a Markdown CV. OCR is not supported.',
			);
		} finally {
			await task.destroy();
		}
	}
	if (!text.trim())
		throw new ProfileError(
			'invalid',
			'No readable text found. Image-only PDFs need a text version; OCR is not supported.',
		);
	if (text.length > 120_000) throw new ProfileError('invalid', 'CV text is too long (maximum 120,000 characters).');
	return text;
}
