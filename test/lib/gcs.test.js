import {gcs} from '../../index';

test('generates list of wal files correctly', () => {
	const result = gcs.getAllWalFiles('00000001000009D6000000D0', '00000001000009D700000065', 'daily');
	expect(result.length).toBe(150);
});

