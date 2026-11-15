const SQUARE = '/no-image-1x1.jpg';
const WIDE = '/no-image-16x9.jpg';

/**
 * Any image that fails to load (a broken link, a deleted upload, a dropped connection) shows the
 * "no image" picture instead of the browser's broken-image icon. Wide frames, such as store covers,
 * get the 16:9 picture; everything else gets the square one.
 */
export function installImageFallback() {
  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      // The placeholder itself failed (offline before it was cached): stop rather than loop.
      if (image.src.endsWith(SQUARE) || image.src.endsWith(WIDE)) return;
      const wide = image.clientWidth > image.clientHeight * 1.3;
      image.removeAttribute('srcset');
      image.src = wide ? WIDE : SQUARE;
    },
    // Image errors do not bubble, so listen while they travel down to the image.
    true,
  );
}
