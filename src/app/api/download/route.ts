import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import os from 'os';
import { Innertube, Platform } from 'youtubei.js';

// Polyfill dynamic JavaScript execution for youtubei.js signature decryption
if (typeof globalThis !== 'undefined') {
  Platform.shim.eval = async (data: any, env: any) => {
    return new Function(...Object.keys(env), data.output)(...Object.values(env));
  };
}

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

async function fetchYouTubeOEmbed(url: string) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || 'YouTube Video',
        author: data.author_name || 'Unknown Creator',
        thumbnail: data.thumbnail_url || '',
        duration: 0,
        views: 0
      };
    }
  } catch (err) {
    console.error('[API oEmbed] Fetch failed:', err);
  }
  return null;
}

interface CookieConfig {
  args: string[];
  cleanup?: () => void;
}

function getCookieArg(
  cookiesFromBrowser?: string | null,
  customCookiesBase64?: string | null
): CookieConfig {
  // Option 1: Custom base64 cookies passed in header or query param
  if (customCookiesBase64) {
    try {
      const cookiesContent = Buffer.from(customCookiesBase64, 'base64').toString('utf-8').trim();
      const tempPath = path.join(
        os.tmpdir(),
        `cookies_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`
      );
      fs.writeFileSync(tempPath, cookiesContent);
      console.log('[API Cookie] Custom cookies written successfully to:', tempPath);
      return {
        args: ['--cookies', tempPath],
        cleanup: () => {
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
              console.log('[API Cookie] Temporary custom cookies file cleaned up:', tempPath);
            }
          } catch (e) {
            console.error('[API Cookie] Failed to clean up temp cookies file:', e);
          }
        }
      };
    } catch (err) {
      console.error('[API Cookie] Failed to handle custom cookies:', err);
    }
  }

  // Option 2: Browser cookies extraction (local only)
  if (cookiesFromBrowser && cookiesFromBrowser !== 'none' && cookiesFromBrowser !== 'env' && cookiesFromBrowser !== 'custom') {
    console.log(`[API Cookie] Extracting cookies from browser: ${cookiesFromBrowser}`);
    return {
      args: ['--cookies-from-browser', cookiesFromBrowser]
    };
  }

  // If cookiesFromBrowser is explicitly 'none', do NOT use any cookies (ignore env)
  if (cookiesFromBrowser === 'none') {
    console.log('[API Cookie] Cookies source explicitly set to none. Running without cookies.');
    return { args: [] };
  }

  // Option 3: Fallback to process.env.YOUTUBE_COOKIES
  const cookiesEnv = process.env.YOUTUBE_COOKIES;
  if (cookiesEnv) {
    try {
      const cookiesPath = path.join(os.tmpdir(), 'cookies.txt');
      fs.writeFileSync(cookiesPath, cookiesEnv.trim());
      console.log('[API Cookie] Env cookies written successfully to:', cookiesPath);
      return {
        args: ['--cookies', cookiesPath]
      };
    } catch (err) {
      console.error('[API Cookie] Failed to write env cookies file:', err);
    }
  }

  return { args: [] };
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
function getMetadata(
  ytdlpPath: string,
  url: string,
  cookiesFromBrowser?: string | null,
  customCookiesBase64?: string | null
): Promise<any> {
  return new Promise((resolve, reject) => {
    const cookieConfig = getCookieArg(cookiesFromBrowser, customCookiesBase64);
    const args = [
      '--dump-json',
      '--no-playlist',
      '--js-runtimes',
      'node',
      '--extractor-args',
      'youtube:player-client=android,mweb',
      '--buffer-size',
      '1024K',
      ...cookieConfig.args,
      ...getProxyArg(),
      url
    ];
    execFile(ytdlpPath, args, (error, stdout, stderr) => {
      if (cookieConfig.cleanup) {
        cookieConfig.cleanup();
      }
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
  const cookiesFromBrowser = req.headers.get('x-cookies-from-browser') || searchParams.get('cookiesFromBrowser');
  const customCookiesBase64 = req.headers.get('x-youtube-cookies') || searchParams.get('customCookies');

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

    try {
      console.log('[API youtubei.js] Initializing Innertube...');
      const youtube = await Innertube.create();
      
      if (infoOnly) {
        console.log('[API youtubei.js] Fetching metadata for:', videoId);
        const info = await youtube.getInfo(videoId);
        
        // If playability status is error or basic_info title is missing, fallback to oEmbed!
        if (info.playability_status?.status === 'ERROR' || !info.basic_info?.title) {
          console.log('[API youtubei.js] Blocked or empty info. Falling back to oEmbed...');
          const oembedData = await fetchYouTubeOEmbed(url);
          if (oembedData) {
            return NextResponse.json(oembedData);
          }
        }

        const title = info.basic_info.title || 'YouTube Video';
        const author = info.basic_info.author || 'Unknown Creator';
        const duration = info.basic_info.duration || 0;
        
        let thumbnail = '';
        if (info.basic_info.thumbnail && info.basic_info.thumbnail.length > 0) {
          thumbnail = info.basic_info.thumbnail[info.basic_info.thumbnail.length - 1].url;
        }

        const views = info.basic_info.view_count || 0;

        return NextResponse.json({
          title,
          author,
          duration,
          thumbnail,
          views
        });
      }

      console.log('[API youtubei.js] Fetching download stream for:', videoId);
      const info = await youtube.getInfo(videoId);
      const title = info.basic_info.title || 'download';
      const safeTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/[\/\\?%*:|"<>\s]+/g, '_');

      // Use the ANDROID client for video+audio stream (pre-deciphered or highly bypass-friendly, works without cookies)
      const stream = await youtube.download(videoId, {
        type: 'video+audio',
        quality: 'best',
        client: 'ANDROID'
      });

      if (format === 'mp3') {
        return new Response(stream as any, {
          headers: {
            'Content-Type': 'audio/mp4',
            'Content-Disposition': `attachment; filename="${safeTitle}.mp3"`,
          },
        });
      } else {
        return new Response(stream as any, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${safeTitle}.mp4"`,
          },
        });
      }
    } catch (err: any) {
      console.error('[API youtubei.js Error] Failed:', err);
      console.log('[API Fallback] Falling back to standard yt-dlp flow.');
    }
  }

  try {
    // 1. Ensure yt-dlp binary is present
    const ytdlpPath = await ensureYtDlp();

    // 2. Fetch metadata info
    if (infoOnly) {
      console.log('[API Metadata] Fetching metadata for:', url);
      const metadata = await getMetadata(ytdlpPath, url, cookiesFromBrowser, customCookiesBase64);
      
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
    const metadata = await getMetadata(ytdlpPath, url, cookiesFromBrowser, customCookiesBase64);
    const title = metadata.title || 'download';
    const safeTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/[\/\\?%*:|"<>\s]+/g, '_');

    const cookieConfig = getCookieArg(cookiesFromBrowser, customCookiesBase64);
    const proxyArg = getProxyArg();
    const formatSpec = isYouTube
      ? (format === 'mp3' ? 'ba[ext=m4a]/ba' : 'best[ext=mp4]/best')
      : (format === 'mp3' ? 'ba' : 'best');

    if (format === 'mp3') {
      console.log(`[API Download] Spawning yt-dlp for Audio format (${formatSpec}) for: ${url}`);
      const child = spawn(ytdlpPath, ['-o', '-', '-f', formatSpec, '--js-runtimes', 'node', '--extractor-args', 'youtube:player-client=android,mweb', '--buffer-size', '1024K', ...cookieConfig.args, ...proxyArg, url]);
      
      if (cookieConfig.cleanup) {
        const cleanup = cookieConfig.cleanup;
        child.on('close', cleanup);
        child.on('error', cleanup);
      }

      const webStream = nodeToWebStream(child.stdout, child);

      return new Response(webStream, {
        headers: {
          'Content-Type': 'audio/mp4',
          'Content-Disposition': `attachment; filename="${safeTitle}.mp3"`,
        },
      });
    } else {
      console.log(`[API Download] Spawning yt-dlp for Video format (${formatSpec}) for: ${url}`);
      const child = spawn(ytdlpPath, ['-o', '-', '-f', formatSpec, '--js-runtimes', 'node', '--extractor-args', 'youtube:player-client=android,mweb', '--buffer-size', '1024K', ...cookieConfig.args, ...proxyArg, url]);
      
      if (cookieConfig.cleanup) {
        const cleanup = cookieConfig.cleanup;
        child.on('close', cleanup);
        child.on('error', cleanup);
      }

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
    
    // If it's a metadata request, return fallback instead of 500
    if (infoOnly) {
      if (isYouTube) {
        const oembedData = await fetchYouTubeOEmbed(url);
        if (oembedData) return NextResponse.json(oembedData);
      }
      
      // Fallback details for Instagram or if YouTube oEmbed failed
      return NextResponse.json({
        title: isInstagram ? 'Instagram Post' : 'YouTube Video',
        author: isInstagram ? 'Instagram User' : 'Unknown Creator',
        duration: 0,
        thumbnail: isInstagram 
          ? 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png' 
          : 'https://upload.wikimedia.org/wikipedia/commons/b/b8/YouTube_Logo_2017.svg',
        views: 0,
        isFallback: true
      });
    }

    return NextResponse.json({
      error: `Failed to process link: ${error.message || 'Unknown error'}. Please try again later.`,
      details: error.message || 'Unknown error'
    }, { status: 500 });
  }
}
