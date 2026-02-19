import { describe, expect, it } from 'vitest';
import { lintStrudelSemantics } from '../src/semantic-lint';

describe('lintStrudelSemantics', () => {
  it('rejects octave-root chord symbols inside chord().voicing()', () => {
    const input = `
      const chords = chord("<c2m g1M>").voicing().s("sawtooth")
      stack(chords)
    `;
    const result = lintStrudelSemantics(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((line) => line.includes('INVALID_CHORD_VOICING_SYMBOL'))).toBe(true);
    expect(result.diagnostics.some((line) => line.includes('"c2m"'))).toBe(true);
    expect(result.diagnostics.some((line) => line.includes('"g1M"'))).toBe(true);
  });

  it('rejects unresolved identifiers in audio param expressions', () => {
    const input = `
      const bass = note("c2").s("sawtooth").lpf(200 + saw.slow(8).range(100, 600))
      stack(bass)
    `;
    const result = lintStrudelSemantics(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain('NON_FINITE_PARAM_RISK: unresolved identifier "saw" in lpf(...).');
  });

  it('accepts valid voicing symbols and declared modulation variable', () => {
    const input = `
      const mod = 420
      const chords = chord("<Cm7 F7 BbM7 G7>").voicing().s("sawtooth")
      const bass = note("c2").s("sawtooth").lpf(200 + mod)
      stack(chords, bass)
    `;
    const result = lintStrudelSemantics(input);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('returns combined diagnostics for mixed failures', () => {
    const input = `
      const bass = note("c2").s("sawtooth").lpf(200 + saw.slow(8).range(100, 600))
      const chords = chord("<c2m g1M>").voicing().s("sawtooth")
      stack(bass, chords)
    `;
    const result = lintStrudelSemantics(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((line) => line.includes('INVALID_CHORD_VOICING_SYMBOL'))).toBe(true);
    expect(result.diagnostics.some((line) => line.includes('NON_FINITE_PARAM_RISK'))).toBe(true);
  });
});

