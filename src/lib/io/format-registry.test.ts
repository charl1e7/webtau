import { describe, expect, it } from 'vitest';
import { formats } from './format-registry';

describe('format registry', () => {
	it('finds a format by file extension, case-insensitively', () => {
		formats.register({
			id: 'test-fmt',
			extensions: ['.tfmt'],
			import: { label: 'Import T…', action: () => {} },
			export: { label: 'Export T', hint: 'Ctrl+T', action: () => {} },
			openFile: async () => {}
		});
		expect(formats.forFile('SONG.TFMT')?.id).toBe('test-fmt');
		expect(formats.forFile('song.unknown')).toBeUndefined();
	});

	it('lists import and export menu entries in registration order', () => {
		formats
			.register({ id: 'test-a', extensions: [], export: { label: 'Export A', action: () => {} } })
			.register({ id: 'test-b', extensions: [], import: { label: 'Import B…', action: () => {} } });
		const imports = formats.imports().map((f) => f.id);
		const exports = formats.exports().map((f) => f.id);
		expect(imports.indexOf('test-fmt')).toBeLessThan(imports.indexOf('test-b'));
		expect(exports.indexOf('test-fmt')).toBeLessThan(exports.indexOf('test-a'));
		expect(exports).not.toContain('test-b');
		expect(formats.exports().find((f) => f.id === 'test-fmt')?.hint).toBe('Ctrl+T');
	});

	it('lets a later registration replace an earlier one with the same id', () => {
		formats.register({ id: 'test-r', extensions: ['.r1'] });
		formats.register({ id: 'test-r', extensions: ['.r2'] });
		expect(formats.forFile('x.r1')).toBeUndefined();
		expect(formats.forFile('x.r2')?.id).toBe('test-r');
	});
});
