import { NextResponse } from 'next/server';
import ytSearch from 'yt-search';
import ytdl from '@distube/ytdl-core';
const scdl = require('soundcloud-downloader').default;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const track = searchParams.get('track');
    const artist = searchParams.get('artist');

    if (!track) {
      return NextResponse.json({ error: 'Track name is required' }, { status: 400 });
    }

    const searchQuery = `${track} ${artist || ''}`;
    
    // Clean artist name
    const primaryArtist = artist ? artist.split(',')[0].split('&')[0].trim() : '';
    const cleanQuery = `${track} ${primaryArtist}`.trim();

    // Attempt 1: Try SoundCloud for robust, full-length audio extraction
    let nodeStream = null;
    let contentType = 'audio/mpeg';
    let ext = 'mp3';

    try {
      let scSearchResult = await scdl.search({
        query: cleanQuery,
        resourceType: 'tracks',
        limit: 5
      });
      
      let scTrack = scSearchResult.collection.find((t: any) => t.policy !== 'SNIP' && t.duration > 30000);
      
      // Fallback to just track name if first search fails
      if (!scTrack) {
        scSearchResult = await scdl.search({
          query: track,
          resourceType: 'tracks',
          limit: 5
        });
        scTrack = scSearchResult.collection.find((t: any) => t.policy !== 'SNIP' && t.duration > 30000);
      }
      
      if (scTrack && scTrack.permalink_url) {
        nodeStream = await scdl.download(scTrack.permalink_url);
        contentType = 'audio/mpeg';
        ext = 'mp3';
      }
    } catch (err) {
      console.log('SoundCloud download failed, trying YouTube...', err);
    }
    
    // Attempt 2: Try ytdl-core (fork) for full track download if SC fails
    if (!nodeStream) {
      try {
        const searchResult = await ytSearch(cleanQuery + ' official audio');
        const video = searchResult.videos.length > 0 ? searchResult.videos[0] : null;
        
        if (video && video.url) {
          // Force mp4/m4a container for better player compatibility and seekability
          const info = await ytdl.getInfo(video.url);
          nodeStream = ytdl.downloadFromInfo(info, { filter: format => format.container === 'mp4', quality: 'highestaudio' });
          contentType = 'audio/mp4';
          ext = 'm4a';
        }
      } catch (err) {
        console.log('YouTube download failed, falling back to preview stream...', err);
      }
    }

    let webStream;
    let contentLength: string | null = null;

    if (nodeStream) {
      webStream = new ReadableStream({
        start(controller) {
          nodeStream.on('data', (chunk: any) => controller.enqueue(chunk));
          nodeStream.on('end', () => controller.close());
          nodeStream.on('error', (err: any) => controller.error(err));
        },
        cancel() {
          nodeStream.destroy();
        }
      });
      // Try to get content length if available from ytdl info event
      nodeStream.once('info', (info: any, format: any) => {
        if (format.contentLength) {
          contentLength = format.contentLength;
        }
      });
    } else {
      // Attempt 2: Fallback to iTunes Preview MP3 API to ensure the user can test the downloader
      
      // Clean artist name (remove featured artists after commas or &)
      const primaryArtist = artist ? artist.split(',')[0].split('&')[0].trim() : '';
      const cleanQuery = `${track} ${primaryArtist}`;
      
      let itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&media=music&limit=1`);
      let itunesData = itunesRes.ok ? await itunesRes.json() : null;
      
      // Secondary attempt with just the track name if first fails
      if (!itunesData?.results?.[0]?.previewUrl) {
        itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(track)}&media=music&limit=1`);
        itunesData = itunesRes.ok ? await itunesRes.json() : null;
      }
      
      const previewUrl = itunesData?.results?.[0]?.previewUrl;
      if (!previewUrl) {
        return NextResponse.json({ error: 'Could not find any audio stream or preview.' }, { status: 404 });
      }

      const audioRes = await fetch(previewUrl);
      if (!audioRes.ok || !audioRes.body) {
        return NextResponse.json({ error: 'Failed to fetch audio stream.' }, { status: 500 });
      }
      
      contentLength = audioRes.headers.get('Content-Length');
      webStream = audioRes.body;
      contentType = 'audio/mp4';
      ext = 'm4a';
    }

    const isBatch = searchParams.get('batch') === 'true';

    const filename = `${track.replace(/[^a-zA-Z0-9 ]/g, '')} - ${artist ? artist.replace(/[^a-zA-Z0-9 ]/g, '') : 'Unknown'}.${ext}`;

    const headers: Record<string, string> = {};
    
    // To prevent IDM and other download managers from hijacking fetch requests,
    // we disguise the response headers during a batch download.
    if (isBatch) {
      headers['Content-Type'] = 'application/x-spotify-audio-stream';
      headers['X-File-Extension'] = ext;
    } else {
      headers['Content-Type'] = contentType;
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    return new NextResponse(webStream, { headers });

  } catch (error: any) {
    console.error('Download route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
