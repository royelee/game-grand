export const MAX_COSTUME_WIDTH = 480
export const MAX_COSTUME_HEIGHT = 360

export interface Dimensions {
  width: number
  height: number
}

/** Fit within the stage while preserving aspect ratio. */
export function downscale(
  width: number,
  height: number,
  maxW = MAX_COSTUME_WIDTH,
  maxH = MAX_COSTUME_HEIGHT,
): Dimensions {
  const factor = Math.min(1, maxW / width, maxH / height)
  return { width: Math.round(width * factor), height: Math.round(height * factor) }
}

export async function measureImage(
  dataUrl: string,
  loadImage: (src: string) => Promise<{ naturalWidth: number; naturalHeight: number }> = domLoadImage,
): Promise<Dimensions> {
  const img = await loadImage(dataUrl)
  return { width: img.naturalWidth, height: img.naturalHeight }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function domLoadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}
