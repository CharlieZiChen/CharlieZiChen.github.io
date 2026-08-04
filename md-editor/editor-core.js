(function (root, factory) {
  'use strict'

  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.MarkdownEditorCore = api
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  'use strict'

  const normalizeContent = value => String(value || '').replace(/\r\n?/g, '\n')

  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const splitFrontMatter = source => {
    const content = normalizeContent(source)
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)
    const frontMatter = match?.[1] || ''
    const titleMatch = frontMatter.match(/^title:\s*(?:"([^"]*)"|'([^']*)'|(.+))\s*$/m)

    return {
      body: match ? content.slice(match[0].length) : content,
      bodyOffset: match ? match[0].length : 0,
      frontMatter,
      hasFrontMatter: Boolean(match),
      title: (titleMatch?.[1] || titleMatch?.[2] || titleMatch?.[3] || '').trim()
    }
  }

  const readFrontMatterValue = (frontMatter, key) => {
    const match = String(frontMatter || '').match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+?)\\s*$`, 'm'))
    if (!match) return ''
    const value = match[1].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }
    return value
  }

  const deriveTitle = (content, fileName = '未命名文稿.md') => {
    const parsed = splitFrontMatter(content)
    const heading = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim()
    return parsed.title || heading || String(fileName).replace(/\.md$/i, '') || '未命名文稿'
  }

  const slugify = value => {
    const slug = String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'document'

    return slug === 'index' ? 'page-index' : slug
  }

  const upsertFrontMatterField = (frontMatter, key, value) => {
    const line = `${key}: ${value}`
    const expression = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, 'm')
    const normalized = normalizeContent(frontMatter).trim()
    return expression.test(normalized)
      ? normalized.replace(expression, line)
      : `${normalized}${normalized ? '\n' : ''}${line}`
  }

  const removeManagedChrome = body => normalizeContent(body)
    .replace(/<div class="managed-page-toolbar"[\s\S]*?<\/div>\s*/i, '')
    .replace(/<span class="managed-page-version"[^>]*><\/span>\s*/i, '')
    .replace(/^\s+/, '')

  const stripManagedDocumentChrome = source => {
    const parsed = splitFrontMatter(source)
    const body = removeManagedChrome(parsed.body)
    if (!parsed.hasFrontMatter) return body
    return `---\n${parsed.frontMatter}\n---\n\n${body}`.trimEnd() + '\n'
  }

  const normalizeMarkdownStructure = source => {
    const content = normalizeContent(source)
    const parsed = splitFrontMatter(content)
    const prefix = content.slice(0, parsed.bodyOffset)
    const lines = parsed.body.split('\n')
    const output = []

    for (let index = 0; index < lines.length; index += 1) {
      const opening = lines[index].match(/^(\s*)([-+*]|\d+[.)])\s+(`{3,}|~{3,})\s*([^\s].*)?$/)
      if (!opening) {
        output.push(lines[index])
        continue
      }

      const fenceCharacter = opening[3][0]
      let closingIndex = index + 1
      while (closingIndex < lines.length) {
        const candidate = lines[closingIndex].trim()
        if (candidate.length >= opening[3].length && [...candidate].every(character => character === fenceCharacter)) break
        closingIndex += 1
      }
      if (closingIndex >= lines.length) {
        output.push(lines[index])
        continue
      }

      const markerIndent = opening[1]
      const marker = opening[2]
      const childIndent = `${markerIndent}${' '.repeat(marker.length + 1)}`
      const codeLines = lines.slice(index + 1, closingIndex)
      const nonEmptyIndents = codeLines
        .filter(line => line.trim())
        .map(line => line.match(/^\s*/)[0].length)
      const sharedIndent = nonEmptyIndents.length ? Math.min(...nonEmptyIndents) : 0

      output.push(`${markerIndent}${marker}`)
      output.push(`${childIndent}${opening[3]}${opening[4] ? ` ${opening[4].trim()}` : ''}`)
      codeLines.forEach(line => {
        output.push(line.trim() ? `${childIndent}${line.slice(sharedIndent)}` : childIndent)
      })
      output.push(`${childIndent}${opening[3]}`)
      index = closingIndex
    }

    return `${prefix}${output.join('\n')}`
  }

  const splitMarkdownBlocks = source => {
    const content = normalizeContent(source)
    const parsed = splitFrontMatter(content)
    const body = parsed.body
    const blocks = []
    const linePattern = /.*(?:\n|$)/g
    const lines = []
    let match

    while ((match = linePattern.exec(body)) && match[0]) {
      const raw = match[0]
      lines.push({
        end: parsed.bodyOffset + match.index + raw.length,
        start: parsed.bodyOffset + match.index,
        text: raw.replace(/\n$/, '')
      })
    }

    for (let index = 0; index < lines.length;) {
      while (index < lines.length && !lines[index].text.trim()) index += 1
      if (index >= lines.length) break

      const startIndex = index
      const fence = lines[index].text.match(/^\s*(`{3,}|~{3,})/)
      const butterfly = lines[index].text.match(/^\s*{%\s*(note|subnote|hideBlock|hideToggle|tabs|subtabs|subsubtabs|timeline|gallery|score|flink)\b/i)

      if (fence) {
        index += 1
        while (index < lines.length && !new RegExp(`^\\s*${escapeRegExp(fence[1][0])}{${fence[1].length},}\\s*$`).test(lines[index].text)) index += 1
        if (index < lines.length) index += 1
      } else if (butterfly) {
        const closingName = `end${butterfly[1]}`
        index += 1
        while (index < lines.length && !new RegExp(`^\\s*{%\\s*${escapeRegExp(closingName)}\\s*%}\\s*$`, 'i').test(lines[index].text)) index += 1
        if (index < lines.length) index += 1
      } else {
        index += 1
        while (index < lines.length && lines[index].text.trim()) index += 1
      }

      const start = lines[startIndex].start
      const end = lines[Math.max(startIndex, index - 1)].end
      blocks.push({ start, end, text: content.slice(start, end).replace(/\n$/, '') })
    }

    return blocks
  }

  const applyTextEdit = (source, start, end, replacement, options = {}) => {
    const content = normalizeContent(source)
    const safeStart = Math.max(0, Math.min(Number(start) || 0, content.length))
    const safeEnd = Math.max(safeStart, Math.min(Number(end) || safeStart, content.length))
    const selected = content.slice(safeStart, safeEnd)
    let inserted = String(replacement || '').replace('{{selection}}', selected || String(options.placeholder || ''))
    let prefix = ''
    let suffix = ''

    if (options.block) {
      const before = content.slice(0, safeStart)
      const after = content.slice(safeEnd)
      if (before && !before.endsWith('\n\n')) prefix = before.endsWith('\n') ? '\n' : '\n\n'
      if (after && !after.startsWith('\n\n')) suffix = after.startsWith('\n') ? '\n' : '\n\n'
      inserted = inserted.trimEnd()
    }

    const value = `${content.slice(0, safeStart)}${prefix}${inserted}${suffix}${content.slice(safeEnd)}`
    const insertedStart = safeStart + prefix.length
    const selectionText = String(options.select || '')
    const selectionOffset = selectionText ? inserted.indexOf(selectionText) : -1
    const selectionStart = selectionOffset >= 0 ? insertedStart + selectionOffset : insertedStart + inserted.length

    return {
      value,
      selectionStart,
      selectionEnd: selectionOffset >= 0 ? selectionStart + selectionText.length : selectionStart
    }
  }

  const BUTTERFLY_COMPONENTS = Object.freeze([
    { id: 'note', label: '提示块', description: '强调提示、警告或补充信息', snippet: '{% note info modern %}\n{{selection}}\n{% endnote %}', placeholder: '在这里填写提示内容', select: '在这里填写提示内容' },
    { id: 'label', label: '彩色标签', description: '插入行内彩色标签', snippet: '{% label {{selection}} blue %}', placeholder: '标签文字', select: '标签文字', inline: true },
    { id: 'button', label: '链接按钮', description: '插入 Butterfly 按钮', snippet: '{% btn https://example.com,{{selection}},fas fa-link,blue %}', placeholder: '按钮文字', select: '按钮文字', inline: true },
    { id: 'tabs', label: '标签页', description: '插入可切换的内容面板', snippet: '{% tabs 示例标签页,1 %}\n<!-- tab 标签一 -->\n{{selection}}\n<!-- endtab -->\n<!-- tab 标签二 -->\n标签二内容\n<!-- endtab -->\n{% endtabs %}', placeholder: '标签一内容', select: '标签一内容' },
    { id: 'timeline', label: '时间线', description: '按阶段组织内容', snippet: '{% timeline 时间线,blue %}\n<!-- timeline 阶段一 -->\n{{selection}}\n<!-- endtimeline -->\n{% endtimeline %}', placeholder: '阶段内容', select: '阶段内容' },
    { id: 'hideToggle', label: '折叠内容', description: '点击后展开隐藏内容', snippet: '{% hideToggle 点击展开 %}\n{{selection}}\n{% endhideToggle %}', placeholder: '隐藏内容', select: '隐藏内容' },
    { id: 'gallery', label: '图片画廊', description: '将多张图片排成画廊', snippet: '{% gallery %}\n![图片说明](/img/example.webp)\n{% endgallery %}', select: '/img/example.webp' },
    { id: 'inlineImg', label: '行内图片', description: '在文字中插入小图', snippet: '{% inlineImg /img/example.webp 24px %}', select: '/img/example.webp', inline: true },
    { id: 'pdf', label: 'PDF', description: '嵌入站内或外部 PDF', snippet: '{% pdf /pdf/example.pdf %}', select: '/pdf/example.pdf' }
  ])

  const prepareManagedDocument = (source, options = {}) => {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
    const parsed = splitFrontMatter(source)
    const fileName = options.fileName || '未命名文稿.md'
    const title = deriveTitle(source, fileName)
    const slug = slugify(options.slug || fileName.replace(/\.md$/i, '') || title)
    const version = String(options.version || `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
    // Keep the Hexo permalink unescaped. Hexo uses this value as the output
    // directory, while browsers encode the Unicode path when requesting it.
    const pagePath = `/pages/${slug}/`
    let frontMatter = parsed.frontMatter

    frontMatter = upsertFrontMatterField(frontMatter, 'layout', 'page')
    frontMatter = upsertFrontMatterField(frontMatter, 'title', JSON.stringify(title))
    if (!readFrontMatterValue(frontMatter, 'date')) {
      frontMatter = upsertFrontMatterField(frontMatter, 'date', JSON.stringify(now.toISOString()))
    }
    frontMatter = upsertFrontMatterField(frontMatter, 'updated', JSON.stringify(now.toISOString()))
    frontMatter = upsertFrontMatterField(frontMatter, 'managed', 'true')
    frontMatter = upsertFrontMatterField(frontMatter, 'comments', 'false')
    frontMatter = upsertFrontMatterField(frontMatter, 'aside', 'false')
    frontMatter = upsertFrontMatterField(frontMatter, 'permalink', JSON.stringify(pagePath))

    const body = normalizeMarkdownStructure(removeManagedChrome(parsed.body))
    const toolbar = [
      '<div class="managed-page-toolbar">',
      `  <a href="/md-editor/?remote=${encodeURIComponent(slug)}"><i class="fas fa-edit" aria-hidden="true"></i> 编辑此页面</a>`,
      '</div>',
      `<span class="managed-page-version" data-version="${version}" aria-hidden="true"></span>`
    ].join('\n')

    return {
      content: `---\n${frontMatter}\n---\n\n${toolbar}\n\n${body}`.trimEnd() + '\n',
      pagePath,
      remotePath: `${String(options.basePath || 'source/pages').replace(/^\/+|\/+$/g, '')}/${slug}/index.md`,
      slug,
      title,
      version
    }
  }

  const encodeBase64 = value => {
    const bytes = new TextEncoder().encode(normalizeContent(value))
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    return btoa(binary)
  }

  const decodeBase64 = value => {
    const binary = atob(String(value || '').replace(/\s+/g, ''))
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  const readManagedVersion = source => normalizeContent(source)
    .match(/class="managed-page-version"[^>]*data-version="([^"]+)"/i)?.[1] || ''

  return {
    applyTextEdit,
    BUTTERFLY_COMPONENTS,
    decodeBase64,
    deriveTitle,
    encodeBase64,
    normalizeContent,
    normalizeMarkdownStructure,
    prepareManagedDocument,
    readFrontMatterValue,
    readManagedVersion,
    slugify,
    splitFrontMatter,
    splitMarkdownBlocks,
    stripManagedDocumentChrome
  }
})
