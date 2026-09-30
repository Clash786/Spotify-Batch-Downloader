import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Spotify Downloader | Batch Download Songs & Playlists',
  description: 'Easily scrape and batch download Spotify songs and playlists. High quality MP3 downloads.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
