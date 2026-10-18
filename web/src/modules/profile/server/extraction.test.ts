import { expect, test } from 'bun:test';
import { extractText, fileExtension } from './extraction';

function pdf(text: string) {
	const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let document = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (const [index, object] of objects.entries()) {
		offsets.push(document.length);
		document += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = document.length;
	document += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return new TextEncoder().encode(document);
}
test('extracts a text PDF under Bun and rejects image-only or malformed inputs', async () => {
	expect(await extractText(pdf('Alex Example - TypeScript Engineer'), 'pdf')).toContain(
		'Alex Example - TypeScript Engineer',
	);
	await expect(extractText(pdf(''), 'pdf')).rejects.toThrow('No readable text');
	await expect(extractText(new TextEncoder().encode('not a PDF'), 'pdf')).rejects.toThrow('not a PDF');
	await expect(extractText(new Uint8Array([255]), 'md')).rejects.toThrow('UTF-8');
	expect(() => fileExtension('cv.exe', 1)).toThrow('PDF or Markdown');
	expect(() => fileExtension('cv.pdf', 11 * 1024 * 1024)).toThrow('10 MiB');
});
