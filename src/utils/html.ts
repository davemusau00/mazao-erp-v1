const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => htmlEscapes[character]);
}

/** Allow only raster image sources suitable for a printable img element. */
export function safeRasterImageSource(value: string): string {
  const source = value.trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(source)
    || /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(source)
    || (/^\/(?!\/)[^\s"'<>]*$/.test(source))) {
    return escapeHtml(source);
  }
  return '';
}
