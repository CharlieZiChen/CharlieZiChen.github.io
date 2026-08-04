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

    const body = removeManagedChrome(parsed.body)
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
    decodeBase64,
    deriveTitle,
    encodeBase64,
    normalizeContent,
    prepareManagedDocument,
    readFrontMatterValue,
    readManagedVersion,
    slugify,
    splitFrontMatter
  }
})
