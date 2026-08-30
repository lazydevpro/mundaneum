/**
 * What this board can ingest — one source of truth, shown in the WebMCP
 * panel so a person (or an agent reading over their shoulder) can see the
 * whole surface at a glance. Keep in step with capture/ingest.ts and the
 * provider table.
 */

export interface CapabilityGroup {
  label: string
  items: string[]
  note?: string
}

export const FILE_SUPPORT: CapabilityGroup[] = [
  {
    label: 'Images',
    items: ['png', 'jpg', 'gif', 'webp', 'avif', 'svg'],
    note: 'shown full-bleed on the card',
  },
  {
    label: 'Video',
    items: ['mp4', 'webm', 'mov', 'm4v'],
    note: 'plays in place, poster frame captured automatically',
  },
  {
    label: 'Audio',
    items: ['mp3', 'wav', 'ogg', 'm4a', 'flac'],
  },
  {
    label: '3D models',
    items: ['glb', 'gltf'],
    note: 'interactive on the canvas, or a snapshot image — your choice on drop',
  },
  {
    label: 'Documents',
    items: ['pdf', 'docx'],
    note: 'text is extracted so documents cluster by meaning',
  },
  {
    label: 'Spreadsheets',
    items: ['csv', 'tsv', 'xlsx', 'xls'],
    note: 'table preview on the card, full sheet in the viewer',
  },
  {
    label: 'Text & notes',
    items: ['txt', 'md', 'json', 'yaml', 'toml', 'log'],
    note: 'long dumps split into one card per paragraph',
  },
  {
    label: 'Web pages',
    items: ['html'],
    note: 'runs as a live widget on the board',
  },
  {
    label: 'Anything else',
    items: ['any file'],
    note: 'kept as a titled card with its filename and size',
  },
]

export const PLATFORM_SUPPORT: CapabilityGroup[] = [
  {
    label: 'Video',
    items: ['YouTube', 'Vimeo', 'Loom'],
  },
  {
    label: 'Music',
    items: ['Spotify', 'Apple Music', 'SoundCloud'],
    note: 'tracks, albums, and playlists',
  },
  {
    label: 'Social',
    items: ['Instagram', 'TikTok', 'X'],
  },
  {
    label: 'Other',
    items: ['Figma', 'Google Maps', 'direct media links'],
  },
  {
    label: 'Any article or page',
    items: ['title, description, and preview image'],
    note: 'agents can teach the board new platforms with add_provider',
  },
]
