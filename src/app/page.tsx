"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Download, CheckCircle2, Loader2, Music, FileText, X, SearchIcon } from "lucide-react";
import JSZip from "jszip";
import styles from "./page.module.css";

interface Track {
  id: string;
  name: string;
  artist: string;
  image: string;
  status: "idle" | "downloading" | "done" | "error";
  progress?: number;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [playlist, setPlaylist] = useState<{ name: string; image: string; tracks: Track[] } | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [quality, setQuality] = useState("highest");
  const [filterText, setFilterText] = useState("");

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    setIsLoading(true);
    setPlaylist(null);
    setSelectedTracks(new Set());
    setErrorMsg("");
    setFilterText("");
    
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch playlist data');
      }
      
      setPlaylist({
        name: data.name || "Spotify Details",
        image: data.image,
        tracks: data.tracks,
      });
      
      // Select all by default
      setSelectedTracks(new Set(data.tracks.map((t: Track) => t.id)));
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTrack = (id: string) => {
    const newSelected = new Set(selectedTracks);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTracks(newSelected);
  };

  const filteredTracks = playlist?.tracks.filter(t => 
    t.name.toLowerCase().includes(filterText.toLowerCase()) || 
    t.artist.toLowerCase().includes(filterText.toLowerCase())
  ) || [];

  const toggleAll = () => {
    if (!playlist) return;
    const allVisibleSelected = filteredTracks.length > 0 && filteredTracks.every(t => selectedTracks.has(t.id));
    
    const newSelected = new Set(selectedTracks);
    if (allVisibleSelected) {
      filteredTracks.forEach(t => newSelected.delete(t.id));
    } else {
      filteredTracks.forEach(t => newSelected.add(t.id));
    }
    setSelectedTracks(newSelected);
  };

  const exportList = () => {
    if (!playlist) return;
    const text = filteredTracks.map(t => `${t.artist} - ${t.name}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${playlist.name.replace(/[^a-zA-Z0-9 ]/g, '')}_Tracklist.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearPlaylist = () => {
    setPlaylist(null);
    setUrl("");
  };

  const downloadFile = async (track: Track, returnBlob: boolean = false) => {
    try {
      const query = new URLSearchParams({ track: track.name, artist: track.artist, quality });
      if (returnBlob) query.append('batch', 'true');
      const res = await fetch(`/api/download?${query.toString()}`);
      
      if (!res.ok) throw new Error('Download failed');
      
      const contentLength = res.headers.get('Content-Length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const chunks: Uint8Array[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        loaded += value.length;
        
        if (total > 0) {
          const progress = Math.round((loaded / total) * 100);
          setPlaylist(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              tracks: prev.tracks.map(t => t.id === track.id ? { ...t, progress } : t)
            };
          });
        }
      }
      
      const fileExt = res.headers.get('X-File-Extension') || 'mp3';
      const actualContentType = fileExt === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
      const blob = new Blob(chunks as any[], { type: actualContentType });
      
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `${track.name.replace(/[/\\?%*:|"<>]/g, '')}.${fileExt}`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch && filenameMatch.length === 2) {
          filename = filenameMatch[1];
        }
      }

      if (returnBlob) {
        return { success: true, blob, filename };
      }
      
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
      return { success: true };
    } catch (err) {
      console.error(err);
      return { success: false };
    }
  };

  const handleDownloadSingle = async (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    if (track.status === 'downloading') return;

    setPlaylist(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        tracks: prev.tracks.map(t => t.id === track.id ? { ...t, status: "downloading" as const } : t)
      };
    });

    const { success } = await downloadFile(track, false);
    
    setPlaylist(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        tracks: prev.tracks.map(t => t.id === track.id ? { ...t, status: success ? "done" : "error" } : t)
      };
    });
  };

  const handleDownloadSelected = async () => {
    if (!playlist || selectedTracks.size === 0) return;
    
    setIsDownloadingBatch(true);
    
    const newTracks = playlist.tracks.map(t => 
      selectedTracks.has(t.id) ? { ...t, status: "downloading" as const } : t
    );
    setPlaylist({ ...playlist, tracks: newTracks });

    const zip = new JSZip();
    let hasSuccess = false;

    // Run sequentially to avoid server rate limits and build the ZIP
    for (const track of newTracks) {
      if (selectedTracks.has(track.id)) {
        const result = await downloadFile(track, true);
        
        if (result.success && result.blob) {
          zip.file(result.filename || `${track.name.replace(/[/\\?%*:|"<>]/g, '')}.mp3`, result.blob);
          hasSuccess = true;
          setPlaylist(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              tracks: prev.tracks.map(t => t.id === track.id ? { ...t, status: "done" } : t)
            };
          });
        } else {
          setPlaylist(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              tracks: prev.tracks.map(t => t.id === track.id ? { ...t, status: "error" } : t)
            };
          });
        }
      }
    }
    
    if (hasSuccess) {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const downloadUrl = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${playlist.name.replace(/[^a-zA-Z0-9 ]/g, '') || 'playlist'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    }
    
    setIsDownloadingBatch(false);
  };

  return (
    <main className={styles.main}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Spotify Batch Downloader</h1>
        <p className={styles.subtitle}>
          Paste any Spotify track, album, or playlist link to extract and batch download your favorite songs in high-quality audio format.
        </p>
      </div>

      <form onSubmit={handleFetch} className={styles.inputSection}>
        <div className={styles.inputGroup}>
          <input
            type="text"
            className={styles.input}
            placeholder="https://open.spotify.com/playlist/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className={styles.fetchButton} disabled={isLoading || !url}>
            {isLoading ? <Loader2 className={styles.loadingSpinner} size={20} /> : <Search size={20} />}
            {isLoading ? "Extracting..." : "Extract"}
          </button>
        </div>
        {errorMsg && <div style={{color: '#ff4444', marginTop: '1rem', textAlign: 'center'}}>{errorMsg}</div>}
      </form>

      <AnimatePresence>
        {playlist && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={styles.resultsSection}
          >
            <div className={styles.playlistHeader}>
              <img src={playlist.image} alt={playlist.name} className={styles.playlistImage} />
              <div className={styles.playlistInfo}>
                <h2>{playlist.name}</h2>
                <p>{playlist.tracks.length} tracks found</p>
                <div className={styles.extraControls}>
                  <button className={styles.iconButton} onClick={exportList} title="Export Tracklist">
                    <FileText size={18} />
                  </button>
                  <button className={styles.iconButton} onClick={clearPlaylist} title="Clear Playlist">
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.searchBar}>
              <SearchIcon size={16} className={styles.searchIconSmall} />
              <input 
                type="text" 
                placeholder="Filter tracks by name or artist..." 
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className={styles.searchInput}
              />
            </div>

            <div className={styles.controls}>
              <label className={styles.selectAll}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={filteredTracks.length > 0 && filteredTracks.every(t => selectedTracks.has(t.id))}
                  onChange={toggleAll}
                />
                Select All ({selectedTracks.size} total)
              </label>

              <div className={styles.extraControls}>
                <select 
                  className={styles.select} 
                  value={quality} 
                  onChange={(e) => setQuality(e.target.value)}
                  disabled={isDownloadingBatch}
                >
                  <option value="highest">Highest Quality</option>
                  <option value="standard">Standard Quality</option>
                </select>

                <button 
                  className={styles.downloadButton}
                  onClick={handleDownloadSelected}
                  disabled={selectedTracks.size === 0 || isDownloadingBatch}
                >
                  {isDownloadingBatch ? (
                    <>
                      <Loader2 className={styles.loadingSpinner} size={18} />
                      Processing Batch...
                    </>
                  ) : (
                    <>
                      <Download size={18} />
                      Download Selected
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className={styles.trackList}>
              {filteredTracks.map((track, idx) => (
                <motion.div
                  key={`${track.id || 'track'}-${idx}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={styles.trackItem}
                  onClick={() => toggleTrack(track.id)}
                >
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selectedTracks.has(track.id)}
                    readOnly
                    disabled={track.status === "downloading" || track.status === "done"}
                  />
                  {track.image ? (
                    <img src={track.image} alt="" className={styles.trackImage} />
                  ) : (
                    <div className={styles.trackImage} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.1)' }}>
                      <Music size={20} color="#a7a7a7" />
                    </div>
                  )}
                  
                  <div className={styles.trackDetails}>
                    <div className={styles.trackName}>{track.name}</div>
                    <div className={styles.trackArtist}>{track.artist}</div>
                  </div>

                  <div className={styles.trackActions}>
                    {track.status === 'downloading' && track.progress !== undefined && (
                      <div className={styles.progressBarWrapper}>
                        <div className={styles.progressBarFill} style={{ width: `${track.progress}%` }} />
                        <span className={styles.progressText}>{track.progress}%</span>
                      </div>
                    )}
                    <button 
                      className={styles.iconButton}
                      onClick={(e) => handleDownloadSingle(e, track)}
                      disabled={track.status === 'downloading' || isDownloadingBatch}
                      title="Download this track"
                      style={{ marginRight: '1rem', padding: '0.4rem' }}
                    >
                      <Download size={16} />
                    </button>
                    <div className={`${styles.statusIcon} ${track.status === 'done' ? styles.success : ''}`}>
                      {track.status === "idle" && <Music size={20} />}
                      {track.status === "downloading" && track.progress === undefined && <Loader2 className={styles.loadingSpinner} size={20} />}
                      {track.status === "done" && <CheckCircle2 size={20} />}
                      {track.status === "error" && <span style={{color: '#ff4444', fontSize: '0.8rem'}}>Failed</span>}
                    </div>
                  </div>
                </motion.div>
              ))}
              {filteredTracks.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  No tracks match your filter.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
