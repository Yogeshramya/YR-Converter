'use client';

import React, { useState, useEffect } from 'react';
import { Play, Download, Music, Video, Link, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

interface VideoInfo {
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  views: number;
}

export default function YoutubeConverter() {
  const [url, setUrl] = useState('');
  const [isValidUrl, setIsValidUrl] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<'mp3' | 'mp4'>('mp3');
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Validate YouTube URL
  useEffect(() => {
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|v\/|.+\?v=)?([^&=%\?]{11})/;
    setIsValidUrl(ytRegex.test(url));
    if (url && !ytRegex.test(url)) {
      setError('Please enter a valid YouTube video link');
    } else {
      setError(null);
    }
  }, [url]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (err) {
      setError('Failed to read from clipboard. Please paste manually.');
    }
  };

  const fetchVideoInfo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValidUrl) return;

    setIsLoading(true);
    setError(null);
    setVideoInfo(null);

    try {
      const response = await fetch(`/api/download?url=${encodeURIComponent(url)}&info=true`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch video details.');
      }

      setVideoInfo(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading video. The video may be unavailable or private.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!url || !isValidUrl) return;

    setIsDownloading(true);
    setProgress(0);
    setError(null);
    
    const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&format=${downloadFormat}`;
    
    try {
      // 1. Fetch stream response
      const response = await fetch(downloadUrl);
      
      // 2. Check if response is error JSON
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json') || !response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to convert video.');
      }

      // 3. Set up stream reader to track progress
      const reader = response.body?.getReader();
      const contentLength = +(response.headers.get('Content-Length') || 0);

      if (!reader) {
        throw new Error('Response stream reader is not available.');
      }

      let receivedLength = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        
        if (contentLength > 0) {
          setProgress(Math.round((receivedLength / contentLength) * 100));
        }
      }

      // 4. Assemble Blob and initiate local file download
      const blob = new Blob(chunks as any[], {
        type: downloadFormat === 'mp3' ? 'audio/mpeg' : 'video/mp4',
      });
      
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      
      const fileExt = downloadFormat === 'mp3' ? 'mp3' : 'mp4';
      const cleanTitle = (videoInfo?.title || 'download')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[\/\\?%*:|"<>\s]+/g, '_');
        
      link.download = `${cleanTitle}.${fileExt}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up local reference
      setTimeout(() => URL.revokeObjectURL(fileUrl), 100);

    } catch (err: any) {
      console.warn('Direct stream fetch failed or was blocked by CORS. Falling back to direct browser redirect download...', err);
      
      // If we got a explicit error from our API, show it in the UI
      if (err.message && (err.message.includes('Failed to convert') || err.message.includes('attempts failed') || err.message.includes('rate-limit') || err.message.includes('unavailable'))) {
        setError(err.message);
      } else {
        // Otherwise, it was likely a CORS redirect block. Direct download handles this.
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.target = '_blank';
        link.setAttribute('download', '');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatViews = (views: number) => {
    if (views >= 1000000) {
      return `${(views / 1000000).toFixed(1)}M views`;
    }
    if (views >= 1000) {
      return `${(views / 1000).toFixed(0)}K views`;
    }
    return `${views} views`;
  };

  return (
    <div className="space-y-6">
      <form onSubmit={fetchVideoInfo} className="space-y-4">
        <div>
          <label htmlFor="yt-url" className="block text-sm font-medium text-gray-400 mb-2 font-display">
            Paste YouTube Video URL
          </label>
          <div className="relative flex items-center">
            <div className="absolute left-4 text-gray-500">
              <Link className="h-5 w-5" />
            </div>
            <input
              id="yt-url"
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full pl-12 pr-24 py-4 glass-input text-sm md:text-base font-sans"
              disabled={isLoading || isDownloading}
            />
            <button
              type="button"
              onClick={handlePaste}
              className="absolute right-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/15 text-gray-300 transition-colors"
              disabled={isLoading || isDownloading}
            >
              Paste Link
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={!isValidUrl || isLoading || isDownloading}
          className={`w-full py-4 btn-primary flex items-center justify-center gap-2 ${
            !isValidUrl || isLoading || isDownloading ? 'opacity-50 cursor-not-allowed transform-none shadow-none' : ''
          }`}
        >
          {isLoading ? (
            <>
              <RefreshCw className="h-5 w-5 animate-spin" />
              Fetching Metadata...
            </>
          ) : (
            <>
              <Play className="h-5 w-5 fill-current" />
              Analyze YouTube Link
            </>
          )}
        </button>
      </form>

      {/* Error Message */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to process link</p>
            <p className="text-red-300/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Video Details Card */}
      {videoInfo && (
        <div className="glass-panel p-5 space-y-6 animate-fade-in">
          <div className="flex flex-col md:flex-row gap-5">
            {/* Thumbnail */}
            <div className="relative w-full md:w-48 aspect-video rounded-xl overflow-hidden bg-black/40 border border-white/5 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={videoInfo.thumbnail}
                alt={videoInfo.title}
                className="w-full h-full object-cover"
              />
              {videoInfo.duration > 0 && (
                <span className="absolute bottom-2 right-2 px-2 py-0.5 text-xs bg-black/80 backdrop-blur text-white font-mono rounded">
                  {formatDuration(videoInfo.duration)}
                </span>
              )}
            </div>

            {/* Meta */}
            <div className="flex-grow space-y-2">
              <h3 className="text-lg font-bold text-white font-display leading-snug line-clamp-2">
                {videoInfo.title}
              </h3>
              <p className="text-sm text-gray-400 font-sans">
                By <span className="text-gray-300 font-semibold">{videoInfo.author}</span>
              </p>
              <div className="flex gap-4 text-xs text-gray-500 font-mono">
                {videoInfo.views > 0 && <span>{formatViews(videoInfo.views)}</span>}
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-5 space-y-4">
            <label className="block text-sm font-medium text-gray-400 font-display">
              Choose Download Format
            </label>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setDownloadFormat('mp3')}
                className={`flex items-center justify-center gap-3 p-4 rounded-xl border text-sm font-semibold transition-all ${
                  downloadFormat === 'mp3'
                    ? 'bg-violet-600/20 border-violet-500/50 text-white shadow-[0_0_15px_rgba(139,92,246,0.15)]'
                    : 'bg-white/3 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Music className="h-5 w-5" />
                <div className="text-left">
                  <div className="font-bold">Audio (MP3)</div>
                  <div className="text-xs opacity-60">High Quality Audio</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDownloadFormat('mp4')}
                className={`flex items-center justify-center gap-3 p-4 rounded-xl border text-sm font-semibold transition-all ${
                  downloadFormat === 'mp4'
                    ? 'bg-cyan-600/20 border-cyan-500/50 text-white shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'bg-white/3 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Video className="h-5 w-5" />
                <div className="text-left">
                  <div className="font-bold">Video (MP4)</div>
                  <div className="text-xs opacity-60">720p / 360p Standard</div>
                </div>
              </button>
            </div>

            {isDownloading && progress > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-gray-400">Downloading Stream...</span>
                  <span className="text-violet-400 font-bold">{progress}%</span>
                </div>
                <div className="progress-container">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className={`w-full py-4 mt-2 btn-primary flex items-center justify-center gap-2 ${
                isDownloading ? 'opacity-50 cursor-not-allowed pulse-glow' : ''
              }`}
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  {progress > 0 ? `Downloading ${progress}%` : 'Processing Stream...'}
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  Convert & Download {downloadFormat.toUpperCase()}
                </>
              )}
            </button>
            
            <p className="text-center text-xs text-gray-500 font-mono">
              Downloads will stream directly to your browser's default downloads folder.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
