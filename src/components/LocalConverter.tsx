'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileVideo, Music, Download, RefreshCw, AlertCircle, Play, Pause } from 'lucide-react';

export default function LocalConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'reading' | 'decoding' | 'encoding' | 'completed' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<'mp3' | 'wav'>('mp3');
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  
  const [lameLoaded, setLameLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load LameJS dynamically from a CDN for bundler safety
  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as any).lamejs) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js';
      script.async = true;
      script.onload = () => {
        setLameLoaded(true);
      };
      script.onerror = () => {
        console.error('Failed to load lamejs from CDN. MP3 output will fall back to WAV format.');
      };
      document.body.appendChild(script);
      return () => {
        if (document.body.contains(script)) {
          document.body.removeChild(script);
        }
      };
    } else {
      setLameLoaded(true);
    }
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    setErrorMessage(null);
    resetConversionState();
    
    // Check if it is a video file by mime type or file extension
    const videoExtensions = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v', '.flv', '.3gp', '.wmv'];
    const fileName = selectedFile.name.toLowerCase();
    const hasVideoExtension = videoExtensions.some(ext => fileName.endsWith(ext));
    const isVideoMime = selectedFile.type && selectedFile.type.startsWith('video/');

    if (!isVideoMime && !hasVideoExtension) {
      setErrorMessage('Please upload a valid video file (e.g. MP4, MOV, WebM)');
      return;
    }

    // Size limit of 200MB to prevent browser tab crashes during decoding
    if (selectedFile.size > 200 * 1024 * 1024) {
      setErrorMessage('The file is too large. Please select a video smaller than 200MB to avoid memory limits.');
      return;
    }

    setFile(selectedFile);
  };

  const resetConversionState = () => {
    setStatus('idle');
    setProgress(0);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBlob(null);
    setIsPlaying(false);
    setFile(null);
    setErrorMessage(null);
  };

  // Convert Float32 to Int16
  const floatTo16BitPCM = (float32Array: Float32Array): Int16Array => {
    const buffer = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buffer;
  };

  // WAV Encoder Helper
  const bufferToWav = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // raw PCM
    const bitDepth = 16;
    
    let result;
    if (numOfChan === 2) {
      result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
    } else {
      result = floatTo16BitPCM(buffer.getChannelData(0));
    }
    
    const bufferArr = new ArrayBuffer(44 + result.length * 2);
    const view = new DataView(bufferArr);
    
    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + result.length * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, format, true);
    /* channel count */
    view.setUint16(22, numOfChan, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, numOfChan * (bitDepth / 8), true);
    /* bits per sample */
    view.setUint16(34, bitDepth, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, result.length * 2, true);
    
    // Write PCM audio samples
    let offset = 44;
    for (let i = 0; i < result.length; i++, offset += 2) {
      view.setInt16(offset, result[i], true);
    }
    
    return new Blob([bufferArr], { type: 'audio/wav' });

    function interleave(inputL: Float32Array, inputR: Float32Array): Int16Array {
      const length = inputL.length + inputR.length;
      const interleaved = new Int16Array(length);
      let index = 0;
      let inputIndex = 0;
      
      while (index < length) {
        let sampleL = Math.max(-1, Math.min(1, inputL[inputIndex]));
        interleaved[index++] = sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7FFF;
        
        let sampleR = Math.max(-1, Math.min(1, inputR[inputIndex]));
        interleaved[index++] = sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7FFF;
        
        inputIndex++;
      }
      return interleaved;
    }

    function writeString(dataview: DataView, offset: number, string: string) {
      for (let i = 0; i < string.length; i++) {
        dataview.setUint8(offset + i, string.charCodeAt(i));
      }
    }
  };

  const handleConvert = async () => {
    if (!file) return;

    setStatus('reading');
    setProgress(10);
    setErrorMessage(null);

    try {
      // 1. Read file as ArrayBuffer
      const fileReader = new FileReader();
      
      const arrayBufferPromise = new Promise<ArrayBuffer>((resolve, reject) => {
        fileReader.onload = () => resolve(fileReader.result as ArrayBuffer);
        fileReader.onerror = () => reject(new Error('Failed to read video file.'));
        fileReader.readAsArrayBuffer(file);
      });

      const arrayBuffer = await arrayBufferPromise;
      
      // 2. Decode Audio Track
      setStatus('decoding');
      setProgress(30);

      // Web Audio API Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } catch (err) {
        throw new Error('This browser failed to decode the audio track. Make sure the video contains an audio track and is in a standard format (MP4, WebM, etc.).');
      }

      setProgress(60);

      // 3. Encode Audio
      setStatus('encoding');
      
      const isMp3Selected = outputFormat === 'mp3' && lameLoaded && (window as any).lamejs;
      
      if (isMp3Selected) {
        // MP3 Encoding Process
        const lamejs = (window as any).lamejs;
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const kbps = 192; // High quality bit rate
        const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
        
        const leftChannel = floatTo16BitPCM(audioBuffer.getChannelData(0));
        const rightChannel = channels === 2 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;
        
        const mp3Data: Uint8Array[] = [];
        const sampleBlockSize = 1152;
        let offset = 0;
        
        // Chunked encoding loop to keep browser thread responsive
        const chunksPerTick = 200;

        const encode = () => {
          let count = 0;
          while (offset < leftChannel.length && count < chunksPerTick) {
            const leftChunk = leftChannel.subarray(offset, offset + sampleBlockSize);
            let mp3buf;
            
            if (channels === 2 && rightChannel) {
              const rightChunk = rightChannel.subarray(offset, offset + sampleBlockSize);
              mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
            } else {
              mp3buf = mp3encoder.encodeBuffer(leftChunk);
            }
            
            if (mp3buf.length > 0) {
              mp3Data.push(new Uint8Array(mp3buf));
            }
            
            offset += sampleBlockSize;
            count++;
          }

          if (offset < leftChannel.length) {
            // Map encoding progress from 60% to 95%
            const encodingProgress = Math.floor((offset / leftChannel.length) * 35) + 60;
            setProgress(encodingProgress);
            
            // Queue next batch immediately
            setTimeout(encode, 0);
          } else {
            // Flush encoder
            const endBuf = mp3encoder.flush();
            if (endBuf.length > 0) {
              mp3Data.push(new Uint8Array(endBuf));
            }
            
            const blob = new Blob(mp3Data as any[], { type: 'audio/mp3' });
            finishConversion(blob);
          }
        };

        encode();

      } else {
        // WAV Encoding (Instant)
        if (outputFormat === 'mp3' && !lameLoaded) {
          console.warn('LameJS failed to load. Falling back to WAV format.');
        }
        
        setTimeout(() => {
          try {
            const wavBlob = bufferToWav(audioBuffer);
            setProgress(95);
            finishConversion(wavBlob);
          } catch (err: any) {
            setErrorMessage('WAV encoding failed: ' + err.message);
            setStatus('error');
          }
        }, 100);
      }

    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'An error occurred during extraction.');
      setStatus('error');
    }
  };

  const finishConversion = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    setAudioBlob(blob);
    setAudioUrl(url);
    setProgress(100);
    setStatus('completed');
  };

  const handleDownload = () => {
    if (!audioUrl || !file) return;
    
    // Strip original extension and replace with selected format
    const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const finalExt = outputFormat === 'mp3' && lameLoaded ? 'mp3' : 'wav';
    
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `${nameWithoutExt}_extracted.${finalExt}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="space-y-6">
      {/* Drag and Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        className={`dropzone p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
          isDragActive ? 'active' : ''
        }`}
        onClick={() => document.getElementById('local-video-input')?.click()}
      >
        <input
          id="local-video-input"
          key={file ? 'has-file' : 'no-file'}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileChange}
          disabled={status !== 'idle' && status !== 'completed' && status !== 'error'}
        />

        <div className="p-4 bg-white/5 rounded-2xl text-violet-400 mb-4 border border-white/5">
          <Upload className="h-8 w-8" />
        </div>

        <h3 className="text-lg font-bold text-white font-display">
          Drag & Drop Video File
        </h3>
        <p className="text-sm text-gray-400 mt-2 max-w-xs font-sans">
          Supports MP4, MOV, WebM, AVI (Max 200MB)
        </p>
        <button
          type="button"
          className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/15 text-gray-300 transition-colors"
        >
          Browse Local Files
        </button>
      </div>

      {/* Selected File Details */}
      {file && (
        <div className="glass-panel p-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-xl">
              <FileVideo className="h-6 w-6" />
            </div>
            <div className="flex-grow min-w-0">
              <h4 className="text-sm font-semibold text-white font-display truncate">
                {file.name}
              </h4>
              <p className="text-xs text-gray-500 font-mono mt-0.5">
                {formatSize(file.size)} • {file.type.split('/')[1]?.toUpperCase() || 'VIDEO'}
              </p>
            </div>
            {(status === 'idle' || status === 'completed' || status === 'error') && (
              <button
                onClick={resetConversionState}
                className="text-xs text-gray-400 hover:text-white underline font-mono"
              >
                Clear
              </button>
            )}
          </div>

          {status === 'idle' && (
            <div className="border-t border-white/5 pt-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-400 font-display">Target Audio Format</span>
                <div className="flex gap-2 bg-white/5 p-1 rounded-lg border border-white/5">
                  <button
                    type="button"
                    onClick={() => setOutputFormat('mp3')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      outputFormat === 'mp3' ? 'bg-violet-600 text-white' : 'text-gray-400'
                    }`}
                  >
                    MP3
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutputFormat('wav')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      outputFormat === 'wav' ? 'bg-violet-600 text-white' : 'text-gray-400'
                    }`}
                  >
                    WAV (Lossless)
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleConvert}
                className="w-full py-3.5 btn-primary flex items-center justify-center gap-2"
              >
                <Music className="h-5 w-5" />
                Extract Audio Track
              </button>
            </div>
          )}

          {/* Progress Indicators */}
          {(status === 'reading' || status === 'decoding' || status === 'encoding') && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400 uppercase">
                  {status === 'reading' && 'Reading File...'}
                  {status === 'decoding' && 'Decoding Audio Track...'}
                  {status === 'encoding' && 'Compressing into MP3/WAV...'}
                </span>
                <span className="text-violet-400 font-bold">{progress}%</span>
              </div>
              <div className="progress-container">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <div>
                <p className="font-semibold">Conversion failed</p>
                <p className="text-red-300/80 mt-1">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Completed State */}
          {status === 'completed' && audioUrl && (
            <div className="border-t border-white/5 pt-5 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></div>
                  Audio Extracted Successfully!
                </div>
                
                {/* Audio visualizer design */}
                <div className="waveform-container xs-hidden">
                  <div className="waveform-bar" style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}></div>
                  <div className="waveform-bar" style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}></div>
                  <div className="waveform-bar" style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}></div>
                  <div className="waveform-bar" style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}></div>
                  <div className="waveform-bar" style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}></div>
                </div>
              </div>

              {/* Audio preview player */}
              <div className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="p-3 bg-violet-600 hover:bg-violet-700 text-white rounded-full transition-colors shrink-0 shadow-lg shadow-violet-600/20"
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="h-4 w-4 fill-current ml-0.5" />
                  )}
                </button>
                <div className="flex-grow">
                  <div className="text-xs font-semibold text-gray-300">Preview Extracted Track</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                    {outputFormat.toUpperCase()} • {audioBlob ? formatSize(audioBlob.size) : ''}
                  </div>
                </div>
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  className="hidden"
                  onEnded={() => setIsPlaying(false)}
                />
              </div>

              <button
                type="button"
                onClick={handleDownload}
                className="w-full py-4 btn-primary flex items-center justify-center gap-2"
              >
                <Download className="h-5 w-5" />
                Download Extracted Audio
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
