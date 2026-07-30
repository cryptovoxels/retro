declare module 'fastnoise-lite' {
  class FastNoiseLite {
    static NoiseType: {
      OpenSimplex2: string
      OpenSimplex2S: string
      Cellular: string
      Perlin: string
      ValueCubic: string
      Value: string
    }
    static FractalType: {
      None: string
      FBm: string
      Ridged: string
      PingPong: string
      DomainWarpProgressive: string
      DomainWarpIndependent: string
    }
    constructor(seed?: number)
    SetSeed(seed: number): void
    SetFrequency(frequency: number): void
    SetNoiseType(noiseType: string): void
    SetFractalType(fractalType: string): void
    SetFractalOctaves(octaves: number): void
    SetFractalLacunarity(lacunarity: number): void
    SetFractalGain(gain: number): void
    GetNoise(x: number, y: number): number
    GetNoise(x: number, y: number, z: number): number
  }
  export default FastNoiseLite
}
