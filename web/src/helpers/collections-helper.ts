// We use a canvas to reduce image size and compress it.
export function resizeAndCallback(canvas: HTMLCanvasElement, img: any, onSuccess?: Function, onFail?: Function) {
  // This is a proxy to obtain a better quality image
  // See https://stackoverflow.com/questions/15334821/loss-of-quality-while-adding-drawing-image-on-html-5-canvas-from-binary-string
  const dimensions = {
    max_height: 100,
    max_width: 100,
    width: 100,
    height: 100,
    largest_property: function () {
      return this.height > this.width ? 'height' : 'width'
    },
    read_dimensions: function (img: any) {
      this.width = img.width
      this.height = img.height
      return this
    },
    scaling_factor: function (original: any, computed: any) {
      return computed / original
    },
    scale_to_fit: function () {
      const x_factor = this.scaling_factor(this.width, this.max_width),
        y_factor = this.scaling_factor(this.height, this.max_height),
        largest_factor = Math.min(x_factor, y_factor)

      this.width *= largest_factor
      this.height *= largest_factor
    },
  }
  dimensions.read_dimensions(img).scale_to_fit()
  const context = canvas.getContext('2d')
  if (context === null) {
    !!onFail && onFail()
    throw "Can't create 2d context from canvas"
  }
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  context.drawImage(img, 0, 0, dimensions.width, dimensions.height)
  !!onSuccess && onSuccess(canvas.toDataURL())
}

export function blobToImage(blob: any) {
  let url: string
  try {
    url = URL.createObjectURL(blob)
  } catch (e) {
    url = Buffer.from(blob, 'base64').toString('ascii')
  }
  return url
}
