// Sum narrow-band energy over overlapping Hann windows so clock drift and phase discontinuities do not cancel an otherwise present tone.
export function pcmTonePowers(bytes, frequencies, sampleRate = 8000) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength % 2 || !Number.isFinite(sampleRate) || sampleRate < 1000) throw new TypeError('Expected signed 16-bit PCM and a valid sample rate.');
  const size = Math.round(sampleRate / 10), hop = Math.floor(size / 2), count = bytes.byteLength / 2;
  if (count < size) throw new RangeError('Audio analysis needs at least 100 ms of samples.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const window = Float64Array.from({length:size}, (_, n) => .5 - .5 * Math.cos(2 * Math.PI * n / (size - 1)));
  const spectra = frequencies.map(frequency => {
    if (!Number.isFinite(frequency) || frequency < 20 || frequency >= sampleRate / 2 - 20) throw new RangeError('Analysis frequency is outside the usable band.');
    const center = Math.round(frequency * size / sampleRate);
    return {frequency, bins:[center - 2, center - 1, center, center + 1, center + 2].map(bin => ({
      real: Float64Array.from(window, (weight, n) => weight * Math.cos(2 * Math.PI * bin * n / size)),
      imag: Float64Array.from(window, (weight, n) => weight * Math.sin(2 * Math.PI * bin * n / size))
    })), power:0};
  });
  let frames = 0;
  for (let start = 0; start + size <= count; start += hop) {
    const samples = Float64Array.from({length:size}, (_, n) => view.getInt16((start + n) * 2, true) / 32768);
    for (const spectrum of spectra) for (const bin of spectrum.bins) {
      let real = 0, imag = 0;
      for (let n = 0; n < size; n++) { real += samples[n] * bin.real[n]; imag += samples[n] * bin.imag[n]; }
      spectrum.power += real * real + imag * imag;
    }
    frames++;
  }
  return Object.fromEntries(spectra.map(({frequency,power}) => [frequency, power / (frames * size * size)]));
}
