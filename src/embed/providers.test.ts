import { describe, expect, it } from 'vitest'
import { classifyUrl } from './providers'

describe('classifyUrl embeds', () => {
  it('turns YouTube links into playable embed URLs', () => {
    const card = classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(card.type).toBe('video')
    expect(card.meta.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  })

  it('turns Spotify links into playable embed URLs', () => {
    const card = classifyUrl('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl')
    expect(card.type).toBe('audio')
    expect(card.meta.embedUrl).toBe('https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl')
  })

  it('routes public PDFs through the same-origin relay', () => {
    const url = 'https://example.com/files/report.pdf'
    const card = classifyUrl(url)
    expect(card.type).toBe('doc')
    expect(card.meta.embedUrl).toBe('/embed?url=' + encodeURIComponent(url))
  })

  it('renders public Excel workbooks with Office viewer', () => {
    const url = 'https://example.com/files/report.xlsx'
    const card = classifyUrl(url)
    expect(card.type).toBe('sheet')
    expect(card.meta.embedUrl).toBe(
      'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(url),
    )
  })

  it('keeps remote 3D models as model cards', () => {
    const url = 'https://example.com/models/bird.glb'
    const card = classifyUrl(url)
    expect(card.type).toBe('model')
    expect(card.meta.embedUrl).toBe(url)
  })
})
