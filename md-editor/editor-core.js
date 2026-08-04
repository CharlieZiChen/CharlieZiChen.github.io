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
    { id: 'subnote', label: '子提示块', description: '在组件内补充一层提示', snippet: '{% subnote info flat %}\n{{selection}}\n{% endsubnote %}', placeholder: '子提示内容', select: '子提示内容' },
    { id: 'label', label: '彩色标签', description: '插入行内彩色标签', snippet: '{% label {{selection}} blue %}', placeholder: '标签文字', select: '标签文字', inline: true },
    { id: 'btn', label: '链接按钮', description: '插入 Butterfly 按钮', snippet: '{% btn https://example.com,{{selection}},fas fa-link,blue %}', placeholder: '按钮文字', select: '按钮文字', inline: true },
    { id: 'hideInline', label: '隐藏文字', description: '点击后显示行内内容', snippet: '{% hideInline {{selection}},点击查看,#49b1f5,#ffffff %}', placeholder: '隐藏文字', select: '隐藏文字', inline: true },
    { id: 'hideBlock', label: '隐藏区块', description: '点击后显示块级内容', snippet: '{% hideBlock 点击查看,#49b1f5,#ffffff %}\n{{selection}}\n{% endhideBlock %}', placeholder: '隐藏内容', select: '隐藏内容' },
    { id: 'hideToggle', label: '折叠内容', description: '点击后展开隐藏内容', snippet: '{% hideToggle 点击展开 %}\n{{selection}}\n{% endhideToggle %}', placeholder: '隐藏内容', select: '隐藏内容' },
    { id: 'tabs', label: '标签页', description: '插入可切换的内容面板', snippet: '{% tabs 示例标签页,1 %}\n<!-- tab 标签一 -->\n{{selection}}\n<!-- endtab -->\n<!-- tab 标签二 -->\n标签二内容\n<!-- endtab -->\n{% endtabs %}', placeholder: '标签一内容', select: '标签一内容' },
    { id: 'subtabs', label: '二级标签页', description: '在标签页中插入子标签', snippet: '{% subtabs 子标签页,1 %}\n<!-- tab 标签一 -->\n{{selection}}\n<!-- endtab -->\n{% endsubtabs %}', placeholder: '子标签内容', select: '子标签内容' },
    { id: 'subsubtabs', label: '三级标签页', description: '在子标签中继续分组', snippet: '{% subsubtabs 三级标签页,1 %}\n<!-- tab 标签一 -->\n{{selection}}\n<!-- endtab -->\n{% endsubsubtabs %}', placeholder: '三级标签内容', select: '三级标签内容' },
    { id: 'timeline', label: '时间线', description: '按阶段组织内容', snippet: '{% timeline 时间线,blue %}\n<!-- timeline 阶段一 -->\n{{selection}}\n<!-- endtimeline -->\n{% endtimeline %}', placeholder: '阶段内容', select: '阶段内容' },
    { id: 'gallery', label: '图片画廊', description: '将多张图片排成画廊', snippet: '{% gallery %}\n![图片说明](/img/example.webp)\n{% endgallery %}', select: '/img/example.webp' },
    { id: 'galleryGroup', label: '画廊分组', description: '为图片集创建封面入口', snippet: '{% galleryGroup 相册 相册说明 /photos/ /img/example.webp %}', inline: true },
    { id: 'inlineImg', label: '行内图片', description: '在文字中插入小图', snippet: '{% inlineImg /img/example.webp 24px %}', select: '/img/example.webp', inline: true },
    { id: 'pdf', label: 'PDF', description: '嵌入站内或外部 PDF', snippet: '{% pdf /pdf/example.pdf %}', select: '/pdf/example.pdf' },
    { id: 'flink', label: '友链卡片', description: '用结构化表单维护友情链接', snippet: '{% flink %}\n- class_name: 友情链接\n  class_desc: 值得访问的站点\n  link_list:\n    - name: 示例\n      link: https://example.com\n      avatar: /img/avatar.webp\n      descr: 站点说明\n      theme_color: "#49b1f5"\n{% endflink %}' },
    { id: 'mermaid', label: 'Mermaid 图表', description: '插入流程图、时序图等', snippet: '{% mermaid %}\ngraph TD\n  A[开始] --> B[结束]\n{% endmermaid %}' },
    { id: 'score', label: 'ABC 乐谱', description: '插入 ABC 记谱法内容', snippet: '{% score %}\nX:1\nT:示例\nM:4/4\nK:C\nC D E F|G A B c|\n{% endscore %}' }
  ])

  const ASSET_REFERENCE_PATTERN = /mdw-asset:\/\/([a-z0-9-]+)/gi

  const findAssetIds = source => {
    const ids = []
    const seen = new Set()
    for (const match of normalizeContent(source).matchAll(ASSET_REFERENCE_PATTERN)) {
      const id = match[1].toLowerCase()
      if (!seen.has(id)) ids.push(id)
      seen.add(id)
    }
    return ids
  }

  const replaceAssetReferences = (source, replacements = {}) => normalizeContent(source)
    .replace(ASSET_REFERENCE_PATTERN, (raw, id) => replacements[id.toLowerCase()] || raw)

  const sanitizeAssetFileName = value => {
    const source = String(value || 'file').normalize('NFKC')
    const dot = source.lastIndexOf('.')
    const extension = dot > 0 ? source.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
    const stem = (dot > 0 ? source.slice(0, dot) : source)
      .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'file'
    return `${stem}${extension}`
  }

  const buildAssetPaths = (assetBasePath, documentSlug, remoteName) => {
    const base = String(assetBasePath || 'source/uploads').replace(/^\/+|\/+$/g, '')
    const slug = slugify(documentSlug)
    const name = sanitizeAssetFileName(remoteName)
    return {
      publicPath: `/uploads/${slug}/${name}`,
      remotePath: `${base}/${slug}/${name}`
    }
  }

  // A small deterministic content fingerprint keeps the browser data model
  // synchronous and avoids persisting a full second copy of every document.
  const contentHash = source => {
    const content = normalizeContent(source)
    let hash = 0x811c9dc5
    for (let index = 0; index < content.length; index += 1) {
      hash ^= content.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${content.length}`
  }

  const migrateDocument = (document = {}) => {
    const content = stripManagedDocumentChrome(document.content || '')
    const remotePath = String(document.remotePath || '')
    const baseContentHash = String(document.baseContentHash || document.publishedHash || '')
    const dirty = remotePath ? (!baseContentHash || contentHash(content) !== baseContentHash) : true

    return {
      ...document,
      content,
      baseContentHash,
      publishedHash: String(document.publishedHash || baseContentHash),
      dirty,
      remotePath,
      syncStatus: document.syncStatus === 'conflict' ? 'conflict' : (dirty ? 'local-ahead' : 'clean')
    }
  }

  const mergeRemoteDocuments = (localDocuments = [], remoteDocuments = []) => {
    const locals = localDocuments.map(migrateDocument)
    const consumed = new Set()
    const merged = remoteDocuments.map(remoteInput => {
      const remote = migrateDocument({ ...remoteInput, baseContentHash: contentHash(remoteInput.content || '') })
      const localIndex = locals.findIndex((candidate, index) => !consumed.has(index) && (
        (candidate.remotePath && candidate.remotePath === remote.remotePath) ||
        (candidate.slug && remote.slug && candidate.slug === remote.slug)
      ))

      if (localIndex < 0) {
        return { ...remote, dirty: false, syncStatus: 'clean' }
      }

      consumed.add(localIndex)
      const local = locals[localIndex]
      const localHash = contentHash(local.content)
      const remoteHash = contentHash(remote.content)
      const localChanged = local.baseContentHash ? localHash !== local.baseContentHash : localHash !== remoteHash
      const remoteChanged = Boolean(local.sha && remote.sha && local.sha !== remote.sha)

      if (!localChanged) {
        return {
          ...local,
          ...remote,
          baseContentHash: remoteHash,
          publishedHash: remoteHash,
          dirty: false,
          syncStatus: 'clean',
          conflictRemoteContent: '',
          conflictRemoteSha: ''
        }
      }

      if (remoteChanged) {
        return {
          ...remote,
          ...local,
          dirty: true,
          syncStatus: 'conflict',
          conflictRemoteContent: remote.content,
          conflictRemoteSha: remote.sha,
          remoteShaObserved: remote.sha
        }
      }

      return {
        ...remote,
        ...local,
        sha: remote.sha || local.sha,
        baseContentHash: remoteHash,
        publishedHash: remoteHash,
        dirty: localHash !== remoteHash,
        syncStatus: localHash === remoteHash ? 'clean' : 'local-ahead',
        conflictRemoteContent: '',
        conflictRemoteSha: ''
      }
    })

    locals.forEach((document, index) => {
      if (!consumed.has(index)) merged.push(document)
    })

    return merged
  }

  const ACTIVE_PUBLISH_STATUSES = Object.freeze(['committing', 'deploying', 'timed_out'])

  const createPublishJob = (options = {}) => {
    const startedAt = Number(options.startedAt || Date.now())
    const timeoutMs = Number(options.timeoutMs || 10 * 60 * 1000)
    return {
      id: String(options.id || `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
      documentId: String(options.documentId || ''),
      remotePath: String(options.remotePath || ''),
      pagePath: String(options.pagePath || ''),
      version: String(options.version || ''),
      snapshotHash: String(options.snapshotHash || ''),
      startedAt,
      deadlineAt: startedAt + timeoutMs,
      status: 'committing',
      message: '正在提交到 GitHub…'
    }
  }

  const isPublishLocked = job => Boolean(job && ACTIVE_PUBLISH_STATUSES.includes(job.status))

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
    ACTIVE_PUBLISH_STATUSES,
    applyTextEdit,
    buildAssetPaths,
    BUTTERFLY_COMPONENTS,
    contentHash,
    createPublishJob,
    decodeBase64,
    deriveTitle,
    encodeBase64,
    findAssetIds,
    isPublishLocked,
    mergeRemoteDocuments,
    migrateDocument,
    normalizeContent,
    normalizeMarkdownStructure,
    prepareManagedDocument,
    readFrontMatterValue,
    readManagedVersion,
    replaceAssetReferences,
    sanitizeAssetFileName,
    slugify,
    splitFrontMatter,
    splitMarkdownBlocks,
    stripManagedDocumentChrome
  }
})
