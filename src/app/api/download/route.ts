import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import os from 'os';

export const maxDuration = 60;

const binDir = process.env.VERCEL || process.platform !== 'win32'
  ? path.join(os.tmpdir(), 'bin')
  : path.join(path.resolve(process.cwd()), 'bin');

// Helper to determine platform-specific binary name and download URL
function getBinaryInfo() {
  const platform = process.platform;
  if (platform === 'win32') {
    return {
      name: 'yt-dlp.exe',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    };
  } else if (platform === 'darwin') {
    return {
      name: 'yt-dlp_macos',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    };
  } else {
    return {
      name: 'yt-dlp_linux',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
    };
  }
}

// Auto-bootstrapper for yt-dlp binary
async function ensureYtDlp(): Promise<string> {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const binary = getBinaryInfo();
  const ytdlpPath = path.join(binDir, binary.name);

  if (fs.existsSync(ytdlpPath)) {
    return ytdlpPath;
  }

  console.log(`[Auto-Bootstrapper] Downloading yt-dlp from ${binary.url}...`);
  const res = await fetch(binary.url);
  if (!res.ok) {
    throw new Error(`Failed to download yt-dlp: ${res.statusText}`);
  }

  const buffer = await res.arrayBuffer();
  fs.writeFileSync(ytdlpPath, Buffer.from(buffer));

  if (process.platform !== 'win32') {
    fs.chmodSync(ytdlpPath, '755');
  }

  console.log('[Auto-Bootstrapper] yt-dlp downloaded and configured at:', ytdlpPath);
  return ytdlpPath;
}

// Helper to extract video ID from YouTube URL
function getYouTubeVideoId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?\s*v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Convert Node readable stream to Web ReadableStream and clean up process on cancel
function nodeToWebStream(nodeStream: any, childProcess?: any): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: any) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err: any) => controller.error(err));
    },
    cancel() {
      if (nodeStream.destroy) nodeStream.destroy();
      if (childProcess && !childProcess.killed) {
        console.log('[API Stream] Request cancelled by client, terminating yt-dlp process.');
        childProcess.kill();
      }
    }
  });
}

function getCookieArg(): string[] {
  const cookiesEnv = process.env.YOUTUBE_COOKIES;
  if (!cookiesEnv) {
    return [];
  }
  
  try {
    const cookiesPath = path.join(os.tmpdir(), 'cookies.txt');
    fs.writeFileSync(cookiesPath, cookiesEnv.trim());
    console.log('[API Cookie] Cookies written successfully to:', cookiesPath);
    return ['--cookies', cookiesPath];
  } catch (err) {
    console.error('[API Cookie] Failed to write cookies file:', err);
    return [];
  }
}

function getProxyArg(): string[] {
  const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (!proxyUrl) {
    return [];
  }
  console.log('[API Proxy] Routing request via proxy configuration...');
  return ['--proxy', proxyUrl.trim()];
}

// ExecFile version wrapped in a Promise for metadata parsing
function getMetadata(ytdlpPath: string, url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-playlist', '--js-runtimes', 'node', '--extractor-args', 'youtube:player-client=android,mweb', '--buffer-size', '1024K', ...getCookieArg(), ...getProxyArg(), url];
    execFile(ytdlpPath, args, (error, stdout, stderr) => {
      if (error) {
        console.error('[API Metadata] Error running yt-dlp:', stderr);
        return reject(new Error(stderr || error.message));
      }
      try {
        const metadata = JSON.parse(stdout);
        resolve(metadata);
      } catch (err: any) {
        reject(new Error(`Failed to parse metadata JSON: ${err.message}`));
      }
    });
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  const format = searchParams.get('format');
  const infoOnly = searchParams.get('info') === 'true';

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  const isYouTube = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)/.test(url);
  const isInstagram = /^(https?:\/\/)?(www\.)?(instagram\.com)/.test(url);

  if (!isYouTube && !isInstagram) {
    return NextResponse.json({ error: 'Only YouTube and Instagram URLs are supported' }, { status: 400 });
  }

  if (isYouTube) {
    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: 'Could not extract YouTube video ID' }, { status: 400 });
    }
  }

  try {
    // 1. Ensure yt-dlp binary is present
    const ytdlpPath = await ensureYtDlp();

    // 2. Fetch metadata info
    if (infoOnly) {
      console.log('[API Metadata] Fetching metadata for:', url);
      const metadata = await getMetadata(ytdlpPath, url);
      
      const title = metadata.title || (isInstagram ? 'Instagram Post' : 'YouTube Video');
      const author = metadata.uploader || metadata.channel || (isInstagram ? 'Instagram User' : 'Unknown Creator');
      const duration = metadata.duration || 0;
      
      // Get best quality thumbnail
      let thumbnail = '';
      if (metadata.thumbnails && metadata.thumbnails.length > 0) {
        thumbnail = metadata.thumbnails[metadata.thumbnails.length - 1].url;
      } else {
        thumbnail = metadata.thumbnail || '';
      }

      const views = metadata.view_count || 0;

      return NextResponse.json({
        title,
        author,
        duration,
        thumbnail,
        views
      });
    }

    // 3. Fetch download stream
    console.log(`[API Download] Fetching metadata before stream download for: ${url}`);
    const metadata = await getMetadata(ytdlpPath, url);
    const title = metadata.title || 'download';
    const safeTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/[\/\\?%*:|"<>\s]+/g, '_');

    const cookieArg = getCookieArg();
    const proxyArg = getProxyArg();
    const formatSpec = isYouTube
      ? (format === 'mp3' ? 'ba[ext=m4a]/ba' : 'best[ext=mp4]/best')
      : (format === 'mp3' ? 'ba' : 'best');

    if (format === 'mp3') {
      console.log(`[API Download] Spawning yt-dlp for Audio format (${formatSpec}) for: ${url}`);
      const child = spawn(ytdlpPath, ['-o', '-', '-f', formatSpec, '--js-runtimes', 'node', '--extractor-args', 'youtube:player-client=android,mweb', '--buffer-size', '1024K', ...cookieArg, ...proxyArg, url]);
      const webStream = nodeToWebStream(child.stdout, child);

      return new Response(webStream, {
        headers: {
          'Content-Type': 'audio/mp4',
          'Content-Disposition': `attachment; filename="${safeTitle}.mp3"`,
        },
      });
    } else {
      console.log(`[API Download] Spawning yt-dlp for Video format (${formatSpec}) for: ${url}`);
      const child = spawn(ytdlpPath, ['-o', '-', '-f', formatSpec, '--js-runtimes', 'node', '--extractor-args', 'youtube:player-client=android,mweb', '--buffer-size', '1024K', ...cookieArg, ...proxyArg, url]);
      const webStream = nodeToWebStream(child.stdout, child);

      return new Response(webStream, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${safeTitle}.mp4"`,
        },
      });
    }

  } catch (error: any) {
    console.error('[API Error] Downloader failed:', error);
    return NextResponse.json({
      error: `Failed to process link: ${error.message || 'Unknown error'}. Please try again later.`,
      details: error.message || 'Unknown error'
    }, { status: 500 });
  }
}
