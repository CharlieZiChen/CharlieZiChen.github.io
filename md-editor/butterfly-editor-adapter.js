(function (root, factory) {
  'use strict'

  const api = factory(root?.MarkdownEditorCore)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ButterflyEditorAdapter = api
})(typeof globalThis === 'undefined' ? this : globalThis, core => {
  'use strict'

  const normalize = value => String(value || '').replace(/\r\n?/g, '\n')
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pairedTags = ['note', 'subnote', 'hideBlock', 'hideToggle', 'tabs', 'subtabs', 'subsubtabs', 'timeline', 'gallery', 'score', 'flink', 'mermaid']
  const inlineTags = ['label', 'btn', 'button', 'hideInline', 'inlineImg', 'galleryGroup', 'pdf', 'series']
  const labelByTag = {
    btn: '链接按钮',
    button: '链接按钮',
    flink: '友链卡片',
    gallery: '图片画廊',
    galleryGroup: '画廊分组',
    hideBlock: '隐藏区块',
    hideInline: '隐藏文字',
    hideToggle: '折叠内容',
    inlineImg: '行内图片',
    label: '彩色标签',
    mermaid: 'Mermaid 图表',
    note: '提示块',
    pdf: 'PDF',
    score: '评分卡',
    series: '系列文章',
    subtabs: '二级标签页',
    subsubtabs: '三级标签页',
    tabs: '标签页',
    timeline: '时间线'
  }
  const PLACEHOLDER_PATTERN_SOURCE = '\\[\\[BUTTERFLY_COMPONENT_[a-z0-9-]+\\]\\]'

  const parseRaw = rawValue => {
    const raw = normalize(rawValue).trim()
    const opening = raw.match(/^{%\s*([\w-]+)\b([^%]*?)%}/i)
    if (!opening) return null
    const name = opening[1]
    const closing = new RegExp(`{%\\s*end${escapeRegExp(name)}\\s*%}\\s*$`, 'i')
    const paired = closing.test(raw)
    const body = paired
      ? raw.slice(opening[0].length).replace(closing, '').replace(/^\n|\n$/g, '')
      : ''
    return {
      args: opening[2].trim(),
      body,
      label: labelByTag[name] || name,
      name,
      paired,
      raw
    }
  }

  const serializeEntry = entry => {
    const opening = `{% ${entry.name}${entry.args ? ` ${entry.args.trim()}` : ''} %}`
    return entry.paired
      ? `${opening}\n${String(entry.body || '').replace(/^\n|\n$/g, '')}\n{% end${entry.name} %}`
      : opening
  }

  const protectMarkdown = source => {
    let markdown = normalize(source)
    const entries = []
    let counter = 0

    const replaceRaw = raw => {
      const parsed = parseRaw(raw)
      if (!parsed) return raw
      counter += 1
      const seed = core?.contentHash ? core.contentHash(`${counter}:${raw}`).replace(/[^a-z0-9-]/gi, '') : `${Date.now().toString(36)}${counter}`
      const id = `${seed}-${counter}`.toLowerCase()
      const placeholder = `[[BUTTERFLY_COMPONENT_${id}]]`
      entries.push({ ...parsed, id, placeholder })
      return placeholder
    }

    pairedTags.forEach(name => {
      const expression = new RegExp(`{%\\s*${escapeRegExp(name)}\\b[^%]*?%}[\\s\\S]*?{%\\s*end${escapeRegExp(name)}\\s*%}`, 'gi')
      markdown = markdown.replace(expression, replaceRaw)
    })

    const inlineExpression = new RegExp(`{%\\s*(?:${inlineTags.map(escapeRegExp).join('|')})\\b[^%]*?%}`, 'gi')
    markdown = markdown.replace(inlineExpression, replaceRaw)
    return { entries, markdown }
  }

  const restoreMarkdown = (source, entries = []) => {
    let markdown = normalize(source)
    entries.forEach(entry => {
      const raw = serializeEntry(entry)
      const escaped = entry.placeholder.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
      const placeholderPattern = escapeRegExp(entry.placeholder)
      const escapedPattern = escapeRegExp(escaped)
      markdown = markdown
        .replace(new RegExp(`(?:\\$\\$widget\\d+\\s+)?${placeholderPattern}(?:\\$\\$)?`, 'g'), raw)
        .replace(new RegExp(`(?:\\$\\$widget\\d+\\s+)?${escapedPattern}(?:\\$\\$)?`, 'g'), raw)
    })
    return markdown
  }

  const entryFromComponent = component => {
    const selection = component.select || component.placeholder || ''
    const raw = String(component.snippet || '').replace('{{selection}}', selection)
    const parsed = parseRaw(raw)
    if (!parsed) return null
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    return { ...parsed, id, placeholder: `[[BUTTERFLY_COMPONENT_${id}]]` }
  }

  const summarizeEntry = entry => {
    const detail = entry.paired ? entry.body : entry.args
    return String(detail || '点击设置组件内容').replace(/\s+/g, ' ').trim().slice(0, 96)
  }

  return {
    PLACEHOLDER_PATTERN_SOURCE,
    entryFromComponent,
    parseRaw,
    protectMarkdown,
    restoreMarkdown,
    serializeEntry,
    summarizeEntry
  }
})
