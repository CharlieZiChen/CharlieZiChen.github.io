(function (root, factory) {
  'use strict'

  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ButterflyComponentPreview = api
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  'use strict'

  const text = value => String(value ?? '')
  const safeColor = value => /^#[0-9a-f]{3,8}$/i.test(text(value)) ? text(value) : '#49b1f5'
  const safeSize = value => /^\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)$/i.test(text(value).trim()) ? text(value).trim() : '24px'

  const render = (nameValue, values = {}, options = {}) => {
    const document = options.document || globalThis.document
    if (!document) return null
    const name = nameValue === 'button' ? 'btn' : nameValue
    const resolveAsset = options.resolveAsset || (value => text(value))
    const element = (tag, className = '', content = '') => {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (content !== '') node.textContent = text(content)
      return node
    }
    const body = content => {
      const node = element('div', 'mdw-component-preview-body')
      node.textContent = text(content) || '暂无内容'
      return node
    }
    const image = (source, alt = '') => {
      const node = element('img', 'mdw-component-preview-image')
      node.src = resolveAsset(source)
      node.alt = text(alt)
      node.loading = 'lazy'
      return node
    }
    const link = (label, href, className = '') => {
      const node = element('a', className, label)
      const destination = text(href).trim()
      if (/^(?:https?:\/\/|\/|blob:)/i.test(destination)) node.href = resolveAsset(destination)
      else node.href = '#'
      node.addEventListener('click', event => event.preventDefault())
      return node
    }
    const root = element('div', `mdw-component-render mdw-component-render-${name}`)

    if (name === 'note' || name === 'subnote') {
      root.classList.add('mdw-preview-note', `is-${values.kind || 'default'}`, `is-${values.style || 'modern'}`)
      root.append(body(values.body))
    } else if (name === 'label') {
      const mark = element('mark', `mdw-preview-label is-${values.color || 'default'}`, values.content || '标签文字')
      root.append(mark)
    } else if (name === 'btn') {
      const button = link(values.content || '按钮文字', values.url, `mdw-preview-button is-${values.color || 'default'}`)
      if (values.outline) button.classList.add('is-outline')
      if (values.block) button.classList.add('is-block')
      if (values.larger) button.classList.add('is-larger')
      root.classList.toggle('is-centered', Boolean(values.center))
      root.append(button)
    } else if (name === 'hideInline') {
      const details = element('details', 'mdw-preview-disclosure is-inline')
      const summary = element('summary', '', values.display || '点击查看')
      summary.style.background = safeColor(values.background)
      summary.style.color = safeColor(values.color)
      details.append(summary, element('span', '', values.content || '隐藏文字'))
      root.append(details)
    } else if (name === 'hideBlock' || name === 'hideToggle') {
      const details = element('details', 'mdw-preview-disclosure')
      const summary = element('summary', '', values.display || '点击展开')
      summary.style.background = safeColor(values.background)
      summary.style.color = safeColor(values.color)
      details.append(summary, body(values.body))
      root.append(details)
    } else if (['tabs', 'subtabs', 'subsubtabs'].includes(name)) {
      const items = Array.isArray(values.items) ? values.items : []
      root.append(element('div', 'mdw-preview-caption', values.name || '标签页'))
      const tabs = element('div', 'mdw-preview-tabs')
      const nav = element('div', 'mdw-preview-tab-nav')
      const panels = element('div', 'mdw-preview-tab-panels')
      const active = Math.max(0, Math.min(items.length - 1, (Number(values.active) || 1) - 1))
      items.forEach((item, index) => {
        const tab = element('button', index === active ? 'is-active' : '', item.title || `页签 ${index + 1}`)
        tab.type = 'button'
        const panel = body(item.body)
        panel.hidden = index !== active
        tab.addEventListener('click', event => {
          event.preventDefault()
          ;[...nav.children].forEach(node => node.classList.remove('is-active'))
          ;[...panels.children].forEach(node => { node.hidden = true })
          tab.classList.add('is-active')
          panel.hidden = false
        })
        nav.append(tab)
        panels.append(panel)
      })
      tabs.append(nav, panels)
      root.append(tabs)
    } else if (name === 'timeline') {
      root.append(element('div', 'mdw-preview-caption', values.headline || '时间线'))
      const timeline = element('div', `mdw-preview-timeline is-${values.color || 'default'}`)
      ;(values.items || []).forEach(item => {
        const row = element('div', 'mdw-preview-timeline-item')
        row.append(element('strong', '', item.title || '节点'), body(item.body))
        timeline.append(row)
      })
      root.append(timeline)
    } else if (name === 'gallery') {
      if (values.mode === 'url') {
        root.append(element('div', 'mdw-preview-file-card', `远程画廊数据：${values.dataUrl || '尚未填写地址'}`))
      } else {
        const gallery = element('div', 'mdw-preview-gallery')
        ;(values.items || []).forEach(item => {
          const figure = element('figure')
          figure.append(image(item.source, item.alt))
          if (item.title || item.alt) figure.append(element('figcaption', '', item.title || item.alt))
          gallery.append(figure)
        })
        root.append(gallery)
      }
    } else if (name === 'galleryGroup') {
      const card = element('div', 'mdw-preview-gallery-group')
      card.append(image(values.image, ''), element('strong', '', values.name || '相册'), element('span', '', values.description || '相册说明'))
      root.append(card)
    } else if (name === 'inlineImg') {
      const visual = image(values.source, '行内图片')
      visual.style.height = safeSize(values.height)
      visual.style.width = 'auto'
      root.append(visual)
    } else if (name === 'pdf') {
      const card = element('div', 'mdw-preview-file-card')
      card.append(element('strong', '', 'PDF 文件'), element('span', '', values.source || '请选择 PDF 文件或填写地址'))
      root.append(card)
    } else if (name === 'flink') {
      ;(values.groups || []).forEach(group => {
        root.append(element('div', 'mdw-preview-caption', `${group.name || '链接分组'}${group.description ? ` · ${group.description}` : ''}`))
        const grid = element('div', 'mdw-preview-link-grid')
        ;(group.links || []).forEach(item => {
          const card = element('div', 'mdw-preview-link-card')
          card.style.borderColor = safeColor(item.color)
          card.append(image(item.avatar, ''), element('strong', '', item.name || '站点'), element('span', '', item.description || item.url || ''))
          grid.append(card)
        })
        root.append(grid)
      })
    } else if (name === 'mermaid' || name === 'score') {
      root.append(element('div', 'mdw-preview-lightweight-note', name === 'mermaid' ? '轻量预览：Mermaid 源码' : '轻量预览：ABC 乐谱源码'))
      root.append(element('pre', 'mdw-preview-code', values.source || '暂无源码'))
    } else {
      root.append(body('该组件暂时使用源码预览。'))
    }

    return root
  }

  return { render }
})
