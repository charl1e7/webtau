const midiNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function midiToNoteName(midi: number): string {
    const octave = Math.floor(midi / 12) - 1;
    const note = midi % 12;
    return `${midiNotes[note]}${octave}`;
}