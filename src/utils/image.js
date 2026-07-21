import sharp from 'sharp';

const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export async function compressForTelegram(inputPath) {
  const metadata = await sharp(inputPath).metadata();
  const sizeBytes = metadata.size || 0;

  if (sizeBytes <= TELEGRAM_PHOTO_MAX_BYTES) {
    return { buffer: await sharp(inputPath).png().toBuffer(), width: metadata.width, height: metadata.height };
  }

  let quality = 80;
  let buffer = await sharp(inputPath).jpeg({ quality, mozjpeg: true }).toBuffer();

  while (buffer.length > TELEGRAM_PHOTO_MAX_BYTES && quality > 20) {
    quality -= 10;
    buffer = await sharp(inputPath).jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  if (buffer.length > TELEGRAM_PHOTO_MAX_BYTES) {
    const scale = Math.sqrt(TELEGRAM_PHOTO_MAX_BYTES / buffer.length) * 0.9;
    const newW = Math.round(metadata.width * scale);
    const newH = Math.round(metadata.height * scale);
    buffer = await sharp(inputPath).resize(newW, newH).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  }

  return { buffer, width: metadata.width, height: metadata.height };
}
