import { NextResponse } from 'next/server';


// Using a mock fallback if spotify scraping fails or library is hard to configure
export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Since spotify-url-info can be flaky without proper setup or gets blocked,
    // we use an open public API for Spotify to get playlist/track info, or 
    // a robust fallback method if needed.
    // For demonstration, here is the robust metadata extractor.
    
    // Simple basic regex check
    const isPlaylist = url.includes('/playlist/');
    const isTrack = url.includes('/track/');
    const isAlbum = url.includes('/album/');
    
    if (!isPlaylist && !isTrack && !isAlbum) {
      return NextResponse.json({ error: 'Invalid Spotify URL' }, { status: 400 });
    }

    let tracks: any[] = [];
    let name = "Spotify Playlist";
    let image = "https://picsum.photos/seed/spotify/300/300";

    // Anonymous Extraction (Hard limited to 100 by Spotify)
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const html = await response.text();
      
      // Try to extract Spotify's preloaded state (which contains track data)
      const stateMatch = html.match(/<script id="initial-state" type="text\/plain">(.*?)<\/script>/);
      let initialState = null;
      if (stateMatch && stateMatch[1]) {
        try {
          const stateJson = JSON.parse(atob(stateMatch[1]));
          // Parse state logic would go here depending on their exact current structure
        } catch(e) {}
      }
      
      // Since Spotify obfuscates heavily, if we can't get it, we mock it 
      // but in a real complete backend, we would use a library like `spotify-url-info`
      
      // Real backend integration with `spotify-url-info`
      const spotify = require('spotify-url-info')(fetch);
      
      const data = await spotify.getData(url);
      
      if (data.type === 'track') {
        name = data.name;
        image = data.coverArt?.sources?.[0]?.url || data.album?.images?.[0]?.url || image;
        tracks.push({
          id: data.id,
          name: data.name,
          artist: data.artists.map((a: any) => a.name).join(', '),
          image: data.coverArt?.sources?.[0]?.url || data.album?.images?.[0]?.url || '',
          status: 'idle'
        });
      } else if (data.type === 'playlist' || data.type === 'album') {
        name = data.name;
        image = data.coverArt?.sources?.[0]?.url || data.images?.[0]?.url || image;
        
        const trackList = data.trackList || (data.tracks ? data.tracks.items : []);
        
        let fallbackId = 0;
        for (const item of trackList) {
          const track = item.track || item;
          if (!track) continue;
          
          tracks.push({
            id: track.id || `track-${fallbackId++}-${Math.random().toString(36).substring(2, 9)}`,
            name: track.name || track.title,
            artist: (track.artists || []).map((a: any) => a.name).join(', ') || track.subtitle || "Unknown Artist",
            image: track.coverArt?.sources?.[0]?.url || track.album?.images?.[0]?.url || '',
            status: 'idle'
          });
        }
      }
      
    } catch (e: any) {
      console.error("Scraping error:", e);
      // Fallback if blocked by Spotify
      return NextResponse.json({ 
        error: 'Failed to extract data. Spotify might be blocking the request.' 
      }, { status: 500 });
    }

    return NextResponse.json({
      name,
      image,
      tracks
    });

  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
