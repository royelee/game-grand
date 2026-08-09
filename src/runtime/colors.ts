export interface Rgb {
  r: number
  g: number
  b: number
}

/** Scratch's scales: every channel runs 0-100, not 0-360 / 0-1. */
export interface Hsb {
  hue: number
  saturation: number
  brightness: number
}

export interface ParsedColor {
  rgb: Rgb
  alpha: number
}

// The 148 CSS Color 4 names, each packed as its name followed by six hex
// digits. One string rather than 148 object literals, because this ships in
// the runtime bundle that every game loads.
const PACKED =
  'alicebluef0f8ff antiquewhitefaebd7 aqua00ffff aquamarine7fffd4 azuref0ffff beigef5f5dc bisqueffe4c4 black000000 blanchedalmondffebcd blue0000ff blueviolet8a2be2 browna52a2a burlywooddeb887 cadetblue5f9ea0 chartreuse7fff00 chocolated2691e coralff7f50 cornflowerblue6495ed cornsilkfff8dc crimsondc143c cyan00ffff darkblue00008b darkcyan008b8b darkgoldenrodb8860b darkgraya9a9a9 darkgreya9a9a9 darkgreen006400 darkkhakibdb76b darkmagenta8b008b darkolivegreen556b2f darkorangeff8c00 darkorchid9932cc darkred8b0000 darksalmone9967a darkseagreen8fbc8f darkslateblue483d8b darkslategray2f4f4f darkslategrey2f4f4f darkturquoise00ced1 darkviolet9400d3 deeppinkff1493 deepskyblue00bfff dimgray696969 dimgrey696969 dodgerblue1e90ff firebrickb22222 floralwhitefffaf0 forestgreen228b22 fuchsiaff00ff gainsborodcdcdc ghostwhitef8f8ff goldffd700 goldenroddaa520 gray808080 grey808080 green008000 greenyellowadff2f honeydewf0fff0 hotpinkff69b4 indianredcd5c5c indigo4b0082 ivoryfffff0 khakif0e68c lavendere6e6fa lavenderblushfff0f5 lawngreen7cfc00 lemonchiffonfffacd lightblueadd8e6 lightcoralf08080 lightcyane0ffff lightgoldenrodyellowfafad2 lightgrayd3d3d3 lightgreyd3d3d3 lightgreen90ee90 lightpinkffb6c1 lightsalmonffa07a lightseagreen20b2aa lightskyblue87cefa lightslategray778899 lightslategrey778899 lightsteelblueb0c4de lightyellowffffe0 lime00ff00 limegreen32cd32 linenfaf0e6 magentaff00ff maroon800000 mediumaquamarine66cdaa mediumblue0000cd mediumorchidba55d3 mediumpurple9370db mediumseagreen3cb371 mediumslateblue7b68ee mediumspringgreen00fa9a mediumturquoise48d1cc mediumvioletredc71585 midnightblue191970 mintcreamf5fffa mistyroseffe4e1 moccasinffe4b5 navajowhiteffdead navy000080 oldlacefdf5e6 olive808000 olivedrab6b8e23 orangeffa500 orangeredff4500 orchidda70d6 palegoldenrodeee8aa palegreen98fb98 paleturquoiseafeeee palevioletredd87093 papayawhipffefd5 peachpuffffdab9 perucd853f pinkffc0cb plumdda0dd powderblueb0e0e6 purple800080 redff0000 rebeccapurple663399 rosybrownbc8f8f royalblue4169e1 saddlebrown8b4513 salmonfa8072 sandybrownf4a460 seagreen2e8b57 seashellfff5ee siennaa0522d silverc0c0c0 skyblue87ceeb slateblue6a5acd slategray708090 slategrey708090 snowfffafa springgreen00ff7f steelblue4682b4 tand2b48c teal008080 thistled8bfd8 tomatoff6347 turquoise40e0d0 violetee82ee wheatf5deb3 whiteffffff whitesmokef5f5f5 yellowffff00 yellowgreen9acd32'

const NAMED: Record<string, string> = Object.fromEntries(
  PACKED.split(' ').map(token => [token.slice(0, -6), token.slice(-6)]),
)

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * `null` means "not a color we understand". Deliberately not a thrown error:
 * this module stays free of user-facing wording so the API layer can name the
 * function the kid actually called.
 */
export function parseColor(input: string): ParsedColor | null {
  const s = input.trim().toLowerCase()
  const named = NAMED[s]
  if (named) return { rgb: hexToRgb(named), alpha: 1 }

  const m = /^#([0-9a-f]+)$/.exec(s)
  if (!m) return null
  const d = m[1]
  if (d.length === 3 || d.length === 4) {
    const full = [...d].map(ch => ch + ch).join('')
    return {
      rgb: hexToRgb(full.slice(0, 6)),
      alpha: d.length === 4 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    }
  }
  if (d.length === 6) return { rgb: hexToRgb(d), alpha: 1 }
  if (d.length === 8) return { rgb: hexToRgb(d.slice(0, 6)), alpha: parseInt(d.slice(6, 8), 16) / 255 }
  return null
}

export function rgbToHsb({ r, g, b }: Rgb): Hsb {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return {
    hue: (h / 360) * 100,
    saturation: max === 0 ? 0 : (d / max) * 100,
    brightness: (max / 255) * 100,
  }
}

export function hsbToRgb({ hue, saturation, brightness }: Hsb): Rgb {
  const h = ((((hue / 100) * 360) % 360) + 360) % 360
  const s = saturation / 100
  const v = brightness / 100
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const seg = Math.floor(h / 60) % 6
  const [r1, g1, b1] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg]
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

export function rgbToInt({ r, g, b }: Rgb): number {
  return (r << 16) | (g << 8) | b
}
