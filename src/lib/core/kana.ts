/**
 * Japanese script helpers: romaji ⇄ kana, and a canonical "key" under which
 * different spellings of one syllable (ら, ラ, ra; し, shi, si) meet.
 * Pure functions, no dependencies.
 */

// Hiragana for each romaji spelling, Hepburn and Kunrei/Nihon-shiki side by side.
const ROMAJI_TO_KANA: Record<string, string> = {};
function add(kana: string, ...romaji: string[]) {
	for (const r of romaji) ROMAJI_TO_KANA[r] = kana;
}
add('あ', 'a');
add('い', 'i');
add('う', 'u');
add('え', 'e');
add('お', 'o');
add('か', 'ka');
add('き', 'ki');
add('く', 'ku');
add('け', 'ke');
add('こ', 'ko');
add('さ', 'sa');
add('し', 'shi', 'si');
add('す', 'su');
add('せ', 'se');
add('そ', 'so');
add('た', 'ta');
add('ち', 'chi', 'ti');
add('つ', 'tsu', 'tu');
add('て', 'te');
add('と', 'to');
add('な', 'na');
add('に', 'ni');
add('ぬ', 'nu');
add('ね', 'ne');
add('の', 'no');
add('は', 'ha');
add('ひ', 'hi');
add('ふ', 'fu', 'hu');
add('へ', 'he');
add('ほ', 'ho');
add('ま', 'ma');
add('み', 'mi');
add('む', 'mu');
add('め', 'me');
add('も', 'mo');
add('や', 'ya');
add('ゆ', 'yu');
add('よ', 'yo');
add('ら', 'ra');
add('り', 'ri');
add('る', 'ru');
add('れ', 're');
add('ろ', 'ro');
add('わ', 'wa');
add('を', 'wo');
add('が', 'ga');
add('ぎ', 'gi');
add('ぐ', 'gu');
add('げ', 'ge');
add('ご', 'go');
add('ざ', 'za');
add('じ', 'ji', 'zi');
add('ず', 'zu');
add('ぜ', 'ze');
add('ぞ', 'zo');
add('だ', 'da');
add('ぢ', 'di');
add('づ', 'du');
add('で', 'de');
add('ど', 'do');
add('ば', 'ba');
add('び', 'bi');
add('ぶ', 'bu');
add('べ', 'be');
add('ぼ', 'bo');
add('ぱ', 'pa');
add('ぴ', 'pi');
add('ぷ', 'pu');
add('ぺ', 'pe');
add('ぽ', 'po');
add('ゔ', 'vu');
// Digraphs.
for (const [c, k] of [
	['k', 'き'],
	['g', 'ぎ'],
	['n', 'に'],
	['h', 'ひ'],
	['b', 'び'],
	['p', 'ぴ'],
	['m', 'み'],
	['r', 'り']
] as const) {
	add(k + 'ゃ', `${c}ya`);
	add(k + 'ゅ', `${c}yu`);
	add(k + 'ょ', `${c}yo`);
}
add('しゃ', 'sha', 'sya');
add('しゅ', 'shu', 'syu');
add('しぇ', 'she', 'sye');
add('しょ', 'sho', 'syo');
add('ちゃ', 'cha', 'tya', 'cya');
add('ちゅ', 'chu', 'tyu', 'cyu');
add('ちぇ', 'che', 'tye', 'cye');
add('ちょ', 'cho', 'tyo', 'cyo');
add('じゃ', 'ja', 'jya', 'zya');
add('じゅ', 'ju', 'jyu', 'zyu');
add('じぇ', 'je', 'jye', 'zye');
add('じょ', 'jo', 'jyo', 'zyo');
add('ぢゃ', 'dya');
add('ぢゅ', 'dyu');
add('ぢょ', 'dyo');
// Loan-word sounds.
add('ふぁ', 'fa');
add('ふぃ', 'fi');
add('ふぇ', 'fe');
add('ふぉ', 'fo');
add('てぃ', 'thi');
add('てゅ', 'thu');
add('でぃ', 'dhi');
add('でゅ', 'dhu');
add('とぅ', 'twu');
add('どぅ', 'dwu');
add('うぃ', 'wi');
add('うぇ', 'we');
add('うぉ', 'who');
add('つぁ', 'tsa');
add('つぃ', 'tsi');
add('つぇ', 'tse');
add('つぉ', 'tso');
add('ゔぁ', 'va');
add('ゔぃ', 'vi');
add('ゔぇ', 've');
add('ゔぉ', 'vo');
// Small kana.
add('ぁ', 'xa');
add('ぃ', 'xi');
add('ぅ', 'xu');
add('ぇ', 'xe');
add('ぉ', 'xo');
add('ゃ', 'xya');
add('ゅ', 'xyu');
add('ょ', 'xyo');
add('っ', 'xtu', 'xtsu');

