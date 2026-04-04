type ImageSize = { width: number; height: number };

function parsePng(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    return undefined;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function parseGif(buffer: Buffer): ImageSize | undefined {
  const signature = buffer.toString('ascii', 0, 6);
  if (buffer.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) {
    return undefined;
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8)
  };
}

function parseJpeg(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = (
      marker >= 0xC0
      && marker <= 0xCF
      && marker !== 0xC4
      && marker !== 0xC8
      && marker !== 0xCC
    );
    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    if (length < 2) {
      break;
    }
    offset += 2 + length;
  }

  return undefined;
}

function parseSvg(buffer: Buffer): ImageSize | undefined {
  const text = buffer.toString('utf8');
  const widthMatch = text.match(/\bwidth\s*=\s*['"]\s*([0-9.]+)/i);
  const heightMatch = text.match(/\bheight\s*=\s*['"]\s*([0-9.]+)/i);
  if (widthMatch?.[1] && heightMatch?.[1]) {
    return {
      width: Number(widthMatch[1]),
      height: Number(heightMatch[1])
    };
  }

  const viewBoxMatch = text.match(/\bviewBox\s*=\s*['"][^'"]*?([0-9.]+)\s+([0-9.]+)\s*['"]/i);
  if (viewBoxMatch?.[1] && viewBoxMatch?.[2]) {
    return {
      width: Number(viewBoxMatch[1]),
      height: Number(viewBoxMatch[2])
    };
  }

  return undefined;
}

export function getImageDimensions(buffer: Buffer): ImageSize {
  return (
    parsePng(buffer)
    ?? parseGif(buffer)
    ?? parseJpeg(buffer)
    ?? parseSvg(buffer)
    ?? (() => {
      throw new Error('Unsupported image format');
    })()
  );
}
