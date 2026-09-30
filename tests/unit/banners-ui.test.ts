import { describe, expect, it } from 'vitest'
import { bannerKey, visibleBanners } from '../../src/renderer/actions'
import type { Banner } from '../../src/shared/types'
import { setupActions } from '../fixtures/actions'

describe('закрытие баннеров', () => {
  const b: Banner = { id: 'config-errors', level: 'warn', text: 'Ошибки в настройках: a', action: null }

  it('закрытый баннер скрыт до конца сеанса, с другим текстом появляется снова', () => {
    const { store, actions } = setupActions([])
    expect(visibleBanners([b], store.get().dismissedBanners)).toEqual([b])
    actions.dismissBanner(bannerKey(b))
    expect(visibleBanners([b], store.get().dismissedBanners)).toEqual([])
    // новая ошибка в том же config.json — это уже другой баннер
    const changed = { ...b, text: 'Ошибки в настройках: b' }
    expect(visibleBanners([changed], store.get().dismissedBanners)).toEqual([changed])
  })
})
