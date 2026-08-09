import { describe, it, expect } from 'vitest'
import { parseColor, rgbToHsb, hsbToRgb, rgbToInt } from './colors'

describe('parseColor', () => {
  it('knows CSS color names, ignoring case and spaces', () => {
    expect(parseColor('red')).toEqual({ rgb: { r: 255, g: 0, b: 0 }, alpha: 1 })
    expect(parseColor('  HotPink ')).toEqual({ rgb: { r: 255, g: 105, b: 180 }, alpha: 1 })
    expect(parseColor('skyblue')).toEqual({ rgb: { r: 135, g: 206, b: 235 }, alpha: 1 })
    expect(parseColor('rebeccapurple')).toEqual({ rgb: { r: 102, g: 51, b: 153 }, alpha: 1 })
  })

  // Pinned because the table was lifted from an editor's CSS data, and older
  // X11 tables carry #9370d8 here instead of the CSS Color 4 value.
  it('uses the CSS Color 4 value for mediumpurple', () => {
    expect(parseColor('mediumpurple')).toEqual({ rgb: { r: 147, g: 112, b: 219 }, alpha: 1 })
  })

  it('reads 3-, 4-, 6- and 8-digit hex', () => {
    expect(parseColor('#f00')).toEqual({ rgb: { r: 255, g: 0, b: 0 }, alpha: 1 })
    expect(parseColor('#FF0000')).toEqual({ rgb: { r: 255, g: 0, b: 0 }, alpha: 1 })
    expect(parseColor('#ff000080')?.alpha).toBeCloseTo(128 / 255, 5)
    expect(parseColor('#f00f')).toEqual({ rgb: { r: 255, g: 0, b: 0 }, alpha: 1 })
  })

  it('returns null for anything it does not understand', () => {
    for (const bad of ['blurple', '', '#', '#ff', '#12345', '#1234567', 'rgb(1,2,3)']) {
      expect(parseColor(bad), bad).toBeNull()
    }
  })
})

describe('rgbToHsb', () => {
  it('maps the primaries onto Scratch 0-100 scales', () => {
    expect(rgbToHsb({ r: 255, g: 0, b: 0 })).toEqual({ hue: 0, saturation: 100, brightness: 100 })
    const blue = rgbToHsb({ r: 0, g: 0, b: 255 })
    expect(blue.hue).toBeCloseTo(66.667, 2)
    expect(blue.saturation).toBe(100)
  })

  it('reports no hue and no saturation for grays', () => {
    expect(rgbToHsb({ r: 255, g: 255, b: 255 })).toEqual({ hue: 0, saturation: 0, brightness: 100 })
    expect(rgbToHsb({ r: 0, g: 0, b: 0 })).toEqual({ hue: 0, saturation: 0, brightness: 0 })
  })
})

describe('hsbToRgb', () => {
  it('turns the Scratch default pen state into blue', () => {
    expect(hsbToRgb({ hue: 66.66, saturation: 100, brightness: 100 })).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('round-trips through rgbToHsb', () => {
    for (const rgb of [{ r: 255, g: 105, b: 180 }, { r: 18, g: 200, b: 77 }, { r: 3, g: 3, b: 3 }]) {
      expect(hsbToRgb(rgbToHsb(rgb))).toEqual(rgb)
    }
  })

  it('wraps a hue that has run past 100', () => {
    expect(hsbToRgb({ hue: 100, saturation: 100, brightness: 100 })).toEqual({ r: 255, g: 0, b: 0 })
  })
})

describe('rgbToInt', () => {
  it('packs to 0xRRGGBB for Phaser', () => {
    expect(rgbToInt({ r: 255, g: 105, b: 180 })).toBe(0xff69b4)
    expect(rgbToInt({ r: 0, g: 0, b: 0 })).toBe(0x000000)
  })
})