const MAX_ROMAJI = 4;
const KANA_RE = /[ぁ-ゖァ-ヺーヽヾ]/;

export const isKana = (s: string): boolean => s.length > 0 && /^[぀-ヿ]+$/.test(s);
export const hasKana = (s: string): boolean => KANA_RE.test(s);

/** Katakana → hiragana (leaves everything else alone, ー included). */
export function toHiragana(s: string): string {
	return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Hiragana → katakana. */
export function toKatakana(s: string): string {
	return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * Romaji → hiragana, or null when the text is not complete romaji.
 * "ka" → "か", "kya" → "きゃ", "kka" → "っか", "n" → "ん", "-" → "ー".
 */
export function romajiToKana(input: string): string | null {
	const s = input.trim().toLowerCase();
	if (!s) return null;
	let out = '';
	let i = 0;
	while (i < s.length) {
		// "n" on its own (end, before a consonant, "n'", "nn") is ん; before a vowel or y it starts na, nya…
		if (s[i] === 'n') {
			const next = s[i + 1] ?? '';
			if (next === "'") {
				out += 'ん';
				i += 2;
				continue;
			}
			if (!/[aiueoy]/.test(next)) {
				out += 'ん';
				i += next === 'n' && !/[aiueoy]/.test(s[i + 2] ?? '') ? 2 : 1;
				continue;
			}
		}
		let matched = false;
		for (let len = Math.min(MAX_ROMAJI, s.length - i); len >= 1; len--) {
			const piece = s.slice(i, i + len);
			const kana = ROMAJI_TO_KANA[piece];
			if (kana !== undefined) {
				out += kana;
				i += len;
				matched = true;
				break;
			}
		}
		if (matched) continue;
		const c = s[i];
		// Doubled consonant: "kka" → っか.
		if (c === s[i + 1] && /[bcdfghjklmpqrstvwxyz]/.test(c) && c !== 'n') {
			out += 'っ';
			i += 1;
			continue;
		}
		if (c === '-' || c === 'ー') {
			out += 'ー';
			i += 1;
			continue;
		}
		return null;
	}
	return out;
}

// ---- kana → romaji ----------------------------------------------------------------------

const KANA_TO_ROMAJI = new Map<string, string>();
{
	// Hepburn is the preferred spelling: the first spelling listed per kana is not always it.
	const preferred: Record<string, string> = {
		し: 'shi',
		ち: 'chi',
		つ: 'tsu',
		ふ: 'fu',
		じ: 'ji',
		ぢ: 'ji',
		づ: 'zu',
		ん: 'n',
		しゃ: 'sha',
		しゅ: 'shu',
		しぇ: 'she',
		しょ: 'sho',
		ちゃ: 'cha',
		ちゅ: 'chu',
		ちぇ: 'che',
		ちょ: 'cho',
		じゃ: 'ja',
		じゅ: 'ju',
		じぇ: 'je',
		じょ: 'jo',
		ぢゃ: 'ja',
		ぢゅ: 'ju',
		ぢょ: 'jo',
		うぉ: 'wo'
	};
	for (const [romaji, kana] of Object.entries(ROMAJI_TO_KANA)) {
		if (kana === 'っ' || (kana.length === 1 && 'ぁぃぅぇぉゃゅょ'.includes(kana))) continue;
		if (!KANA_TO_ROMAJI.has(kana)) KANA_TO_ROMAJI.set(kana, romaji);
	}
	for (const [kana, romaji] of Object.entries(preferred)) KANA_TO_ROMAJI.set(kana, romaji);
}

const SMALL_VOWELS: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };

/** Kana (either syllabary) → Hepburn romaji, or null when the text has other characters. */
export function kanaToRomaji(input: string): string | null {
	const s = toHiragana(input.trim());
	if (!s) return null;
	let out = '';
	let i = 0;
	let pendingSokuon = false;
	while (i < s.length) {
		const c = s[i];
		if (c === 'っ') {
			pendingSokuon = true;
			i++;
			continue;
		}
		if (c === 'ー') {
			const last = out.match(/[aiueo]$/)?.[0];
			out += last ?? '-';
			i++;
			continue;
		}
		let piece = '';
		let romaji: string | undefined;
		const two = s.slice(i, i + 2);
		if (KANA_TO_ROMAJI.has(two)) {
			piece = two;
			romaji = KANA_TO_ROMAJI.get(two);
		} else if (KANA_TO_ROMAJI.has(c)) {
			piece = c;
			romaji = KANA_TO_ROMAJI.get(c);
		} else if (SMALL_VOWELS[c]) {
			piece = c;
			romaji = SMALL_VOWELS[c];
		} else if (c === 'ゃ' || c === 'ゅ' || c === 'ょ') {
			piece = c;
			romaji = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo' }[c];
		}
		if (romaji === undefined) return null;
		if (pendingSokuon) {
			out += romaji[0] === 'c' ? 't' : romaji[0];
			pendingSokuon = false;
		}
		out += romaji;
		i += piece.length;
	}
	if (pendingSokuon) out += 't';
	return out;
}

// ---- keys ---------------------------------------------------------------------------------

/** Folds Hepburn onto Kunrei so that "shi" and "si", "ja" and "zya" give one key. */
function foldRomaji(r: string): string {
	return r
		.replace(/shi/g, 'si')
		.replace(/sh(?=[aueo])/g, 'sy')
		.replace(/chi/g, 'ti')
		.replace(/ch(?=[aueo])/g, 'ty')
		.replace(/tsu/g, 'tu')
		.replace(/ji/g, 'zi')
		.replace(/j(?=[aueo])/g, 'zy')
		.replace(/fu/g, 'hu')
		.replace(/n'/g, 'n')
		.replace(/nn/g, 'n');
}

/**
 * Canonical key of a syllable: kana and romaji spellings of the same sound
 * agree ("ら", "ラ", "ra", "RA" → "ra"; "し", "shi", "si" → "si"). Text that is
 * neither (English, Chinese, Russian…) is just lowercased and trimmed.
 */
export function syllableKey(text: string): string {
	const t = text.trim();
	if (!t) return '';
	if (isKana(t)) {
		const r = kanaToRomaji(t);
		// Kana the table does not know still meet their other-script spelling under one key.
		return r === null ? toHiragana(t) : foldRomaji(r);
	}
	const lower = t.toLowerCase();
	if (/^[a-z'-]+$/.test(lower)) {
		const kana = romajiToKana(lower);
		const r = kana ? kanaToRomaji(kana) : null;
		return r === null ? lower : foldRomaji(r);
	}
	return lower;
}

/** The same syllable written in another script, for hints: ら → "ra", "ra" → "ら". */
export function otherScript(text: string): string | null {
	const t = text.trim();
	if (!t) return null;
	if (isKana(t)) {
		const r = kanaToRomaji(t);
		return r && r !== t ? r : null;
	}
	if (/^[a-zA-Z'-]+$/.test(t)) {
		const k = romajiToKana(t);
		return k && k !== t ? k : null;
	}
	return null;
}
